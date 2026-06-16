import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInvestStats, type InvestHolding } from "./investStats";

function h(symbol: string, shares: number, avgCost: number, status = "held", realizedPnl = 0): InvestHolding {
  return { symbol, shares, avgCost, status, realizedPnl };
}

test("computeInvestStats: empty portfolio is all cash", () => {
  const s = computeInvestStats([], () => null, 10000);
  assert.equal(s.cash, 10000);
  assert.equal(s.marketValue, 0);
  assert.equal(s.equity, 10000);
  assert.equal(s.unrealizedPnl, 0);
  assert.equal(s.realizedPnl, 0);
});

test("computeInvestStats: equity = cash + market value; unrealized = MV - cost", () => {
  const holdings = [h("AAPL", 10, 100), h("MSFT", 5, 200)];
  const price: Record<string, number> = { AAPL: 120, MSFT: 180 };
  const s = computeInvestStats(holdings, (sym) => price[sym] ?? null, 5000);
  assert.equal(s.marketValue, 2100);
  assert.equal(s.equity, 7100);
  assert.equal(s.unrealizedPnl, 100);
});

test("computeInvestStats: realizedPnl sums all holdings (held + sold)", () => {
  const holdings = [h("AAPL", 10, 100, "held", 50), h("NVDA", 0, 0, "sold", 300)];
  const s = computeInvestStats(holdings, () => 100, 1000);
  assert.equal(s.realizedPnl, 350);
});

test("computeInvestStats: a missing price falls back to cost basis (never zero) and is flagged", () => {
  const holdings = [h("AAPL", 10, 100)];
  const s = computeInvestStats(holdings, () => null, 0);
  assert.equal(s.marketValue, 1000);
  assert.equal(s.unrealizedPnl, 0); // cost-basis fallback cancels out
  assert.deepEqual(s.missingPrices, ["AAPL"]);
});
