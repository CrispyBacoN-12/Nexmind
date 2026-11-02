// Random-entry control for the scorecard (spec §5). For each filled setup it asks:
// had the same trade, with the same stop distance and the same target multiple, been
// entered at a random time later that day, what would it have returned? One value per
// run (the mean R of the control trades that closed); the setups must beat the 95th
// percentile of those values to count as better than chance.
//
// Pure and deterministic: seeded RNG, no I/O, no clock. Importing mulberry32 from
// research/control.ts reaches prisma through the backtest engine, so a test of this
// module loads dotenv first (as costModel.test.ts does).

import type { Candle } from "@/lib/indicators";
import { mulberry32, summarizeControl, type ControlDistribution } from "@/lib/research/control";
import { etClock } from "@/lib/scanAgent/session";
import { CHART_BAR_SECONDS } from "@/lib/chartAgent/types";
import { scoreSetup } from "./score";
import {
  SCORECARD_CONTROL_LAST_ENTRY_ET_MINUTES,
  SCORECARD_CONTROL_RUNS,
  SCORECARD_SEED,
  type ExitVariant,
} from "./types";

const OPEN_MIN = 570; // 09:30 ET

/** One per filled setup. `fill` is the setup's raw fill price (the bar open). */
export interface ControlTrade {
  runAtSec: number;
  fill: number;
  stop: number;
  t1: number;
  bars: Candle[];
  cutoffSec: number;
}

/**
 * Finished regular bars on the trade's run date, at or after the run, that open before
 * 15:30 ET. The control may enter at any of them; the real setup used the first.
 */
function eligibleBars(trade: ControlTrade): Candle[] {
  const runDate = etClock(trade.runAtSec).date;
  return trade.bars.filter((b) => {
    if (b.t < trade.runAtSec || b.t + CHART_BAR_SECONDS > trade.cutoffSec) return false;
    const { date, minutes } = etClock(b.t);
    return date === runDate && minutes >= OPEN_MIN && minutes < SCORECARD_CONTROL_LAST_ENTRY_ET_MINUTES;
  });
}

/**
 * `runs` control values, each the mean R of that run's closed control trades. A trade
 * with no eligible bar, or whose control result is not `closed`, sits that run out; a
 * run with no closed trade is dropped. Null when no run produced a value.
 *
 * Same ticker and day means the same ATR, so keeping the price distance `fill - stop`
 * and the multiple `(t1 - fill) / (fill - stop)` is "the same ATR multiple" (spec §5).
 */
export function controlDistribution(
  trades: ControlTrade[],
  variant: ExitVariant,
  runs: number = SCORECARD_CONTROL_RUNS,
  seed: number = SCORECARD_SEED,
): ControlDistribution | null {
  const rng = mulberry32(seed);
  const eligible = trades.map(eligibleBars);
  const avgRs: number[] = [];

  for (let run = 0; run < runs; run++) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < trades.length; i++) {
      const pool = eligible[i];
      if (!pool.length) continue;
      const trade = trades[i];
      const bar = pool[Math.floor(rng() * pool.length)];
      const dist = trade.fill - trade.stop;
      const k = (trade.t1 - trade.fill) / dist;
      const e = bar.o;
      const out = scoreSetup({
        runAtSec: bar.t,
        stop: e - dist,
        t1: e + k * dist,
        bars: trade.bars,
        cutoffSec: trade.cutoffSec,
        variant,
      });
      if (out.status !== "closed" || out.r === null) continue;
      sum += out.r;
      n++;
    }
    if (n > 0) avgRs.push(sum / n);
  }

  return summarizeControl(avgRs);
}
