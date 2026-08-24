import "dotenv/config"; // runResearch.ts imports prisma at module scope
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { backtestCandles, summarizeBacktest, DEFAULT_COST_MODEL } from "@/lib/backtest/engine";
import { computeSnapshots } from "./adapter";
import { sweepLadder, LADDER_TP_MULTS, LADDER_SL_MULT } from "./runResearch";

function bar(t: number, c: number): Candle {
  return { t, o: c, h: c + 1, l: c - 1, c, v: 1000 };
}

// A 250-bar triangle wave (well past WARMUP=60): 10 bars up, 10 bars down,
// repeating, +-1.5/bar. Gives the periodic-long strategy below many round-trip
// trades across the whole ladder sweep.
function triangleBars(n: number): Candle[] {
  const bars: Candle[] = [];
  let price = 100;
  let direction = 1;
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % 10 === 0) direction *= -1;
    price += direction * 1.5;
    bars.push(bar(i * 3600, price));
  }
  return bars;
}

const PERIODIC_LONG_CODE = `
  var i = bars.length - 1;
  if (i % 10 === 0) return { side: "long", note: "periodic" };
  return null;
`;

test("sweepLadder picks the ladder with the best profit factor (expectancy tie-break), matching an independently recomputed sweep", () => {
  const bars = triangleBars(250);
  const snaps = computeSnapshots(bars);
  const periodicEntry = (i: number) => (i % 10 === 0 ? "long" : null);

  let expectedBest: { tp1Mult: number; summary: ReturnType<typeof summarizeBacktest> } | null = null;
  for (const tp1Mult of LADDER_TP_MULTS) {
    const bt = backtestCandles("EXPECT", bars, 0.1, undefined, periodicEntry, true, tp1Mult, DEFAULT_COST_MODEL, LADDER_SL_MULT);
    const summary = summarizeBacktest(bt.trades);
    const pf = summary.profitFactor ?? -Infinity;
    const bestPf = expectedBest ? expectedBest.summary.profitFactor ?? -Infinity : -Infinity;
    const better =
      !expectedBest ||
      pf > bestPf ||
      (pf === bestPf && (summary.expectancy ?? -Infinity) > (expectedBest.summary.expectancy ?? -Infinity));
    if (better) expectedBest = { tp1Mult, summary };
  }
  assert.ok(expectedBest, "the sweep range must produce at least one candidate");

  const result = sweepLadder(PERIODIC_LONG_CODE, bars, snaps);

  assert.equal(result.ladder.tp1Mult, expectedBest!.tp1Mult);
  assert.equal(result.ladder.slMult, LADDER_SL_MULT);
  assert.equal(result.ladder.singleTarget, true);
  assert.equal(result.summary.trades, expectedBest!.summary.trades);
  assert.equal(result.summary.profitFactor, expectedBest!.summary.profitFactor);
});

test("sweepLadder returns a ladder that actually produced trades on a realistic-length series", () => {
  const bars = triangleBars(250);
  const snaps = computeSnapshots(bars);
  const result = sweepLadder(PERIODIC_LONG_CODE, bars, snaps);
  assert.ok(LADDER_TP_MULTS.includes(result.ladder.tp1Mult));
  assert.ok(result.summary.trades > 0, "the periodic-long strategy must produce trades on a 250-bar series");
});
