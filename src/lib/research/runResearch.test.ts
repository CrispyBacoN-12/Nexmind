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

// A strictly monotonic uptrend: every bar's low is higher than the prior bar's
// low, so a long's SL (set below entry) can never be touched -- every closed
// trade is a win. With zero losing trades, summarizeBacktest's profitFactor
// is `grossLoss > 0 ? grossWin / grossLoss : null`, i.e. null, for EVERY
// tp1Mult in LADDER_TP_MULTS on this fixture (verified below). sweepLadder
// maps a null profitFactor to -Infinity (`summary.profitFactor ?? -Infinity`),
// so every candidate ties at pf=-Infinity and the winner is decided entirely
// by the `pf === bestPf && expectancy > best.expectancy` tie-break -- unlike
// the triangle-wave fixture above, where profit factor is strictly increasing
// and the tie-break branch is never reached. This is a genuine tie produced by
// the real backtest engine, not a synthetic/extracted predicate.
function uptrendBars(n: number, step: number): Candle[] {
  const bars: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price += step;
    bars.push(bar(i * 3600, price));
  }
  return bars;
}

test("sweepLadder's tie-break picks the higher-expectancy candidate when profit factor ties (all-win uptrend fixture)", () => {
  const bars = uptrendBars(250, 2);
  const snaps = computeSnapshots(bars);
  const periodicEntry = (i: number) => (i % 10 === 0 ? "long" : null);

  // Independently recompute every candidate in the sweep (mirrors sweepLadder's
  // own loop/tie-break, but calls backtestCandles/summarizeBacktest directly --
  // never invokes sweepLadder itself, so this stays a non-circular check).
  const recomputed: { tp1Mult: number; summary: ReturnType<typeof summarizeBacktest> }[] = [];
  let expectedBest: { tp1Mult: number; summary: ReturnType<typeof summarizeBacktest> } | null = null;
  for (const tp1Mult of LADDER_TP_MULTS) {
    const bt = backtestCandles("EXPECT", bars, 0.1, undefined, periodicEntry, true, tp1Mult, DEFAULT_COST_MODEL, LADDER_SL_MULT);
    const summary = summarizeBacktest(bt.trades);
    recomputed.push({ tp1Mult, summary });
    const pf = summary.profitFactor ?? -Infinity;
    const bestPf = expectedBest ? expectedBest.summary.profitFactor ?? -Infinity : -Infinity;
    const better =
      !expectedBest ||
      pf > bestPf ||
      (pf === bestPf && (summary.expectancy ?? -Infinity) > (expectedBest.summary.expectancy ?? -Infinity));
    if (better) expectedBest = { tp1Mult, summary };
  }
  assert.ok(expectedBest, "the sweep range must produce at least one candidate");

  // Prove the tie is real: every candidate has zero losses, so profitFactor is
  // null for all of them -- they all compare equal (-Infinity) in sweepLadder.
  for (const { tp1Mult, summary } of recomputed) {
    assert.ok(summary.trades > 0, `tp1Mult=${tp1Mult} must produce trades on this fixture`);
    assert.equal(summary.losses, 0, `tp1Mult=${tp1Mult} must have zero losses on a monotonic uptrend`);
    assert.equal(summary.profitFactor, null, `tp1Mult=${tp1Mult} must have a null (tied) profit factor`);
  }

  // Expectancy strictly increases with tp1Mult on this fixture (bigger target
  // = bigger win per trade, same win count), so the correct tie-break must
  // pick the LAST ladder value -- not the first (which is what `!best` alone,
  // or a tie-break with a flipped inequality, would leave standing).
  for (let i = 1; i < recomputed.length; i++) {
    assert.ok(
      (recomputed[i].summary.expectancy ?? -Infinity) > (recomputed[i - 1].summary.expectancy ?? -Infinity),
      "expectancy must strictly increase across LADDER_TP_MULTS on this fixture for the tie-break to be unambiguous",
    );
  }
  assert.equal(expectedBest!.tp1Mult, LADDER_TP_MULTS[LADDER_TP_MULTS.length - 1]);

  const result = sweepLadder(PERIODIC_LONG_CODE, bars, snaps);

  assert.equal(result.ladder.tp1Mult, expectedBest!.tp1Mult);
  assert.equal(result.summary.profitFactor, null);
  assert.equal(result.summary.expectancy, expectedBest!.summary.expectancy);
  assert.equal(result.summary.trades, expectedBest!.summary.trades);
});
