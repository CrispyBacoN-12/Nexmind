// HAWK ×3 — three analysts reason independently, then vote. 2-of-3 agreement
// in the same direction is required, or the setup is folded.

import { callAgentJSON, isFatalBackendReason, type ModelTier } from "@/lib/anthropic";
import type { ScanResult } from "./scanner";
import { strategyFamily, type StrategyFamily } from "./strategies";
import { buildAnalystContext, personaLens, renderContext, type AnalystContext, type Persona } from "./context";

export interface HawkVote {
  persona: string;
  vote: "long" | "short" | "skip";
  confidence: number; // 0..1
  reason: string;
}

export interface ProposedLevels {
  entry: number;
  sl: number;
  tp1: number;
  tp2: number | null; // null = single-target: TP1 is the full exit, no farther partial leg
  /** ATR trailing stop, in price distances off entry — present only when the
   *  firing strategy's preferredExit declares one (replaces the tp1/tp2 ladder). */
  trail?: { activateDist: number; offsetDist: number } | null;
}

export interface HawkVerdict {
  agreed: boolean;
  side: "long" | "short" | null;
  votes: HawkVote[];
  levels: ProposedLevels | null;
  totalCostUsd: number;
  /** Analysts whose call failed and were not counted. Empty on a clean panel.
   *  Surfaced rather than swallowed: a quietly smaller panel is exactly the
   *  kind of degradation that reads as "the analysts declined". */
  dropped?: string[];
}

const PERSONAS: { persona: Persona; system: string }[] = [
  {
    persona: "trend",
    system:
      "You are a trend-following analyst. You favor trading in the direction of the dominant trend (MA alignment, ADX, +DI/-DI). You are skeptical of counter-trend setups. Be concise.",
  },
  {
    persona: "structure",
    system:
      "You are a market-structure analyst. You reason from swing highs/lows, support/resistance, and whether price respects key levels. You ignore momentum hype. Be concise.",
  },
  {
    persona: "counter",
    system:
      "You are a mean-reversion / counter-trend analyst. You look for exhaustion, overextension (RSI extremes), and fade opportunities. You are wary of chasing. Be concise.",
  },
  {
    persona: "exhaustion",
    system:
      "You are an exhaustion analyst. The trade's direction is already set; you judge only whether the move still has room to run or is already spent. An unextended move is a reason to confirm, not to abstain. Be concise.",
  },
];

const SYSTEM = Object.fromEntries(PERSONAS.map((p) => [p.persona, p.system])) as Record<Persona, string>;

/**
 * Which three analysts judge a setup, given what the firing strategy bets on.
 *
 * The count stays at three for every family. Simply dropping the voter that
 * cannot confirm would turn the 2-of-3 bar into 2-of-2 unanimity between the
 * survivors — a stricter gate than the one that already produced seven days of
 * silence. What rotates is who plays the skeptic, so the disagreement stays real
 * and answerable.
 *
 * Live evidence, portfolio #11 over 45 non-mock counterfactuals under
 * combo-vote (all three members are continuation setups): trend voted long 39 /
 * short 3 / skip 3, while structure and counter voted skip 45 of 45. Nothing
 * cleared the bar.
 */
export function personasFor(family: StrategyFamily): Persona[] {
  switch (family) {
    // A continuation setup cannot be confirmed by a voter whose job is to fade
    // it; `exhaustion` asks the same reader whether the move is spent instead.
    case "trend":
      return ["trend", "structure", "exhaustion"];
    // Here the fade IS the setup, so `counter` can genuinely confirm or refuse,
    // and the trend reader is the one supplying the opposing case.
    case "reversion":
      return ["counter", "structure", "trend"];
    // A combo that votes across both families — and the default for anything
    // unclassified, research strategies above all. Unchanged from before.
    case "mixed":
      return ["trend", "structure", "counter"];
  }
}

