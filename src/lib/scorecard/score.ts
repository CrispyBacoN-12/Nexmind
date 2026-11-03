// Score one chart-agent setup as if it had been bought: where it fills, and the
// first thing that ends it. Pure: no I/O, no clock (the caller passes `cutoffSec`).
//
// Rules (spec §5):
//  - Only FINISHED regular-session bars are read (t + 300 <= cutoffSec, 09:30-16:00 ET).
//  - Fill = the open of the first such bar on the run's ET date with t >= runAtSec.
//  - The fill bar's own high and low count. One bar touching both is a stop.
//  - The first regular bar of every later session that opens at/below the stop
//    exits at that open; one that opens at/above T1 exits at that open.
//  - `hold` closes on time at the 10th session's last regular close; `sameDay`
//    at the entry day's. A session is complete once the cutoff passes its 16:00 ET.
//  - Sessions are dates that have regular bars, so a holiday never counts.

import type { Candle } from "@/lib/indicators";
import type { CostModel } from "@/lib/backtest/engine";
import { etClock, etSessionCloseMs } from "@/lib/scanAgent/session";
import { CHART_BAR_SECONDS } from "@/lib/chartAgent/types";
import {
  SCORECARD_COST_MODEL,
  SCORECARD_MAX_HOLD_SESSIONS,
  type ExitReason,
  type ExitVariant,
  type Outcome,
} from "./types";

const OPEN_MIN = 570; // 09:30 ET
const CLOSE_MIN = 960; // 16:00 ET

export interface ScoreInput {
  runAtSec: number;
  stop: number;
  t1: number;
  /** May hold extended hours and other days; only finished regular bars are read. */
  bars: Candle[];
  cutoffSec: number;
  variant: ExitVariant;
  /** Defaults to the research cost model. */
  costs?: CostModel;
}

const NO_FILL: Outcome = {
  status: "open",
  fillAt: null,
  fill: null,
  exitAt: null,
  exitPrice: null,
  exitReason: null,
  r: null,
  sessionsHeld: 0,
};

/**
 * R of a long bought at `fill` and sold at `exit` (raw prices) against `stop`: slippage
 * on both fills and the round-turn commission on entry notional.
 */
export function rMultiple(fill: number, exit: number, stop: number, costs: CostModel = SCORECARD_COST_MODEL): number {
  const s = (costs.slippageBps ?? 0) / 1e4;
  const c = (costs.commissionBps ?? 0) / 1e4;
  const entryPx = fill * (1 + s);
  const exitPx = exit * (1 - s);
  return (exitPx - entryPx - c * entryPx) / (entryPx - stop);
}

export function scoreSetup(input: ScoreInput): Outcome {
  const { runAtSec, stop, t1, cutoffSec, variant } = input;
  const costs = input.costs ?? SCORECARD_COST_MODEL;

  // Finished regular-session bars only, in time order, grouped by ET date.
  const sessions = new Map<string, Candle[]>();
  const finished = input.bars
    .filter((b) => b.t + CHART_BAR_SECONDS <= cutoffSec)
    .sort((a, b) => a.t - b.t);
  for (const b of finished) {
    const { date, minutes } = etClock(b.t);
    if (minutes < OPEN_MIN || minutes >= CLOSE_MIN) continue;
    const day = sessions.get(date);
    if (day) day.push(b);
    else sessions.set(date, [b]);
  }

  const complete = (date: string) => cutoffSec * 1000 >= etSessionCloseMs(date);

  const runDate = etClock(runAtSec).date;
  const fillIdx = (sessions.get(runDate) ?? []).findIndex((b) => b.t >= runAtSec);
  if (fillIdx < 0) {
    return complete(runDate) ? { ...NO_FILL, status: "not_filled" } : { ...NO_FILL };
  }
  const fillBar = sessions.get(runDate)![fillIdx];
  if (fillBar.o <= stop || fillBar.o >= t1) return { ...NO_FILL, status: "not_filled" };

  const fill = fillBar.o;

  const closed = (exitAt: number, exit: number, reason: ExitReason, held: number): Outcome => ({
    status: "closed",
    fillAt: fillBar.t,
    fill,
    exitAt,
    exitPrice: exit,
    exitReason: reason,
    r: rMultiple(fill, exit, stop, costs),
    sessionsHeld: held,
  });

  const dates = [...sessions.keys()].filter((d) => d >= runDate).sort();
  const maxSessions = variant === "sameDay" ? 1 : SCORECARD_MAX_HOLD_SESSIONS;
  let held = 0;

  for (let k = 0; k < dates.length && k < maxSessions; k++) {
    const date = dates[k];
    const day = k === 0 ? sessions.get(date)!.slice(fillIdx) : sessions.get(date)!;
    held = k + 1;

    for (let i = 0; i < day.length; i++) {
      const b = day[i];
      if (k > 0 && i === 0) {
        if (b.o <= stop) return closed(b.t, b.o, "stop", held);
        if (b.o >= t1) return closed(b.t, b.o, "t1", held);
      }
      // One bar touching both cannot be ordered, so it counts as the stop.
      if (b.l <= stop) return closed(b.t, stop, "stop", held);
      if (b.h >= t1) return closed(b.t, t1, "t1", held);
    }

    if (!complete(date)) break; // still running: nothing more can be known
    if (k === maxSessions - 1) {
      const last = day[day.length - 1];
      return closed(last.t + CHART_BAR_SECONDS, last.c, "time", held);
    }
  }

  return {
    status: "open",
    fillAt: fillBar.t,
    fill,
    exitAt: null,
    exitPrice: null,
    exitReason: null,
    r: null,
    sessionsHeld: held,
  };
}
