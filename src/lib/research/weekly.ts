// Daily bars, folded into weekly ones — the only variable that moves in
// docs/superpowers/specs/2026-09-08-weekly-bar-mechanism-screen-design.md.
//
// WHY RESAMPLE RATHER THAN FETCH
//
// .cache/bars/sp500-1d-deep.json (1998-01-02..2016-01-04) and
// .cache/bars/sp500-1d.json (2016-01-04..2026-08-14) abut exactly, are already
// sanitized on load, and are the series every existing number in this repo was
// measured on. Asking a provider for `1wk` instead would import a second set of
// split- and dividend-adjustment conventions and put that seam INSIDE the
// tradable data, where nothing downstream could see it.
//
// WHY THE WEEK IS BUCKETED OFF THE UTC DAY NUMBER
//
// The two caches stamp a session at different times of day — Alpaca at 05:00
// UTC (= 00:00 ET), Yahoo at 14:30 UTC (= 09:30 ET) — but both land on the
// session's correct UTC calendar date, so Math.floor(t / 86400) is the same day
// number for both and the bucketing is convention-independent. Epoch day 0
// (1970-01-01) was a Thursday, hence the +3 that moves week boundaries onto
// Monday.

import type { Candle } from "@/lib/indicators";
import type { Panel } from "./panel";

const SEC_PER_DAY = 86_400;

/** Epoch-week index. Weeks run Monday 00:00 UTC through Sunday 23:59 UTC. */
export function weekIndex(t: number): number {
  return Math.floor((Math.floor(t / SEC_PER_DAY) + 3) / 7);
}

/**
 * Fold a daily series into weekly bars.
 *
 * The weekly bar is stamped with its LAST daily bar's `t`, i.e. the session at
 * which it closed. That is what makes `entryAt: "open"` mean what the spec says:
 * the decision is taken at the close of week `i` (Friday 16:00 ET) and the fill
 * happens at the open of week `i+1` (Monday 09:30 ET).
 *
 * Short weeks are kept. A holiday week is a real week, and dropping it would
 * remove bars from the fold rather than from the resampler.
 */
export function toWeeklyBars(daily: Candle[]): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curWeek = NaN;

  for (const b of daily) {
    const w = weekIndex(b.t);
    if (!cur || w !== curWeek) {
      if (cur) out.push(cur);
      cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      curWeek = w;
      continue;
    }
    cur.t = b.t;
    cur.h = Math.max(cur.h, b.h);
    cur.l = Math.min(cur.l, b.l);
    cur.c = b.c;
    cur.v += b.v;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Warm-up prefix for a WEEKLY fold, in weekly bars.
 *
 * PANEL_WARMUP_BARS = 250 is a calendar year of daily bars and five years of
 * weekly ones, which no fold boundary in this repo can pay. 104 is two years —
 * comfortably past the point where a 14-period Wilder average has forgotten its
 * seed, above the engine's own WARMUP = 60 with margin, and exactly what the
 * deep cache can supply between DEEP_CACHE_START (1998-01-01) and deep1's
 * 2000-01-01 start, so the same constant serves both cache eras.
 */
export const WEEKLY_PANEL_WARMUP_BARS = 104;

const FIELDS = ["t", "o", "h", "l", "c", "v"] as const;

/**
 * The RESAMPLER CHECK, pre-registered in the design spec.
 *
 * A resampler that is wrong in a plausible way — an off-by-one on the week
 * boundary, a high taken from the wrong member — produces a corrupt panel that
 * runs cleanly and reports numbers. That failure would look exactly like a
 * discovery, which is the one shape this project cannot afford, so the weekly
 * series is re-derived from its daily source and compared field by field
 * rather than spot-checked.
 *
 * Throws on the first disagreement. Callers do not catch it: a failed assertion
 * must abort the run.
 */
export function assertWeeklyMatchesDaily(symbol: string, daily: Candle[], weekly: Candle[]): void {
  const groups = new Map<number, Candle[]>();
  const order: number[] = [];
  for (const b of daily) {
    const w = weekIndex(b.t);
    let g = groups.get(w);
    if (!g) {
      g = [];
      groups.set(w, g);
      order.push(w);
    }
    g.push(b);
  }

  if (weekly.length !== order.length) {
    throw new Error(`${symbol}: ${weekly.length} weekly bars from ${order.length} distinct weeks in the daily source`);
  }

  for (let k = 0; k < order.length; k++) {
    const g = groups.get(order[k])!;
    const w = weekly[k];
    const want: Candle = {
      t: g[g.length - 1].t,
      o: g[0].o,
      h: Math.max(...g.map((b) => b.h)),
      l: Math.min(...g.map((b) => b.l)),
      c: g[g.length - 1].c,
      v: g.reduce((a, b) => a + b.v, 0),
    };
    for (const f of FIELDS) {
      if (w[f] !== want[f]) {
        throw new Error(`${symbol}: weekly bar ${k} field ${f} is ${w[f]}, its daily source says ${want[f]}`);
      }
    }
    if (weekIndex(g[0].t) !== weekIndex(g[g.length - 1].t)) {
      throw new Error(`${symbol}: weekly bar ${k} spans a week boundary`);
    }
  }
}

/**
 * Resample a whole panel to weekly bars, asserting every symbol on the way.
 *
 * The assertion lives here rather than at the call site for the reason
 * loadPanel sanitizes on load: a check one script remembers to run is a check
 * that decides verdicts by which script ran.
 *
 * `cachePath` is suffixed `#weekly` so a pasted log identifies its own bar
 * class as well as its own data.
 */
export function weeklyPanel(panel: Panel): Panel {
  const bars: Record<string, Candle[]> = {};
  for (const symbol of panel.symbols) {
    const daily = panel.bars[symbol];
    if (!daily?.length) continue;
    const weekly = toWeeklyBars(daily);
    assertWeeklyMatchesDaily(symbol, daily, weekly);
    bars[symbol] = weekly;
  }

  const symbols = Object.keys(bars).sort();
  if (!symbols.length) throw new Error(`weeklyPanel: ${panel.cachePath} produced no weekly series`);

  return {
    fetchedAt: panel.fetchedAt,
    cachePath: `${panel.cachePath}#weekly`,
    symbols,
    bars,
    droppedBars: panel.droppedBars,
  };
}
