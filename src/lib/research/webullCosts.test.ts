import { test } from "node:test";
import assert from "node:assert/strict";
import {
  secFee, finraTaf, priceWholeShareTrade, priceWholeShareTrades,
  SEC_FEE_MIN, FINRA_TAF_MIN, FINRA_TAF_MAX, type RawTrade,
} from "./webullCosts";

const day = (n: number) => new Date(2026, 0, 1 + n);

test("secFee: floors at the minimum for a small sell", () => {
  assert.equal(secFee(1), SEC_FEE_MIN);
});

test("secFee: charges the rate once the dollar volume clears the floor", () => {
  assert.ok(Math.abs(secFee(550) - 0.01529) < 1e-9);
});

test("finraTaf: floors at the minimum for a small share count", () => {
  assert.equal(finraTaf(5), FINRA_TAF_MIN);
});

test("finraTaf: caps at the maximum for a large share count", () => {
  assert.equal(finraTaf(1_000_000), FINRA_TAF_MAX);
});

test("priceWholeShareTrade: a profitable long nets gross minus sell-side fees off the exit", () => {
  const raw: RawTrade = { side: "long", entry: 100, exit: 110, sl: 98, openedAt: day(0), closedAt: day(2) };
  const priced = priceWholeShareTrade(raw, 500)!;
  assert.equal(priced.shares, 5);
  assert.equal(priced.grossUsd, 50);
  assert.ok(Math.abs(priced.feesUsd - 0.02529) < 1e-9); // secFee(110*5) + FINRA_TAF_MIN
  assert.ok(Math.abs(priced.netUsd - 49.97471) < 1e-9);
  assert.ok(Math.abs(priced.rMultiple! - 4.997471) < 1e-6); // riskUsd = |100-98|*5 = 10
  assert.equal(priced.outcome, "win");
  assert.equal(priced.holdingDays, 2);
});

test("priceWholeShareTrade: a profitable short nets gross minus sell-side fees off the entry", () => {
  // Selling short to open is the SELL leg here, not the exit.
  const raw: RawTrade = { side: "short", entry: 100, exit: 90, sl: 102, openedAt: day(0), closedAt: day(3) };
  const priced = priceWholeShareTrade(raw, 500)!;
  assert.equal(priced.shares, 5);
  assert.equal(priced.grossUsd, 50);
  assert.ok(Math.abs(priced.feesUsd - 0.0239) < 1e-9); // secFee(100*5) + FINRA_TAF_MIN
  assert.ok(Math.abs(priced.netUsd - 49.9761) < 1e-9);
  assert.equal(priced.outcome, "win");
});

test("priceWholeShareTrade: a losing short is scored as a loss, not a mirrored win", () => {
  const raw: RawTrade = { side: "short", entry: 100, exit: 105, sl: 102, openedAt: day(0), closedAt: day(1) };
  const priced = priceWholeShareTrade(raw, 500)!;
  assert.ok(priced.grossUsd < 0);
  assert.ok(priced.netUsd < 0);
  assert.equal(priced.outcome, "loss");
  assert.ok(priced.rMultiple! < 0);
});

test("priceWholeShareTrade: excluded, not zeroed, when the slot cannot buy one whole share", () => {
  const raw: RawTrade = { side: "long", entry: 100, exit: 110, sl: 98, openedAt: day(0), closedAt: day(1) };
  assert.equal(priceWholeShareTrade(raw, 50), null);
});

test("priceWholeShareTrade: a friction override shifts fills but not the risk distance", () => {
  const raw: RawTrade = { side: "long", entry: 100, exit: 110, sl: 98, openedAt: day(0), closedAt: day(1) };
  const noFriction = priceWholeShareTrade(raw, 500)!;
  const withFriction = priceWholeShareTrade(raw, 500, 100.05, 109.95)!;
  assert.equal(withFriction.shares, noFriction.shares); // sizing still keys off raw.entry
  assert.ok(withFriction.grossUsd < noFriction.grossUsd); // narrower fill spread
  assert.equal(withFriction.rMultiple !== null && noFriction.rMultiple !== null, true);
});

test("priceWholeShareTrade: rMultiple is null when the stop distance is zero", () => {
  const raw: RawTrade = { side: "long", entry: 100, exit: 110, sl: 100, openedAt: day(0), closedAt: day(1) };
  const priced = priceWholeShareTrade(raw, 500)!;
  assert.equal(priced.rMultiple, null);
});

test("priceWholeShareTrades: splits priced trades from slot-too-small exclusions", () => {
  const trades: RawTrade[] = [
    { side: "long", entry: 100, exit: 110, sl: 98, openedAt: day(0), closedAt: day(1) },
    { side: "short", entry: 100, exit: 90, sl: 102, openedAt: day(0), closedAt: day(1) },
    { side: "long", entry: 1000, exit: 1100, sl: 980, openedAt: day(0), closedAt: day(1) }, // 500/1000 < 1 share
  ];
  const { priced, excluded } = priceWholeShareTrades(trades, 500);
  assert.equal(priced.length, 2);
  assert.equal(excluded, 1);
});
