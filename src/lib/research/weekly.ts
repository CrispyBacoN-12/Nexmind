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
