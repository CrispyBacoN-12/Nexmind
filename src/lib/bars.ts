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
 * The typical number of CALENDAR days between consecutive bars, or null for a
 * series too short to have a spacing.
 *
 * This exists to catch a silent corruption sanitizeSeries structurally cannot:
 * Yahoo's `/v8/finance/chart` treats `interval` as a request, not a contract,
 * and over a long `range` it quietly serves weekly, monthly or quarterly bars
 * under `interval=1d` — AAPL over `range=max` returns 169 bars for 42 years.
 * Every one of those bars is a real, well-formed, correctly adjusted session
 * aggregate, so no per-bar check can reject them; the only evidence of the
 * downgrade is the SPACING between them. A panel built from such a series would
 * run every indicator, every fold and every control without complaint and report
 * numbers for a strategy nobody could trade.
 *
 * The MEDIAN, so a real market closure cannot move it: daily US equity bars sit
 * 1 day apart Tuesday to Friday and 3 across a weekend, giving a median of 1,
 * and the September 2001 four-session closure is one gap in four thousand.
 */
export function medianBarSpacingDays(bars: Candle[]): number | null {
  if (bars.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < bars.length; i++) gaps.push((bars[i].t - bars[i - 1].t) / 86_400);
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/**
 * Loosest spacing a series may have and still be daily bars.
 *
 * A weekend puts 3 calendar days between Friday and Monday, so a genuinely daily
 * series can have a median of 1 and never more than 3. Weekly bars land at 7.
 * Four sits in the empty space between the two, far from both.
 */
export const MAX_DAILY_BAR_SPACING = 4;

/**
 * Tightest spacing a series may have and still be daily bars.
 *
 * The upper bound alone is not a resolution check, it is half of one. Anything
 * below a day also satisfies `<= 4`: intraday bars (a 1h series has a median
 * spacing of ~0.04), duplicate timestamps (0), and a series handed to us newest
 * -first, whose gaps are all NEGATIVE. sanitizeSeries filters bars but does not
 * order them, so reverse order is a shape this function really can receive.
 * Half a day sits below any daily series and above every intraday one.
 */
export const MIN_DAILY_BAR_SPACING = 0.5;

/** Does this series actually have the daily resolution it claims? See medianBarSpacingDays. */
export function isDailySeries(bars: Candle[]): boolean {
  const spacing = medianBarSpacingDays(bars);
  return spacing != null && spacing >= MIN_DAILY_BAR_SPACING && spacing <= MAX_DAILY_BAR_SPACING;
}

/**
 * How far an intraday series' median spacing may sit from the resolution it
 * claims, as a multiple of that resolution.
 *
 * The band has to be narrower than the tightest step between two adjacent MT5
 * timeframes, or a downgrade lands inside it and passes. That step is 2x
 * (M15 to M30, and M30 to H1); everything else is 3x or wider. So the upper
 * bound sits at 1.5 and the lower at 0.75 — a series served one timeframe
 * coarser reads 2.0 and is rejected, one finer reads 0.5 and is rejected, and
 * neither bound is close enough to 1 for ordinary feed noise to trip it.
 */
export const INTRADAY_SPACING_TOLERANCE = { min: 0.75, max: 1.5 };

/**
 * Does this series actually have the intraday resolution it claims?
 *
 * The daily version of this check exists because Yahoo silently downgrades
 * `interval` over a long `range`. An MT5 broker can hand back the same shape for
 * a different reason: a timeframe the server has no history for is not an error,
 * it is a shorter answer, and one assembled from whatever it does hold. Either
 * way the bars are individually well-formed and only the spacing between them
 * says what happened.
 *
 * The median, and only the median, for the reason medianBarSpacingDays gives:
 * a 24/5 instrument puts a ~49-hour gap between Friday's last bar and Sunday's
 * first, which on H1 is one gap in about 120. A mean would be dragged by it; the
 * median is not. That also means this answers "what resolution is this?" and NOT
 * "is this series complete" — a feed missing a third of its bars still has the
 * right median. Completeness is a separate count, and the probe reports it
 * separately.
 */
export function isIntradaySeries(bars: Candle[], expectedMinutes: number): boolean {
  if (!(expectedMinutes > 0)) return false;
  const spacing = medianBarSpacingDays(bars);
  if (spacing == null) return false;
  const expected = expectedMinutes / 1440;
  return (
    spacing >= expected * INTRADAY_SPACING_TOLERANCE.min &&
    spacing <= expected * INTRADAY_SPACING_TOLERANCE.max
  );
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
