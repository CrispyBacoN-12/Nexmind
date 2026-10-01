// Pure: did an open journal position's last daily bar reach its stop? Orders are
// entered by hand (no broker API), so nothing else tells the owner a stop was hit.
// Long only — journalInput.ts rejects a stop at or above entry.
// Assumes the last bar is a finished session: vercel.json fires the cron at 12:00 UTC,
// before the US open. Run mid-session and "closed" describes a still-forming bar.

import type { Candle } from "@/lib/indicators";

/** "breached": closed at/below the stop — exit by hand if no stop order is resting.
 *  "touched": traded through intraday but closed above — check whether the stop order filled. */
export type StopWatchKind = "breached" | "touched";

export interface StopWatchHit {
  ticker: string;
  stop: number;
  low: number;
  close: number;
  /** YYYY-MM-DD of the bar checked (UTC). */
  date: string;
  kind: StopWatchKind;
}

export function stopWatch(
  positions: { ticker: string; stop: number }[],
  candlesByTicker: Map<string, Candle[] | null>,
): StopWatchHit[] {
  const hits: StopWatchHit[] = [];
  for (const p of positions) {
    const candles = candlesByTicker.get(p.ticker);
    const last = candles && candles.length > 0 ? candles[candles.length - 1] : null;
    if (!last || last.l > p.stop) continue;
    hits.push({
      ticker: p.ticker,
      stop: p.stop,
      low: last.l,
      close: last.c,
      date: new Date(last.t * 1000).toISOString().slice(0, 10),
      kind: last.c <= p.stop ? "breached" : "touched",
    });
  }
  return hits;
}
