// Pure: which held tickers report earnings within the watch window. The clock
// and the per-ticker EarningsInfo are both supplied by the caller (route.ts /
// runRiskSentry.ts), same boundary as the rest of src/lib/riskSentry/.

import type { EarningsInfo } from "@/lib/advisor/types";

/** Proposed in the design spec §2.1: 3 calendar days. */
export const EARNINGS_WATCHDOG_DAYS = 3;

export interface EarningsWatchdogHit {
  ticker: string;
  date: string;
  hour: string | null;
  daysAway: number;
}

const MS_PER_DAY = 86_400_000;
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

export function earningsWatchdog(
  results: { ticker: string; earnings: EarningsInfo }[],
  today: Date,
  windowDays: number = EARNINGS_WATCHDOG_DAYS,
): EarningsWatchdogHit[] {
  const todayMs = Date.parse(isoDay(today));
  const hits: EarningsWatchdogHit[] = [];
  for (const { ticker, earnings } of results) {
    if (!earnings.date) continue;
    const daysAway = Math.round((Date.parse(earnings.date) - todayMs) / MS_PER_DAY);
    if (daysAway < 0 || daysAway > windowDays) continue;
    hits.push({ ticker, date: earnings.date, hour: earnings.hour, daysAway });
  }
  return hits;
}
