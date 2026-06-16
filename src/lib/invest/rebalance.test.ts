import { test } from "node:test";
import assert from "node:assert/strict";
import { planRebalance, type RebalanceInput, type CommitteeRead } from "./rebalance";

function baseInput(over: Partial<RebalanceInput> = {}): RebalanceInput {
  return { holdings: [], reads: [], maxPositions: 4, bandPct: 5, cash: 10000, equity: 10000, ...over };
}

test("SELL: a held name downgraded to avoid is sold in full", () => {
  const actions = planRebalance(baseInput({
    holdings: [{ symbol: "AAPL", shares: 10, avgCost: 100, price: 120 }],
    reads: [{ symbol: "AAPL", rating: "avoid", entryHigh: null, price: 120 }],
    cash: 0, equity: 1200,
  }));
  const sell = actions.find((a) => a.symbol === "AAPL");
  assert.equal(sell?.kind, "sell");
  assert.equal(sell?.shares, 10);
});

test("BUY: a new in-zone buy/strong-buy name is bought ~one target slice", () => {
  const actions = planRebalance(baseInput({
    reads: [{ symbol: "MSFT", rating: "buy", entryHigh: 200, price: 100 }],
  }));
  const buy = actions.find((a) => a.symbol === "MSFT");
  assert.equal(buy?.kind, "buy");
  assert.ok(Math.abs((buy?.shares ?? 0) - 25) < 1e-9);
});

test("BUY skipped when price is above the accumulation zone", () => {
  const actions = planRebalance(baseInput({
    reads: [{ symbol: "MSFT", rating: "buy", entryHigh: 90, price: 100 }],
  }));
  assert.equal(actions.find((a) => a.symbol === "MSFT"), undefined);
});

test("BUY skipped when already at maxPositions", () => {
  const held = [1, 2, 3, 4].map((i) => ({ symbol: `H${i}`, shares: 10, avgCost: 100, price: 100 }));
  const reads: CommitteeRead[] = held.map((h) => ({ symbol: h.symbol, rating: "hold", entryHigh: null, price: 100 }));
  reads.push({ symbol: "MSFT", rating: "buy", entryHigh: null, price: 100 });
  const actions = planRebalance(baseInput({ holdings: held, reads, cash: 0, equity: 4000 }));
  assert.equal(actions.find((a) => a.symbol === "MSFT"), undefined);
});

test("TRIM: an overweight holding is trimmed back toward target", () => {
  const actions = planRebalance(baseInput({
    holdings: [{ symbol: "AAPL", shares: 50, avgCost: 80, price: 100 }],
    reads: [{ symbol: "AAPL", rating: "hold", entryHigh: null, price: 100 }],
    cash: 5000, equity: 10000,
  }));
  const trim = actions.find((a) => a.symbol === "AAPL");
  assert.equal(trim?.kind, "trim");
  assert.ok(Math.abs((trim?.shares ?? 0) - 25) < 1e-9);
});

test("ADD: an underweight holding (not avoid) is topped up toward target", () => {
  const actions = planRebalance(baseInput({
    holdings: [{ symbol: "AAPL", shares: 5, avgCost: 100, price: 100 }],
    reads: [{ symbol: "AAPL", rating: "buy", entryHigh: null, price: 100 }],
    cash: 9500, equity: 10000,
  }));
  const add = actions.find((a) => a.symbol === "AAPL");
  assert.equal(add?.kind, "add");
  assert.ok(Math.abs((add?.shares ?? 0) - 20) < 1e-9);
});

test("ordering: sells and trims come before buys and adds", () => {
  const actions = planRebalance(baseInput({
    holdings: [{ symbol: "OLD", shares: 10, avgCost: 100, price: 100 }],
    reads: [
      { symbol: "OLD", rating: "avoid", entryHigh: null, price: 100 },
      { symbol: "NEW", rating: "buy", entryHigh: null, price: 100 },
    ],
    cash: 0, equity: 1000,
  }));
  const kinds = actions.map((a) => a.kind);
  const lastSellOrTrim = Math.max(kinds.lastIndexOf("sell"), kinds.lastIndexOf("trim"));
  const firstBuyOrAdd = Math.min(
    kinds.indexOf("buy") === -1 ? Infinity : kinds.indexOf("buy"),
    kinds.indexOf("add") === -1 ? Infinity : kinds.indexOf("add"),
  );
  assert.ok(lastSellOrTrim < firstBuyOrAdd);
});

test("BUY is capped by available cash (partial slice when cash < target)", () => {
  // target = equity/maxPositions = 10000/4 = 2500, but only 1000 cash available
  const actions = planRebalance(baseInput({
    reads: [{ symbol: "MSFT", rating: "buy", entryHigh: null, price: 100 }],
    cash: 1000, equity: 10000,
  }));
  const buy = actions.find((a) => a.symbol === "MSFT");
  assert.equal(buy?.kind, "buy");
  // spend = min(2500, 1000) = 1000 → 1000/100 = 10 shares (not the full 25)
  assert.ok(Math.abs((buy?.shares ?? 0) - 10) < 1e-9);
});
