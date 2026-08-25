// The market gate: how many NEW positions the desk may open, given the state of
// the market rather than the state of any one setup.
//
// WHAT THIS SHIPS, AND WHY IT IS ONLY ONE LEG
//
// The gate was measured before it was written (scripts/regime-conditional.mts,
// output in scripts/regime-conditional.log). Every trade the desk's own
// trend-pullback rule produced across all five panel folds — 91,236 of them —
// was bucketed by the market state on the morning it opened. Three candidate
// features went in. One came out:
//
//   SPY vs its own SMA200        avgR above / below
//     FIT    2016-2018            +0.017 / -0.071
//     SELECT 2019                 +0.002 / -0.293
//     TEST1  2020-2021            +0.012 / -0.004
//     TEST2  2022-2023            +0.018 / -0.077
//     TEST3  2024-2026            -0.004 / -0.109
//
// Five folds, same sign every time. Breadth (share of names above their own
// SMA200) and 20-day realized vol both FAILED: breadth is monotone in FIT and
// then inverts in SELECT and TEST3, and neither survives the thing that killed
// them both — the FIT-derived cut points do not transfer. The breadth quintile
// that held 17% of FIT's trades holds 79% of TEST2's, and 0% of its top bucket;
// the vol quintiles shift just as far. An absolute threshold fitted on
// 2016-2018 is measuring a different market by 2022.
//
// That is also the reason the surviving leg survived: "above its own trailing
// mean" has NO free parameter to fit. It is self-normalising, so it means the
// same thing in every regime. The two features with a number in them are the two
// that died. Keep that in mind before adding a third.
//
// WHAT IT IS WORTH — state this whenever the gate is quoted
//
// The gate does not create an edge; it removes a loss. Restricting to
// above-trend sessions moves fold avgR from {-0.003, -0.034, +0.010, -0.024,
// -0.014} to {+0.017, +0.002, +0.012, +0.018, -0.004}. That is ~0 becoming ~0.
// TEST3 is still negative with the gate on. Nothing here turns trend-pullback
// into a profitable rule.
//
// And the sample is far smaller than the trade counts suggest. Five folds of ONE
// benchmark series are not five independent observations: the gate's variable
// changes only when SPY crosses its 200-day mean, which happened on the order of
// a dozen times in 2016-2026. Twelve episodes all pointing one way is decent
// evidence. It is not 91,236 trades of evidence, and the trade counts must never
// be quoted as though it were.
//
// Pure: the decision function takes bars and returns a number. The DB and the
// network live in readMarketGate() at the bottom.

import { sma, type Candle } from "@/lib/indicators";
import { BENCHMARK, TREND_PERIOD } from "./regime";

export interface MarketGateConfig {
  /** off = the gate reports its reading and changes nothing */
  enabled: boolean;
  /**
   * New positions allowed while the benchmark is below its own SMA200.
   *
   * 0 is the measurement's own shape — below-trend avgR is negative in all five
   * folds, so there is no fold in which those trades paid — and it is NOT a
   * fitted fraction. The evidence supports the SIGN. Any value strictly between
   * 0 and the free-slot count would be a number nobody measured, so if this is
   * changed, change it for a stated risk-appetite reason and say so, rather than
   * presenting it as what the folds showed.
   */
  slotsBelowTrend: number;
}

export const DEFAULT_MARKET_GATE: MarketGateConfig = { enabled: true, slotsBelowTrend: 0 };

/** DB key for the manual override. Anything other than "off" leaves the gate on. */
export const MARKET_GATE_SETTING = "marketGate";

export interface GateDecision {
  /** new positions permitted this scan — never more than the caller already had free */
  slots: number;
  /** the reading itself, reported even when `enabled` is false */
  benchAbove: boolean | null;
  /** one line for the scan log; the gate must never reduce slots silently */
  note: string;
}

/**
 * Decide the new-position budget from the benchmark's own bars.
 *
 * Fails OPEN — an unreadable benchmark returns the caller's slots untouched,
 * with a warning in `note`. This is the opposite of how the research gates fail,
 * and deliberately so: those decide whether a strategy is trustworthy, where the
 * expensive error is admitting a bad one. This decides whether the desk trades
 * today, where the expensive error is a data outage quietly halting the desk for
 * a week while every log line still reads "no setups". A filter whose whole
 * measured effect is removing a small loss does not get to stop the desk when it
 * cannot see. It does get to be loud about it.
 */
export function gateSlots(
  benchmark: Candle[],
  freeSlots: number,
  cfg: MarketGateConfig = DEFAULT_MARKET_GATE,
): GateDecision {
  const closes = benchmark.map((b) => b.c);
  const ma = sma(closes, TREND_PERIOD);
  const last = ma.length - 1;
  const trend = last >= 0 ? ma[last] : null;

  if (trend == null || !Number.isFinite(trend)) {
    return {
      slots: freeSlots,
      benchAbove: null,
      note:
        `market gate BLIND — ${BENCHMARK} returned ${benchmark.length} bar(s), needs ${TREND_PERIOD}; ` +
        `passing ${freeSlots} slot(s) through ungated`,
    };
  }

  const close = closes[last];
  const above = close > trend;
  const reading = `${BENCHMARK} ${close.toFixed(2)} ${above ? ">" : "<"} SMA${TREND_PERIOD} ${trend.toFixed(2)}`;

  if (!cfg.enabled) {
    return { slots: freeSlots, benchAbove: above, note: `market gate OFF (${reading}) — ${freeSlots} slot(s) unchanged` };
  }
  if (above) {
    return { slots: freeSlots, benchAbove: true, note: `market gate risk-on (${reading}) — ${freeSlots} slot(s)` };
  }

  const slots = Math.max(0, Math.min(freeSlots, cfg.slotsBelowTrend));
  return {
    slots,
    benchAbove: false,
    note: `market gate risk-off (${reading}) — ${freeSlots} free slot(s) cut to ${slots}`,
  };
}

/**
 * The live reading: fetch the benchmark's daily history and apply the gate.
 *
 * Daily bars regardless of the desk's own scan timeframe. The measurement was
 * made on SPY's daily SMA200 and means nothing on another series — a "200-period
 * mean" of hourly bars is eight trading days, which is not the same object and
 * was never tested.
 */
export async function readMarketGate(
  freeSlots: number,
  deps: {
    fetchCandles: (symbol: string, range: "2y", interval: "1d", minDays: number) => Promise<{ candles: Candle[] }>;
    getSetting: (key: string, fallback: string) => Promise<string>;
  },
): Promise<GateDecision> {
  const enabled = (await deps.getSetting(MARKET_GATE_SETTING, "on")) !== "off";
  const cfg: MarketGateConfig = { ...DEFAULT_MARKET_GATE, enabled };

  let bars: Candle[] = [];
  try {
    // minDays 300: SMA200 needs 200 SESSIONS, and 200 sessions is ~290 calendar
    // days. Asking for 200 days would silently return a series one third short,
    // which gateSlots would then read as BLIND — the same silent-truncation
    // failure that made every intraday blind test fail for weeks (STATE.md §3).
    bars = (await deps.fetchCandles(BENCHMARK, "2y", "1d", 300)).candles;
  } catch (e) {
    return {
      slots: freeSlots,
      benchAbove: null,
      note: `market gate BLIND — ${BENCHMARK} fetch failed (${e instanceof Error ? e.message : String(e)}); passing ${freeSlots} slot(s) through ungated`,
    };
  }
  return gateSlots(bars, freeSlots, cfg);
}
