// The worst overnight gap-down in a daily series. Moved here from the removed
// put-card code (2026-11-25); /portfolio's earnings section reads it.

import { GAP_MIN_SESSIONS } from "@/lib/advisor/gapRisk";
import type { Candle } from "@/lib/indicators";

/** Largest (prevClose − open) / prevClose over the series; null under GAP_MIN_SESSIONS measurable sessions. */
export function worstGapDownPct(candles: Candle[] | null): number | null {
  if (!candles) return null;
  let sessions = 0;
  let worst = 0;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].c;
    const open = candles[i].o;
    if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(open) || open <= 0) continue;
    sessions += 1;
    worst = Math.max(worst, (prev - open) / prev);
  }
  return sessions >= GAP_MIN_SESSIONS ? worst : null;
}