const VOTE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    vote: { type: "string", enum: ["long", "short", "skip"] },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
  required: ["vote", "confidence", "reason"],
};

/** The prompt asks for a cited number and a sentence of reasoning, and the
 *  analysts write 50-80 words. At 300 the answer was being cut off mid-`reason`
 *  — see `countableVotes`. The cap is a runaway guard, not a length budget. */
const MAX_VOTE_TOKENS = 600;

const TASK =
  "Decide: long, short, or skip. The scanner has already fired — your job is to confirm or refuse it, " +
  "not to invent a different trade. Cite the specific number that decided your vote. " +
  "Return JSON {vote, confidence (0-1), reason (one sentence)}.";

/** Same facts to all three, different lens each — see context.ts for why. */
function buildPrompt(facts: string, persona: Persona): string {
  return `${facts}\n\n${personaLens(persona)}\n\n${TASK}`;
}

/** Run the three analysts in parallel and tally a 2-of-3 vote. */
export async function runHawk(
  scan: ScanResult,
  opts: {
    /** Pre-built facts sheet (the engine builds it once and shares it with SAGE).
     *  Falls back to a scan-only context so other callers still get the full read. */
    context?: AnalystContext;
    newsDigest?: string;
    tier?: ModelTier;
    atrSlMult?: number;
    atrTpMult?: number;
    singleTarget?: boolean;
    trail?: { activateMult: number; offsetMult: number };
    /** The strategy that fired, used only to pick the analyst trio. Omitted ⇒
     *  "mixed", i.e. the original three. */
    strategyKey?: string | null;
  } = {},
): Promise<HawkVerdict> {
  if (!scan.side) return { agreed: false, side: null, votes: [], levels: null, totalCostUsd: 0 };

  const facts = renderContext(opts.context ?? buildAnalystContext(scan, { newsDigest: opts.newsDigest }));
  const results = await Promise.allSettled(
    personasFor(strategyFamily(opts.strategyKey)).map((persona) =>
      callAgentJSON<{ vote: HawkVote["vote"]; confidence: number; reason: string }>({
        tier: opts.tier ?? "sonnet",
        system: SYSTEM[persona],
        prompt: buildPrompt(facts, persona),
        maxTokens: MAX_VOTE_TOKENS,
        jsonSchema: VOTE_SCHEMA,
      }).then((r) => ({ ...r, persona })),
    ),
  );

  const { votes, dropped, totalCostUsd } = countableVotes(results);

  const longs = votes.filter((v) => v.vote === "long").length;
  const shorts = votes.filter((v) => v.vote === "short").length;
  let side: "long" | "short" | null = null;
  if (longs >= 2) side = "long";
  else if (shorts >= 2) side = "short";

  const levels = side
    ? computeLevels(scan, side, opts.atrSlMult ?? 1.5, opts.atrTpMult ?? 2.5, opts.singleTarget ?? false, opts.trail)
    : null;

  return { agreed: side != null, side, votes, levels, totalCostUsd, dropped };
}

/** One analyst's answer, as `runHawk` receives it back. */
type AnalystAnswer = {
  persona: Persona;
  data: { vote: HawkVote["vote"]; confidence: number; reason: string };
  costUsd: number;
};

/** Fold three settled calls into the votes that can be counted.
 *
 *  A single analyst failing must not void the panel. It did: `maxTokens: 300`
 *  truncated a long `reason` mid-string, `parseJsonLoose` threw, `Promise.all`
 *  rejected, and the engine's catch reported **`no-ai-backend`** — an outage
 *  that was not happening — discarding the two votes already paid for. FTNT on
 *  2026-09-02 is one of these.
 *
 *  Dropping a failed vote cannot make entry easier: the bar is "two votes on
 *  the same side", not "a majority of whoever answered", so a smaller panel is
 *  a strictly harder bar. A fatal backend failure is the opposite case — no
 *  analyst can answer — and still propagates, so the outage latch keeps working. */
