// Pure: the pairwise holdings-vs-holdings correlation matrix. Deliberately not
// advise()'s correlation leg, which is ticker-vs-holding, not holding-vs-holding
// — see docs/superpowers/specs/2026-09-16-risk-sentry-design.md §1.2.

import type { Candle } from "@/lib/indicators";
import { dailyReturns, pearsonCorrelation } from "@/lib/trading/correlation";

/** Deliberately looser than positionSizing.ts's corrMultiplierFor 0.8 sizing
 *  cutoff — this is a heads-up, not a sizing decision. */
export const CORRELATION_ALERT_THRESHOLD = 0.75;

export interface CorrelationAlertPair {
  a: string;
  b: string;
  correlation: number;
}

export function correlationAlert(
  holdings: { ticker: string; candles: Candle[] | null }[],
  threshold: number = CORRELATION_ALERT_THRESHOLD,
): CorrelationAlertPair[] {
  const returns = holdings.map((h) => (h.candles ? dailyReturns(h.candles) : null));
  const pairs: CorrelationAlertPair[] = [];
  for (let i = 0; i < holdings.length; i++) {
    const ri = returns[i];
    if (!ri) continue;
    for (let j = i + 1; j < holdings.length; j++) {
      const rj = returns[j];
      if (!rj) continue;
      const corr = pearsonCorrelation(ri, rj);
      if (corr != null && corr >= threshold) {
        pairs.push({ a: holdings[i].ticker, b: holdings[j].ticker, correlation: corr });
      }
    }
  }
  return pairs;
}
