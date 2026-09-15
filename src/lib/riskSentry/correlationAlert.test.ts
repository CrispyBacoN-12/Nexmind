import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { correlationAlert } from "./correlationAlert";

const T0 = Date.parse("2020-01-01T00:00:00Z") / 1000;
const DAY = 86_400;

/** Builds a candle series whose dailyReturns() is exactly `returns`, so the
 *  resulting Pearson correlation is fully controllable in a test. */
function candlesFromReturns(returns: number[]): Candle[] {
  let price = 100;
  const closes = [price];
  for (const r of returns) {
    price *= 1 + r;
    closes.push(price);
  }
  return closes.map((c, i) => ({ t: T0 + i * DAY, o: c, h: c + 1, l: c - 1, c, v: 1000 }));
}

const RETURNS_A = [0.01, -0.02, 0.015, 0.03, -0.01, 0.02, -0.015, 0.025, 0.01, -0.005];

test("a pair at/above threshold is flagged", () => {
  const holdings = [
    { ticker: "AAA", candles: candlesFromReturns(RETURNS_A) },
    { ticker: "BBB", candles: candlesFromReturns(RETURNS_A) }, // identical returns -> correlation 1
  ];
  const pairs = correlationAlert(holdings);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a, "AAA");
  assert.equal(pairs[0].b, "BBB");
  assert.ok(pairs[0].correlation > 0.999);
});

test("a pair below threshold is not flagged", () => {
  const holdings = [
    { ticker: "AAA", candles: candlesFromReturns(RETURNS_A) },
    { ticker: "CCC", candles: candlesFromReturns(RETURNS_A.map((r) => -r)) }, // exact inverse -> correlation -1
  ];
  assert.equal(correlationAlert(holdings).length, 0);
});

test("a holding with null or too-short candles is skipped, not a false flag", () => {
  const holdings = [
    { ticker: "AAA", candles: candlesFromReturns(RETURNS_A) },
    { ticker: "NULLCO", candles: null },
    { ticker: "SHORT", candles: candlesFromReturns([0.01, 0.02]) }, // 2 returns, below pearsonCorrelation's n>=5 floor
  ];
  assert.equal(correlationAlert(holdings).length, 0, "skipped holdings produce no pairs, not spurious ones");
});

test("no self-pairs and no duplicate (a,b)/(b,a) pairs", () => {
  const same = candlesFromReturns(RETURNS_A);
  const holdings = [
    { ticker: "A", candles: same },
    { ticker: "B", candles: same },
    { ticker: "C", candles: same },
  ];
  const pairs = correlationAlert(holdings);
  assert.equal(pairs.length, 3, "3 holdings -> exactly 3 unordered pairs");
  const keys = pairs.map((p) => `${p.a}-${p.b}`).sort();
  assert.deepEqual(keys, ["A-B", "A-C", "B-C"]);
});