export function countableVotes(
  results: PromiseSettledResult<AnalystAnswer>[],
): { votes: HawkVote[]; dropped: string[]; totalCostUsd: number } {
  const votes: HawkVote[] = [];
  const dropped: string[] = [];
  let totalCostUsd = 0;

  for (const r of results) {
    if (r.status === "fulfilled") {
      votes.push({
        persona: r.value.persona,
        vote: r.value.data.vote,
        confidence: clamp01(r.value.data.confidence),
        reason: r.value.data.reason,
      });
      totalCostUsd += r.value.costUsd;
      continue;
    }
    const why = r.reason instanceof Error ? r.reason.message : String(r.reason);
    if (isFatalBackendReason(why)) throw r.reason;
    dropped.push(why);
  }

  if (!votes.length) throw new Error(`every HAWK analyst failed: ${dropped.join(" | ")}`);
  return { votes, dropped, totalCostUsd };
}

/** Per-analyst reason budget in the stored reading.
 *
 *  Fixed per analyst rather than shared, so the LAST analyst in the panel is
 *  as readable as the first. A shared budget truncated from the end, which is
 *  the same silent-omission failure `describePanel` exists to prevent — it
 *  would just have moved from "the analyst that died" to "the analyst that
 *  spoke third". Three of these plus SAGE's own 500 fit inside the row cap in
 *  `recordCounterfactual` with room to spare. */
const STORED_REASON_CHARS = 240;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** One reading of what the panel did, for the log line AND the stored
 *  `Counterfactual.aiReason`. One function because they were two, and the
 *  stored half — the one the arm recorder keeps and anyone reads months later
 *  — was the half that silently omitted the analysts that never answered. A
 *  panel that voted 2-of-2 because the third analyst died must never read like
 *  a clean 2-of-3.
 *
 *  `reasons: true` adds each analyst's confidence and its own words. The log
 *  line stays terse; the stored row takes the verbose form, because the vote
 *  alone cannot answer the question the row is kept to answer. Measured
 *  2026-09-08: `structure` voted skip in 20 of 20 panels and has confirmed 0
 *  times in 75 votes, and nothing in the database could say why — the reason
 *  string existed on the vote object and was thrown away at exactly this
 *  line. Still ONE function: same reading, two verbosities, one source. */
export function describePanel(
  v: Pick<HawkVerdict, "votes" | "dropped">,
  opts: { reasons?: boolean } = {},
): string {
  const read = (x: HawkVote) =>
    opts.reasons
      ? `${x.persona}:${x.vote}@${x.confidence.toFixed(2)} ${JSON.stringify(oneLine(x.reason).slice(0, STORED_REASON_CHARS))}`
      : `${x.persona}:${x.vote}`;
  const votes = `votes ${v.votes.map(read).join(", ")}`;
  if (!v.dropped?.length) return votes;
  return `${votes} (${v.dropped.length} analyst(s) dropped: ${v.dropped.join(" | ")})`;
}

function computeLevels(
  scan: ScanResult,
  side: "long" | "short",
  slMult: number,
  tpMult: number,
  singleTarget: boolean,
  trailMult?: { activateMult: number; offsetMult: number },
): ProposedLevels {
  const atr = scan.atr ?? scan.price * 0.005; // fallback 0.5% if ATR missing
  const entry = scan.price;
  const trail = trailMult ? { activateDist: trailMult.activateMult * atr, offsetDist: trailMult.offsetMult * atr } : null;
  if (side === "long") {
    return { entry, sl: entry - slMult * atr, tp1: entry + tpMult * atr, tp2: singleTarget ? null : entry + tpMult * 1.6 * atr, trail };
  }
  return { entry, sl: entry + slMult * atr, tp1: entry - tpMult * atr, tp2: singleTarget ? null : entry - tpMult * 1.6 * atr, trail };
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5);
