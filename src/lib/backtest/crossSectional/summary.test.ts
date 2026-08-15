import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeCrossSectional } from "./summary";
import type { CsTrade, EquityPoint } from "./types";

const DAY = 86_400;

function trade(pnl: number, r: number | null = null): CsTrade {
  return {
    symbol: "AAA", entryT: DAY, exitT: 5 * DAY, entry: 100, exit: 100 + pnl,
    shares: 1, grossPnl: pnl, pnl, retPct: pnl, rMultiple: r,
    reason: "hold-expiry", daysHeld: 4,
  };
}

function curve(values: number[], positionsPerDay: number[]): EquityPoint[] {
  return values.map((equity, i) => ({ t: (i + 1) * DAY, equity, positions: positionsPerDay[i] }));
}

test("counts wins and computes win rate", () => {
  const s = summarizeCrossSectional([trade(10), trade(-5), trade(20)], curve([100, 100, 100], [0, 0, 0]), 100);
  assert.equal(s.trades, 3);
  assert.equal(s.wins, 2);
  assert.ok(Math.abs(s.winRate - 66.6667) < 0.01);
});

test("profit factor is gross win over gross loss, and null with no losers", () => {
  assert.equal(summarizeCrossSectional([trade(10), trade(-5)], curve([100], [0]), 100).profitFactor, 2);
  assert.equal(summarizeCrossSectional([trade(10)], curve([100], [0]), 100).profitFactor, null);
});

test("avgR is null when no trade carries an R-multiple", () => {
  assert.equal(summarizeCrossSectional([trade(10), trade(-5)], curve([100], [0]), 100).avgR, null);
  assert.equal(summarizeCrossSectional([trade(10, 2), trade(-5, -1)], curve([100], [0]), 100).avgR, 0.5);
});

test("max drawdown is the largest peak-to-trough as a positive percentage", () => {
  // 100 -> 120 -> 90: trough is 25% below the 120 peak.
  const s = summarizeCrossSectional([], curve([100, 120, 90, 110], [0, 0, 0, 0]), 100);
  assert.ok(s.maxDrawdownPct !== null);
  assert.ok(Math.abs(s.maxDrawdownPct - 25) < 0.01);
});

test("max drawdown is 0 on a monotonically rising curve", () => {
  const s = summarizeCrossSectional([], curve([100, 110, 120], [0, 0, 0]), 100);
  assert.equal(s.maxDrawdownPct, 0);
});

test("time in market counts days with at least one open position", () => {
  const s = summarizeCrossSectional([], curve([100, 100, 100, 100], [0, 2, 1, 0]), 100);
  assert.equal(s.timeInMarketPct, 50);
  assert.equal(s.tradingDays, 4);
});

test("CAGR annualises the equity change over the curve's span", () => {
  // 100 -> 200 across roughly one year of trading days.
  const days = 252;
  const values = Array.from({ length: days }, (_, i) => 100 + (100 * i) / (days - 1));
  const s = summarizeCrossSectional([], curve(values, new Array(days).fill(1)), 100);
  assert.ok(s.cagrPct !== null);
  assert.ok(Math.abs(s.cagrPct - 100) < 5, `expected ~100%, got ${s.cagrPct}`);
});

test("an empty curve yields null CAGR and null drawdown rather than NaN", () => {
  const s = summarizeCrossSectional([], [], 100);
  assert.equal(s.cagrPct, null);
  assert.equal(s.maxDrawdownPct, null);
  assert.equal(s.timeInMarketPct, 0);
});
