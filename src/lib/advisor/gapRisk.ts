// Gap-through risk: how far past a stop this ticker has opened, measured in
// units of the stop the card is about to recommend.
//
// Why this exists. Everything else on the card assumes a stop fills AT the stop,
// so a loss is -1R. A long held overnight into bad news opens below the stop and
// fills at the open — the backtest engine never modelled that either
// (positionRules books every loss at `t.sl`). Sizing by 1R without it is hidden
// leverage, and the card is the one place in this repo where real money is sized.
//
// The measurement, per session t (long side only — the card only sizes longs):
//
//   G_t = max(0, Close_{t-1} - Open_t) / (ADVISOR_ATR_SL_MULT * ATR_{t-1})
//
// i.e. the overnight adverse gap in units of the stop that would have been set
// the evening before. Normalising by that evening's ATR rather than by today's
// stop in dollars keeps the series comparable across a split, a doubling, or a
// volatility regime change. ATR_{t-1}, never ATR_t: bar t's true range includes
// the gap itself, so ATR_t would shrink every gap it is dividing.
//
// What G means for a loss depends on where the position sits when it happens:
//   * sitting at entry            -> loss = G R        (exceeds 1R only if G > 1)
//   * sitting just above the stop -> loss = 1 + G R    (the worst case, and the one quoted)
//
// This is a record of the sample, not a forecast: two years hold roughly eight
// earnings reports, and a ticker's worst-ever gap is usually not in its last two
// years. The worst number here is a floor on the tail, not a ceiling.
//
// Pure.

import { atr, type Candle } from "@/lib/indicators";

import { ADVISOR_ATR_PERIOD, ADVISOR_ATR_SL_MULT, type GapRisk } from "./types";

/** Candle.t is epoch SECONDS, not milliseconds. */
function barDate(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

/**
 * Fewer measurable sessions than this and the card says "not enough history"
 * instead of printing a worst case drawn from a handful of nights. 60 is about
 * a quarter, i.e. at least one earnings report is likely inside it.
 */
export const GAP_MIN_SESSIONS = 60;

export function gapRisk(
  candles: Candle[] | null | undefined,
  slMult: number = ADVISOR_ATR_SL_MULT,
  period: number = ADVISOR_ATR_PERIOD,
): GapRisk | null {
  if (!candles || candles.length < 2) return null;
  const atrs = atr(candles, period);

  let sessions = 0;
  let worstStops = 0;
  let worstDate: string | null = null;
  let overHalfStop = 0;
  let overOneStop = 0;

  for (let t = 1; t < candles.length; t++) {
    const prevAtr = atrs[t - 1];
    const prevClose = candles[t - 1].c;
    const open = candles[t].o;
    if (prevAtr == null || !Number.isFinite(prevAtr) || prevAtr <= 0) continue;
    if (!Number.isFinite(prevClose) || !Number.isFinite(open) || open <= 0) continue;

    sessions += 1;
    const g = Math.max(0, prevClose - open) / (slMult * prevAtr);
    if (g >= 0.5) overHalfStop += 1;
    if (g >= 1) overOneStop += 1;
    if (g > worstStops) {
      worstStops = g;
      worstDate = barDate(candles[t].t);
    }
  }

  if (sessions < GAP_MIN_SESSIONS) return null;

  return {
    sessions,
    from: barDate(candles[0].t),
    to: barDate(candles[candles.length - 1].t),
    worstStops,
    worstDate,
    worstLossR: 1 + worstStops,
    overHalfStop,
    overOneStop,
  };
}
