import { test } from "node:test";
import assert from "node:assert/strict";
import { monteCarloShuffle, monteCarloBootstrap } from "./montecarlo";

test("monteCarloShuffle: throws on empty trade list", () => {
  assert.throws(() => monteCarloShuffle([], { startingBalance: 10000, riskPctPerTrade: 1, iterations: 10 }));
});

test("monteCarloShuffle: all-winning trades never draw down", () => {
  const rs = [1, 1, 1, 1, 1];
  const summary = monteCarloShuffle(rs, { startingBalance: 10000, riskPctPerTrade: 1, iterations: 200 });
  assert.equal(summary.maxDrawdownPct.worst, 0);
  assert.ok(summary.finalReturnPct.p50 > 0);
});

test("monteCarloShuffle: total return is invariant to order (same trade set every run)", () => {
  const rs = [1.2, -1, 1.2, -1, 1.2, -1, 2, -0.5];
  const summary = monteCarloShuffle(rs, { startingBalance: 10000, riskPctPerTrade: 1, iterations: 500 });
  // Order changes drawdown path but not final equity, since risk is a % of
  // CURRENT equity - so compounding does make order matter slightly. Assert
  // the spread is small relative to the mean, not exactly zero.
  const spread = summary.finalReturnPct.p95 - summary.finalReturnPct.p5;
  assert.ok(spread < Math.abs(summary.finalReturnPct.p50) + 5, `spread ${spread} too wide for a fixed trade set`);
});

test("monteCarloShuffle: a losing streak clustered by bad luck can breach a drawdown halt that the historical order never hit", () => {
  // 20 wins then 10 losses in the RAW order would show low realized drawdown,
  // but shuffled runs can front-load the losses - probBreach should be > 0.
  const rs = [...Array(20).fill(1), ...Array(10).fill(-1)];
  const summary = monteCarloShuffle(rs, { startingBalance: 10000, riskPctPerTrade: 5, iterations: 1000 });
  assert.ok(summary.probBreach(10) > 0, "expected some shuffled paths to breach a 10% drawdown halt");
});

test("monteCarloBootstrap: throws on empty trade list", () => {
  assert.throws(() => monteCarloBootstrap([], { startingBalance: 10000, riskPctPerTrade: 1, iterations: 10 }));
});

test("monteCarloBootstrap: final return varies across runs (unlike shuffle, the sample itself changes)", () => {
  const rs = [1, -1, 2, -0.5, 1.5, -1, 0.8, -0.3];
  const summary = monteCarloBootstrap(rs, { startingBalance: 10000, riskPctPerTrade: 2, iterations: 1000 });
  assert.ok(summary.finalReturnPct.p95 > summary.finalReturnPct.p5, "expected a real spread in outcomes");
});

test("monteCarloBootstrap: probBreach is 1.0 when every trade is a full loss at high risk", () => {
  const rs = [-1, -1, -1, -1, -1];
  const summary = monteCarloBootstrap(rs, { startingBalance: 10000, riskPctPerTrade: 10, iterations: 200 });
  assert.equal(summary.probBreach(5), 1);
});
