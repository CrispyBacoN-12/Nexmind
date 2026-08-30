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
 * Drop placeholder bars from one symbol's history.
 *
 * Dropping leaves a gap in the series, and the gap is the truth: the symbol was
 * not trading. Every consumer here is gap-tolerant already — indicators run on
 * bar index, foldSlice cuts on timestamp, and regime breadth counts per session
 * — so a name that vanishes for a stretch simply stops participating, which is
 * what actually happened. The alternative, interpolating a price nobody traded
 * at, would put invented history inside the folds a verdict is measured on.
 */
export function sanitizeSeries(bars: Candle[]): { candles: Candle[]; dropped: number } {
  let dropped = 0;
  const candles: Candle[] = [];
  for (const b of bars) {
    if (isPlaceholderBar(b)) dropped++;
    else candles.push(b);
  }
  return { candles, dropped };
}
