// HAWK ×3 — three analysts reason independently, then vote. 2-of-3 agreement
// in the same direction is required, or the setup is folded.

import { callAgentJSON, type ModelTier } from "@/lib/anthropic";
import type { ScanResult } from "./scanner";
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
];

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
  } = {},
): Promise<HawkVerdict> {
  if (!scan.side) return { agreed: false, side: null, votes: [], levels: null, totalCostUsd: 0 };

  const facts = renderContext(opts.context ?? buildAnalystContext(scan, { newsDigest: opts.newsDigest }));
  const results = await Promise.all(
    PERSONAS.map((p) =>
      callAgentJSON<{ vote: HawkVote["vote"]; confidence: number; reason: string }>({
        tier: opts.tier ?? "sonnet",
        system: p.system,
        prompt: buildPrompt(facts, p.persona),
        maxTokens: 300,
        jsonSchema: VOTE_SCHEMA,
      }).then((r) => ({ ...r, persona: p.persona })),
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
