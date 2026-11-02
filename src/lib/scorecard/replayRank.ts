// The replay's stand-in for the live scan (spec §7): a TradingView-shaped row
// rebuilt from bars alone, as it would read at the replay cutoff (10:30 ET minus
// the SIP delay), and the scan's own filter + activity order over those rows.
//
// Pure: no I/O, no clock. Nothing after the cutoff is read: today's bars must
// have ENDED by it, and every daily input comes from earlier dates.
//
// Two bar bases. The intraday and daily bars are split- and dividend-ADJUSTED (the
// setup pipeline needs that), but adjusted volume before a split is multiplied by a
// ratio nobody knew yet, and adjusted prices are divided by it. The scan's floors
// (price, 10-day volume, ATR %) read as-traded numbers, so the row is put on the RAW
// basis: k = raw / adjusted close of the previous session; close and ATR are scaled
// by k (ATR % unchanged), the 10-day volume is the raw daily volume. Gap and rvol are
// ratios on one basis and stay as they are.
//
// The earnings and 8-K inputs do not exist historically, so they count 0
// (`earningsTag` null, no filings). The replay summary states this.

import type { Candle } from "@/lib/indicators";
import { etClock } from "@/lib/scanAgent/session";
import { activityScore, passesBase, triggersFor, volumeFor } from "@/lib/scanAgent/filter";
import type { TvRow } from "@/lib/scanAgent/types";
import { dailyAtr } from "@/lib/chartAgent/runChartAgent";
import { CHART_BAR_SECONDS, CHART_TOP_N } from "@/lib/chartAgent/types";

const OPEN_MIN = 570; // 09:30 ET
const CLOSE_MIN = 960; // 16:00 ET
const BAR_MIN = CHART_BAR_SECONDS / 60;
/** Prior sessions behind the rvol baseline and the 10-day average volume. */
const LOOKBACK_SESSIONS = 10;
/**
 * The live chart agent fetches daily bars with range "1mo" (31 days back from now),
 * and ATR14 is Wilder-smoothed, so its value depends on that window. The replay
 * hands `dailyAtr` the same window.
 */
const LIVE_DAILY_LOOKBACK_DAYS = 31;

/** One ET date's 5-minute bars, ascending. `regularMin[i]` is the ET minute `regular[i]` starts at. */
export interface DayBars {
  all: Candle[];
  regular: Candle[];
  regularMin: number[];
}

/** A ticker's 5-minute bars grouped by ET date; `dates` = dates with regular bars, ascending. */
export interface IntradayIndex {
  dates: string[];
  byDate: Map<string, DayBars>;
}

/** Daily bars ascending, with each bar's ET date. */
export interface DailyIndex {
  bars: Candle[];
  dates: string[];
}

/** Groups bars by ET date. One `etClock` per bar: build it once per ticker, not per session. */
export function indexIntraday(candles: Candle[]): IntradayIndex {
  const byDate = new Map<string, DayBars>();
  for (const c of [...candles].sort((a, b) => a.t - b.t)) {
    const { date, minutes } = etClock(c.t);
    let day = byDate.get(date);
    if (!day) byDate.set(date, (day = { all: [], regular: [], regularMin: [] }));
    day.all.push(c);
    if (minutes >= OPEN_MIN && minutes < CLOSE_MIN) {
      day.regular.push(c);
      day.regularMin.push(minutes);
    }
  }
  const dates = [...byDate.keys()].filter((d) => byDate.get(d)!.regular.length > 0).sort();
  return { dates, byDate };
}

export function indexDaily(daily: Candle[]): DailyIndex {
  const bars = [...daily].sort((a, b) => a.t - b.t);
  return { bars, dates: bars.map((b) => etClock(b.t).date) };
}

