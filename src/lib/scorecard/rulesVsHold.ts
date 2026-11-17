// The scorecard's "rules vs buy-and-hold" series (info only, never part of the verdict).
// The same AI-kept fills two ways, both marked at each session's daily close: under the exit
// rules (a closed trade keeps its realized R from its exit date on, an open one is marked) and
// held forever with no stop, T1 or session cap. Pure.
// Spec: docs/superpowers/specs/2026-11-18-scorecard-rules-vs-hold-design.md

import type { Candle } from "@/lib/indicators";
import { etClock } from "@/lib/scanAgent/session";
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

/**
 * One point per session of `calendarTicker` from the earliest fill date on. A trade counts from
 * its fill date once its ticker has a daily close on or after that date; a missing close carries
 * the last one forward. Dates with no counted trade are omitted.
 */
export function rulesVsHoldSeries(trades: HoldTrade[], daily: Map<string, Candle[]>, calendarTicker: string): RulesVsHoldPoint[] {
  if (trades.length === 0) return [];
  const legs = trades.map((t) => ({
    t,
    fillDate: etDate(t.fillAt),
    exitDate: t.closedR !== null && t.exitAt !== null ? etDate(t.exitAt) : null,
    closes: new Map((daily.get(t.ticker) ?? []).map((b) => [etDate(b.t), b.c])),
    last: null as number | null,
  }));
  const first = legs.reduce((m, l) => (l.fillDate < m ? l.fillDate : m), legs[0].fillDate);
  const calendar = [...new Set((daily.get(calendarTicker) ?? []).map((b) => etDate(b.t)))].filter((d) => d >= first).sort();

  const out: RulesVsHoldPoint[] = [];
  for (const date of calendar) {
    let rules = 0;
    let hold = 0;
    let n = 0;
    for (const leg of legs) {
      if (date < leg.fillDate) continue;
      const close = leg.closes.get(date);
      if (close !== undefined) leg.last = close;
      if (leg.last === null) continue;
      const marked = rMultiple(leg.t.fill, leg.last, leg.t.stop);
      hold += marked;
      rules += leg.exitDate !== null && leg.exitDate <= date ? (leg.t.closedR as number) : marked;
      n++;
    }
    if (n > 0) out.push({ date, rules, hold, n });
  }
  return out;
}
