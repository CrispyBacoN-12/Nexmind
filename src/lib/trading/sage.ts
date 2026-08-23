// SAGE — the risk manager. Reviews HAWK's proposal independently and may VETO
// or tighten SL/TP before the Iron Rules get the final say.

import { callAgentJSON } from "@/lib/anthropic";
import type { ScanResult } from "./scanner";
import type { ProposedLevels } from "./hawk";
import { buildAnalystContext, renderContext, type AnalystContext } from "./context";

export interface SageVerdict {
  approved: boolean;
  reason: string;
  adjusted: ProposedLevels; // possibly-tightened levels (unchanged if no adjustment)
  costUsd: number;
}

const SAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    approved: { type: "boolean" },
    reason: { type: "string" },
    sl: { type: "number" },
    tp1: { type: "number" },
  },
  required: ["approved", "reason"],
};

const SYSTEM =
  "You are SAGE, the head of risk for a trading desk. The analysts want to enter a trade. " +
  "Your job is independent risk review: you may APPROVE, or VETO if risk is poor (bad R:R, " +
  "entering against a higher-timeframe trend, news risk, overextension). You may also tighten " +
  "the stop-loss or take-profit. You are conservative — 'enter few, enter accurate' beats churn. " +
  "Return JSON {approved, reason (one sentence), sl (optional adjusted), tp1 (optional adjusted)}.";

export async function runSage(
  scan: ScanResult,
  side: "long" | "short",
  levels: ProposedLevels,
  opts: { context?: AnalystContext; newsDigest?: string; lessons?: string } = {},
): Promise<SageVerdict> {
  // SAGE's brief names "entering against a higher-timeframe trend" as a veto
  // reason, but the prompt used to carry five spot indicators and no higher
  // timeframe at all — it could not have checked. It now reads the same facts
  // sheet the analysts voted on.
  const facts = renderContext(opts.context ?? buildAnalystContext(scan, { newsDigest: opts.newsDigest }));
  const prompt = [
    facts,
    "",
    `PROPOSAL — ${side} on ${scan.symbol} (${scan.timeframe}).`,
    `Entry ${levels.entry.toFixed(4)}, SL ${levels.sl.toFixed(4)}, TP1 ${levels.tp1.toFixed(4)}, TP2 ${levels.tp2 != null ? levels.tp2.toFixed(4) : "none (single-target — TP1 is the full exit)"}.`,
    opts.lessons ? `Lessons from past losses: ${opts.lessons}` : "",
    `Approve or veto, and optionally tighten SL/TP.`,
  ]
    .filter(Boolean)
    .join("\n");

  const r = await callAgentJSON<{ approved: boolean; reason: string; sl?: number; tp1?: number }>({
    tier: "opus", // risk gets the most capable model
    system: SYSTEM,
    prompt,
    maxTokens: 400,
    jsonSchema: SAGE_SCHEMA,
  });

  const adjusted: ProposedLevels = {
    entry: levels.entry,
    sl: validAdjust(r.data.sl, levels.sl, side, "sl", levels.entry),
    tp1: validAdjust(r.data.tp1, levels.tp1, side, "tp", levels.entry),
    tp2: levels.tp2,
    trail: levels.trail,
  };

  return { approved: r.data.approved, reason: r.data.reason, adjusted, costUsd: r.costUsd };
}

// Accept an adjusted level only if it's sane (correct side of entry); else keep original.
function validAdjust(v: number | undefined, fallback: number, side: "long" | "short", kind: "sl" | "tp", entry: number): number {
  if (v == null || !Number.isFinite(v)) return fallback;
  if (kind === "sl") return side === "long" ? (v < entry ? v : fallback) : (v > entry ? v : fallback);
  return side === "long" ? (v > entry ? v : fallback) : (v < entry ? v : fallback);
}
