// HAWK ×3 — three analysts reason independently, then vote. 2-of-3 agreement
// in the same direction is required, or the setup is folded.

import { callAgentJSON, type ModelTier } from "@/lib/anthropic";
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
  const results = await Promise.all(
    personasFor(strategyFamily(opts.strategyKey)).map((persona) =>
      callAgentJSON<{ vote: HawkVote["vote"]; confidence: number; reason: string }>({
        tier: opts.tier ?? "sonnet",
        system: SYSTEM[persona],
        prompt: buildPrompt(facts, persona),
        maxTokens: 300,
        jsonSchema: VOTE_SCHEMA,
      }).then((r) => ({ ...r, persona })),
    ),
  );

  const votes: HawkVote[] = results.map((r) => ({
    persona: r.persona,
    vote: r.data.vote,
    confidence: clamp01(r.data.confidence),
    reason: r.data.reason,
  }));
  const totalCostUsd = results.reduce((s, r) => s + r.costUsd, 0);

  const longs = votes.filter((v) => v.vote === "long").length;
  const shorts = votes.filter((v) => v.vote === "short").length;
  let side: "long" | "short" | null = null;
  if (longs >= 2) side = "long";
  else if (shorts >= 2) side = "short";

  const levels = side
    ? computeLevels(scan, side, opts.atrSlMult ?? 1.5, opts.atrTpMult ?? 2.5, opts.singleTarget ?? false, opts.trail)
    : null;

  return { agreed: side != null, side, votes, levels, totalCostUsd };
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