/** First index whose value is >= `key` (YYYY-MM-DD strings sort chronologically). */
export function lowerBound(sorted: string[], key: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The daily ATR the live chart agent would compute on `sessionDate`: `dailyAtr` over
 * the bars its "1mo" fetch returns. Bars dated on or after `sessionDate` are never
 * passed, so a later bar cannot leak in.
 */
export function replayDailyAtr(daily: DailyIndex, sessionDate: string): number {
  const from = lowerBound(daily.dates, addDays(sessionDate, -(LIVE_DAILY_LOOKBACK_DAYS - 1)));
  const to = lowerBound(daily.dates, sessionDate);
  return dailyAtr(daily.bars.slice(from, to), sessionDate);
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** `replayRow` on prebuilt indexes; the replay calls this once per (ticker, session). */
export function replayRowFromIndex(
  ticker: string,
  daily: DailyIndex,
  rawDaily: DailyIndex,
  intraday: IntradayIndex,
  sessionDate: string,
  cutoffSec: number,
): TvRow | null {
  const day = intraday.byDate.get(sessionDate);
  const finished = day ? day.regular.filter((b) => b.t + CHART_BAR_SECONDS <= cutoffSec) : [];
  if (finished.length === 0) return null;

  const priorDates = intraday.dates.slice(0, lowerBound(intraday.dates, sessionDate));
  const di = lowerBound(daily.dates, sessionDate);
  const ri = lowerBound(rawDaily.dates, sessionDate);
  if (priorDates.length < LOOKBACK_SESSIONS || di < LOOKBACK_SESSIONS || ri < LOOKBACK_SESSIONS) return null;

  // As-traded basis from the previous session's two closes.
  const prevAdj = daily.bars[di - 1];
  const prevRaw = rawDaily.bars[ri - 1];
  if (rawDaily.dates[ri - 1] !== daily.dates[di - 1] || !(prevAdj.c > 0) || !(prevRaw.c > 0)) return null;
  const k = prevRaw.c / prevAdj.c;

  // Relative volume: volume so far today against the mean of the same window
  // (bars that ended by the cutoff's ET minute) over the previous 10 sessions.
  const cutoffMin = etClock(cutoffSec).minutes;
  const volumeToday = finished.reduce((s, b) => s + b.v, 0);
  const baseline = mean(
    priorDates.slice(-LOOKBACK_SESSIONS).map((d) => {
      const p = intraday.byDate.get(d)!;
      let v = 0;
      for (let i = 0; i < p.regular.length; i++) if (p.regularMin[i] + BAR_MIN <= cutoffMin) v += p.regular[i].v;
      return v;
    }),
  );

  const prevClose = prevAdj.c;
  const atr = replayDailyAtr(daily, sessionDate) * k;

  return {
    ticker,
    exchange: "",
    type: "stock",
    close: finished[finished.length - 1].c * k,
    changePct: null,
    gapPct: ((finished[0].o - prevClose) / prevClose) * 100,
    premarketChangePct: null,
    premarketVolume: null,
    rvolIntraday: baseline > 0 ? volumeToday / baseline : null,
    rvol10d: null,
    avgVolume10d: mean(rawDaily.bars.slice(ri - LOOKBACK_SESSIONS, ri).map((b) => b.v)),
    atr: Number.isFinite(atr) ? atr : null,
    earningsLastAt: null,
    earningsLastTime: null,
    earningsNextAt: null,
    earningsNextTime: null,
  };
}

/**
 * The scan row `ticker` would have had on `sessionDate` at `cutoffSec`, on the
 * as-traded basis. `daily` and `intraday` are adjusted bars, `rawDaily` the same
 * daily bars unadjusted. Null when no regular bar of that session ended by the
 * cutoff, when fewer than 10 prior sessions (intraday, daily or raw daily) exist, or
 * when the raw bar of the previous session is missing (no basis to convert with).
 */
export function replayRow(
  ticker: string,
  daily: Candle[],
  rawDaily: Candle[],
  intraday: Candle[],
  sessionDate: string,
  cutoffSec: number,
): TvRow | null {
  return replayRowFromIndex(
    ticker,
    indexDaily(daily),
    indexDaily(rawDaily),
    indexIntraday(intraday),
    sessionDate,
    cutoffSec,
  );
}

/**
 * The live scan's filter and order during the session: base floors, at least one
 * trigger, `activityScore` descending (no earnings tag, no filings). Ties break on
 * the ticker so the pick never depends on input order.
 */
export function pickTopN(rows: TvRow[], n: number = CHART_TOP_N): string[] {
  return rows
    .filter((r) => passesBase(r) && triggersFor(r, "open", null).length > 0)
    .map((r) => ({ ticker: r.ticker, score: activityScore(r.gapPct, volumeFor(r, "open"), null, []) }))
    .sort((a, b) => b.score - a.score || (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0))
    .slice(0, n)
    .map((r) => r.ticker);
}
