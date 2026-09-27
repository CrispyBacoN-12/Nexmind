// Priority-queue slot filling for one session. Pure.
//
// Candidates are taken highest score first (ticker breaks ties, so the order
// is total and the result deterministic) and each is run through
// evaluatePortfolio in strictMode against the book AS FILLED SO FAR — a name
// accepted earlier in the same session counts toward capacity, sector,
// correlation and heat for every name after it.
//
// Test B's treatment and control share this function and differ only in the
// scores: residual-momentum rank for the treatment, a seeded shuffle for the
// control.

import { evaluatePortfolio } from "./evaluate";
import type { CandidateTrade, GateName, PortfolioEvaluationInput, PortfolioSlot } from "./types";

export interface RankedCandidate extends CandidateTrade {
  score: number;
}

export type AllocationContext = Omit<PortfolioEvaluationInput, "slots" | "candidate" | "correlations" | "strictMode" | "overrides"> & {
  slots: PortfolioSlot[];
  /** 60-session return correlation of two tickers; null when unmeasurable. */
  correlationOf: (a: string, b: string) => number | null;
};

export interface AllocationResult {
  /** The book after this session's fills. */
  slots: PortfolioSlot[];
  accepted: Array<{ ticker: string; shares: number; score: number }>;
  rejected: Array<{ ticker: string; score: number; blockedBy: GateName[] }>;
}

export function byScoreDesc(a: RankedCandidate, b: RankedCandidate): number {
  return b.score - a.score || (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);
}

export function allocateSlots(ctx: AllocationContext, candidates: RankedCandidate[]): AllocationResult {
  const slots = [...ctx.slots];
  const accepted: AllocationResult["accepted"] = [];
  const rejected: AllocationResult["rejected"] = [];

  for (const c of [...candidates].filter((c) => Number.isFinite(c.score)).sort(byScoreDesc)) {
    const correlations: Record<string, number | null> = {};
    for (const s of slots) correlations[s.ticker] = ctx.correlationOf(c.ticker, s.ticker);
    const out = evaluatePortfolio({ ...ctx, slots, candidate: c, correlations, strictMode: true });
    if (!out.canExecute) {
      rejected.push({ ticker: c.ticker, score: c.score, blockedBy: out.blockedBy });
      continue;
    }
    slots.push({ ticker: c.ticker, sector: c.sector, shares: out.suggestedShares, entry: c.entry, stop: c.stop, worstLossR: c.worstLossR });
    accepted.push({ ticker: c.ticker, shares: out.suggestedShares, score: c.score });
  }
  return { slots, accepted, rejected };
}
