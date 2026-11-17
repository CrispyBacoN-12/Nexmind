// The scorecard's "rules vs buy-and-hold" series (info only, never part of the verdict).
// The same AI-kept fills two ways, both marked at each session's daily close: under the exit
// rules (a closed trade keeps its realized R from its exit date on, an open one is marked) and
// held forever with no stop, T1 or session cap. Pure.
// Spec: docs/superpowers/specs/2026-11-18-scorecard-rules-vs-hold-design.md

import type { Candle } from "@/lib/indicators";
import { etClock, etSessionCloseMs } from "@/lib/scanAgent/session";
import { rMultiple } from "./score";

/** One AI-kept filled setup. Epoch seconds; `closedR`/`exitAt` only when its hold outcome is closed. */
export interface HoldTrade {
  ticker: string;
  fill: number;
  fillAt: number;
  stop: number;
  closedR: number | null;
  exitAt: number | null;
}

/** Sums of R over the trades marked on `date` (`n` of them). */
export interface RulesVsHoldPoint {
  date: string;
  rules: number;
  hold: number;
  n: number;
}

const etDate = (sec: number) => etClock(sec).date;
const closesByDate = (bars: Candle[] | undefined) => new Map((bars ?? []).map((b) => [etDate(b.t), b.c]));

/**
 * One point per session of `calendarTicker` from the earliest fill date on, and only sessions
 * already closed at `cutoffSec` (a still-forming daily bar is never drawn as a close).
 *
 * `adjusted` (split + dividend adjusted) gives the marks; `raw` (as traded) pins each trade's
 * units: on its first session with both, factor = raw close / adjusted close, and every later
 * adjusted close times that factor is in the fill's own price units (total return, so a later
 * split or dividend does not move the mark). A trade counts from that session on; a missing
 * close carries the last one forward. Dates with no counted trade are omitted.
 */
export function rulesVsHoldSeries(
  trades: HoldTrade[],
  adjusted: Map<string, Candle[]>,
  raw: Map<string, Candle[]>,
  calendarTicker: string,
  cutoffSec: number,
): RulesVsHoldPoint[] {
  if (trades.length === 0) return [];
  const legs = trades.map((t) => ({
    t,
    fillDate: etDate(t.fillAt),
    exitDate: t.closedR !== null && t.exitAt !== null ? etDate(t.exitAt) : null,
    adj: closesByDate(adjusted.get(t.ticker)),
    raw: closesByDate(raw.get(t.ticker)),
    factor: null as number | null,
    last: null as number | null,
  }));
  const first = legs.reduce((m, l) => (l.fillDate < m ? l.fillDate : m), legs[0].fillDate);
  const calendar = [...new Set((adjusted.get(calendarTicker) ?? []).map((b) => etDate(b.t)))]
    .filter((d) => d >= first && etSessionCloseMs(d) <= cutoffSec * 1000)
    .sort();

  const out: RulesVsHoldPoint[] = [];
  for (const date of calendar) {
    let rules = 0;
    let hold = 0;
    let n = 0;
    for (const leg of legs) {
      if (date < leg.fillDate) continue;
      const a = leg.adj.get(date);
      if (leg.factor === null) {
        const r = leg.raw.get(date);
        if (a === undefined || r === undefined || a <= 0) continue;
        leg.factor = r / a;
      }
      if (a !== undefined) leg.last = a;
      if (leg.last === null) continue;
      const marked = rMultiple(leg.t.fill, leg.last * leg.factor, leg.t.stop);
      hold += marked;
      rules += leg.exitDate !== null && leg.exitDate <= date ? (leg.t.closedR as number) : marked;
      n++;
    }
    if (n > 0) out.push({ date, rules, hold, n });
  }
  return out;
}
