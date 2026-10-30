// Base rate: how often THIS ticker reached each rung of the card's R ladder
// before its 1.5 x ATR stop, if a long had been opened at the close of every
// session in the sample.
//
// What it is. The card's geometry (stop at 1.5 x ATR14 below a close, targets
// at whole and half R above it) replayed from every eligible close in the two
// years the route already pulls, walked forward at most BASE_RATE_HORIZON
// sessions. Every close, not a random draw: there is no seed to choose and the
// number reproduces from the candles alone.
//
// What it is NOT. It is not an edge and not a forecast. An entry on every
// session is the zero-information entry this project's controls are built
// from, so whatever it shows is the stock's own drift and volatility over the
// sample. A ticker that rose over two years will read "target first" more often
// than its break-even line for that reason alone — the trap docs/STATE.md §5
// opens with. It answers "what does this geometry usually do on this name",
// which is a question about the stop and the ladder, never about whether to buy.
//
// Fill conventions, chosen to never flatter the target:
//   * entry at the close of session i; walking starts at session i+1
//   * an open at or below the stop is a stop-out (gap-through)
//   * an open at or above the target is a target hit
//   * a session that touches both is counted as stop first, and counted
//   * windows that run past the last bar are dropped, not truncated, so a
//     recent entry cannot count as "neither" for lack of future bars
//
// Overlapping windows: consecutive entries share most of their path, so the
// entry count overstates the independent sample several times over. The card
// says so next to the number.
//
// Pure.

import { atr, type Candle } from "@/lib/indicators";

import { ADVISOR_ATR_PERIOD, ADVISOR_ATR_SL_MULT, ADVISOR_R_STEPS, type BaseRate, type BaseRateRow } from "./types";

/** About a month of sessions. Longer than that is no longer the trade the card sized. */
export const BASE_RATE_HORIZON = 20;

/** Below this many entries the card says "not enough history" instead of a percentage. */
export const BASE_RATE_MIN_ENTRIES = 100;

/** Candle.t is epoch SECONDS, not milliseconds. */
function barDate(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

type Outcome = "target" | "stop" | "open";

/** Walk one entry forward against one target. `bothSameBar` is set when a session touched both. */
function walk(
  candles: Candle[],
  i: number,
  stop: number,
  target: number,
  horizon: number,
): { outcome: Outcome; bothSameBar: boolean } {
  for (let k = i + 1; k <= i + horizon; k++) {
    const b = candles[k];
    if (b.o <= stop) return { outcome: "stop", bothSameBar: false };
    if (b.o >= target) return { outcome: "target", bothSameBar: false };
    const hitStop = b.l <= stop;
    const hitTarget = b.h >= target;
    if (hitStop) return { outcome: "stop", bothSameBar: hitTarget };
    if (hitTarget) return { outcome: "target", bothSameBar: false };
  }
  return { outcome: "open", bothSameBar: false };
}

export function baseRate(
  candles: Candle[] | null | undefined,
  rSteps: readonly number[] = ADVISOR_R_STEPS,
  horizon: number = BASE_RATE_HORIZON,
  slMult: number = ADVISOR_ATR_SL_MULT,
  period: number = ADVISOR_ATR_PERIOD,
): BaseRate | null {
  if (!candles || candles.length < period + horizon + 2) return null;
  const atrs = atr(candles, period);

  const entries: number[] = [];
  for (let i = 0; i + horizon < candles.length; i++) {
    const a = atrs[i];
    if (a == null || !Number.isFinite(a) || a <= 0 || !(candles[i].c > 0)) continue;
    entries.push(i);
  }
  if (entries.length < BASE_RATE_MIN_ENTRIES) return null;

  let sameBarBoth = 0;
  const rows: BaseRateRow[] = rSteps.map((r, ri) => {
    let target = 0;
    let stop = 0;
    let open = 0;
    for (const i of entries) {
      const entry = candles[i].c;
      const sl = slMult * (atrs[i] as number);
      const w = walk(candles, i, entry - sl, entry + r * sl, horizon);
      if (w.outcome === "target") target++;
      else if (w.outcome === "stop") stop++;
      else open++;
      // Count ambiguity once, on the first rung, so it is a count of sessions-like events, not of rungs.
      if (ri === 0 && w.bothSameBar) sameBarBoth++;
    }
    const n = entries.length;
    return {
      r,
      targetFirstPct: (target / n) * 100,
      stopFirstPct: (stop / n) * 100,
      openPct: (open / n) * 100,
      breakEvenPct: (1 / (1 + r)) * 100,
    };
  });

  const first = candles[entries[0]];
  const lastEntry = candles[entries[entries.length - 1]];
  const last = candles[candles.length - 1];
  return {
    entries: entries.length,
    horizon,
    from: barDate(first.t),
    to: barDate(lastEntry.t),
    sameBarBoth,
    buyHoldPct: ((last.c - first.c) / first.c) * 100,
    rows,
  };
}
