// Bar hygiene shared by the research panel and the live provider router.
//
// It lives here rather than in research/panel.ts because the live path needs it
// too and must not import the panel: panel.ts reads a 180 MB cache file off disk
// and pulls fold arithmetic in behind it, none of which belongs in a scan tick.
// panel.ts re-exports both names, so its own callers and tests are unchanged.

import type { Candle } from "@/lib/indicators";

/**
 * A bar the provider emitted to fill a hole in its calendar, not a session that
 * traded: open, high, low and close all identical, and no volume.
 *
 * They are not rare and not harmless. The pinned S&P 500 cache carries 1,886 of
 * them across six names — PARA alone has 946, in a run of 652 consecutive
 * sessions, so roughly a third of its history is a flat line at one price. A
 * live 2y daily Webull pull carries up to 181 (WMT, measured 2026-08-30). A run
 * like that drives every range-based indicator to zero, and a zero-range ATR
 * turns an ATR-multiple stop into a division by ~1e-14. See MIN_RISK_FRACTION
 * in backtest/engine.ts for what that did to TEST2.
 *
 * Only the unambiguous shape is matched. A zero-range bar WITH volume can be a
 * real limit-up halt, and a zero-volume bar WITH range can be a stale-quote
 * artifact that still carries information; roughly 400 bars in the cache are one
 * or the other and are deliberately left alone. Guessing about those would be
 * the same class of mistake as keeping these.
 */
export function isPlaceholderBar(b: Candle): boolean {
  return b.o === b.h && b.h === b.l && b.l === b.c && !b.v;
}

/**
 * How small a flat bar's volume has to be, against the symbol's typical
 * session, before it is filler rather than a halt.
 *
 * MO's frozen weekly print traded 9,000 shares against a 29.6M average —
 * 0.03%, clearing this line by 30x. A genuine limit-up or halted session would
 * have to trade a hundredth of a normal week to be caught by it, which is why
 * the line sits far below anything a real session produces rather than close to
 * the case that prompted it.
 */
export const FROZEN_VOLUME_FRACTION = 0.01;

/** Median of the volumes that actually traded, or null when none did.
 *
 *  The median rather than the mean, and over traded bars only: PARA carries 652
 *  consecutive placeholder sessions, and an average taken across those collapses
 *  toward zero — which would raise the bar for nothing and let the next filler
 *  print straight through. */
function typicalVolume(bars: Candle[]): number | null {
  const vs = bars.map((b) => b.v).filter((v) => v > 0).sort((a, b) => a - b);
  if (!vs.length) return null;
  const mid = vs.length >> 1;
  return vs.length % 2 ? vs[mid] : (vs[mid - 1] + vs[mid]) / 2;
}

/**
 * Drop placeholder bars from one symbol's history.
 *
 * Two rules, because the second needs context the first cannot have.
 * isPlaceholderBar matches the unambiguous shape and is deliberately blind to
 * flat bars that carry volume — from one bar there is no telling a limit-up halt
 * from filler. Here the whole series is in hand, so "did this bar trade like the
 * others?" is answerable, and a flat print on a token fraction of typical size
 * is filler however non-zero its volume is.
 *
 * Dropping leaves a gap in the series, and the gap is the truth: the symbol was
 * not trading. Every consumer here is gap-tolerant already — indicators run on
 * bar index, foldSlice cuts on timestamp, and regime breadth counts per session
 * — so a name that vanishes for a stretch simply stops participating, which is
 * what actually happened. The alternative, interpolating a price nobody traded
 * at, would put invented history inside the folds a verdict is measured on.
 */
export function sanitizeSeries(bars: Candle[]): { candles: Candle[]; dropped: number } {
  const typical = typicalVolume(bars);
  const floor = typical == null ? 0 : typical * FROZEN_VOLUME_FRACTION;
  const isFrozenPrint = (b: Candle) => b.o === b.h && b.h === b.l && b.l === b.c && b.v < floor;

  let dropped = 0;
  const candles: Candle[] = [];
  for (const b of bars) {
    if (isPlaceholderBar(b) || isFrozenPrint(b)) dropped++;
    else candles.push(b);
  }
  return { candles, dropped };
}
