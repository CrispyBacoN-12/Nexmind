// Protective-put math for the /journal hedge card. The numbers are the spec's
// own worked example (MSFT, 20 shares, entry 410, stop 395, price 418.2), so a
// change that moves a formula moves a number the owner has already seen.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  chooseExpiryTarget,
  contractsFor,
  isQuoteStale,
  overHedge,
  parseOccSymbol,
  pickExpiry,
  pickStrikes,
  rowMath,
  stopOnly,
  worstGapDownPct,
} from "./math";

test("parseOccSymbol", () => {
  assert.deepEqual(parseOccSymbol("AAPL261231P00240000"), { root: "AAPL", expiry: "2026-12-31", type: "P", strike: 240 });
  assert.deepEqual(parseOccSymbol("MSFT261205P00397500"), { root: "MSFT", expiry: "2026-12-05", type: "P", strike: 397.5 });
  assert.equal(parseOccSymbol("junk"), null);
});

test("contractsFor and overHedge", () => {
  assert.equal(contractsFor(20), 1);
  assert.equal(contractsFor(100), 1);
  assert.equal(contractsFor(250), 3);
  assert.equal(overHedge(20, 1), 5);
  assert.equal(overHedge(100, 1), 1);
  assert.equal(overHedge(250, 3), 1.2);
});

test("chooseExpiryTarget: earnings within 45 days → day after earnings", () => {
  assert.deepEqual(chooseExpiryTarget("2026-11-25", { date: "2026-12-03", hour: "amc" }), { gte: "2026-12-04", reason: "afterEarnings" });
});

test("chooseExpiryTarget: far, missing or past earnings → today + 30", () => {
  assert.deepEqual(chooseExpiryTarget("2026-11-25", { date: "2027-01-20", hour: null }), { gte: "2026-12-25", reason: "about30d" });
  assert.deepEqual(chooseExpiryTarget("2026-11-25", { date: null, hour: null, note: "x" }), { gte: "2026-12-25", reason: "about30d" });
});

test("chooseExpiryTarget: past earnings falls back", () => {
  assert.deepEqual(chooseExpiryTarget("2026-11-25", { date: "2026-11-20", hour: null }), { gte: "2026-12-25", reason: "about30d" });
});

test("pickExpiry: earliest expiry on or after gte", () => {
  const q = (expiry: string) => ({ symbol: "", expiry, strike: 1, bid: null, ask: null, quotedAt: null });
  assert.equal(pickExpiry([q("2026-12-11"), q("2026-12-04"), q("2026-12-03")], "2026-12-04"), "2026-12-04");
  assert.equal(pickExpiry([], "2026-12-04"), null);
});

test("pickStrikes: three targets, highest first", () => {
  assert.deepEqual(pickStrikes([390, 395, 397.5, 400, 410, 417.5, 420], 418.2, 395), {
    picks: [
      { strike: 417.5, targets: ["atm"] },
      { strike: 397.5, targets: ["minus5"] },
      { strike: 395, targets: ["stop"] },
    ],
    missing: [],
  });
});

test("pickStrikes: two targets on one strike are merged", () => {
  assert.deepEqual(pickStrikes([395, 420], 418.2, 397).picks, [
    { strike: 420, targets: ["atm"] },
    { strike: 395, targets: ["stop", "minus5"] },
  ]);
});

test("pickStrikes: strike farther than 3% of price is missing", () => {
  const r = pickStrikes([300, 420], 418.2, 395);
  assert.deepEqual(r.missing, [
    { target: "stop", reason: "noStrikeNear" },
    { target: "minus5", reason: "noStrikeNear" },
  ]);
});

test("pickStrikes: stop at or above price is skipped", () => {
  assert.deepEqual(pickStrikes([400, 417.5, 420], 418.2, 420).missing, [{ target: "stop", reason: "priceBelowStop" }]);
});

test("rowMath: 20 shares, one contract", () => {
  const r = rowMath({ shares: 20, entry: 410, price: 418.2, strike: 395, contracts: 1, bid: 1.6, ask: 1.85 });
  assert.equal(r.premiumTotal, 185);
  assert.ok(Math.abs(r.premiumPct! - 185 / 8364) < 1e-9);
  assert.equal(r.breakeven, 419.25);
  assert.equal(r.maxLossWithPut, 485);
  assert.ok(Math.abs(r.distancePct - (418.2 - 395) / 418.2) < 1e-9);
  assert.equal(r.wideSpread, false);
});

test("rowMath: no ask → no math; bid 0 → wide spread", () => {
  const none = rowMath({ shares: 20, entry: 410, price: 418.2, strike: 395, contracts: 1, bid: 1, ask: null });
  assert.equal(none.premiumTotal, null);
  assert.equal(none.breakeven, null);
  assert.equal(none.maxLossWithPut, null);
  assert.equal(rowMath({ shares: 20, entry: 410, price: 418.2, strike: 395, contracts: 1, bid: 0, ask: 1 }).wideSpread, true);
  assert.equal(rowMath({ shares: 20, entry: 410, price: 418.2, strike: 395, contracts: 1, bid: 0.6, ask: 1 }).wideSpread, true);
});

test("rowMath: strike above entry gives a loss below the premium", () => {
  assert.equal(
    rowMath({ shares: 20, entry: 400, price: 418.2, strike: 417.5, contracts: 1, bid: 5, ask: 6 }).maxLossWithPut,
    (400 - 417.5) * 20 + 600,
  );
});

test("worstGapDownPct: needs 60 measurable sessions", () => {
  const bars = (n: number) => Array.from({ length: n }, (_, i) => ({ t: i * 86400, o: 100, h: 101, l: 99, c: 100, v: 1 }));
  const b = bars(61);
  b[30] = { ...b[30], o: 88 };
  assert.ok(Math.abs(worstGapDownPct(b)! - 0.12) < 1e-9);
  assert.equal(worstGapDownPct(bars(60)), null);
  assert.equal(worstGapDownPct(null), null);
});

test("stopOnly: fill at stop and worst gap", () => {
  const s = stopOnly({ entry: 410, stop: 395, shares: 20, price: 418.2, gapPct: 0.112 });
  assert.equal(s.atStop, 300);
  assert.ok(Math.abs(s.gapLoss! - (410 - 418.2 * 0.888) * 20) < 1e-9);
  assert.equal(s.note, null);
  assert.deepEqual(stopOnly({ entry: 410, stop: 410, shares: 20, price: 418.2, gapPct: 0.1 }), {
    atStop: null,
    gapPct: 0.1,
    gapLoss: null,
    note: "stopNotBelowEntry",
  });
  assert.equal(stopOnly({ entry: 410, stop: 395, shares: 20, price: 418.2, gapPct: null }).note, "notEnoughHistory");
});

test("isQuoteStale: more than 4 days", () => {
  const now = Date.parse("2026-11-25T00:00:00Z");
  assert.equal(isQuoteStale("2026-11-24T18:47:01Z", now), false);
  assert.equal(isQuoteStale("2026-11-20T18:47:01Z", now), true);
  assert.equal(isQuoteStale(null, now), true);
});

test("stopOnly: a gap that would not reach the stop still costs the stop", () => {
  // Opening 3% lower (405.65) stays above the stop, so the stop is still what fills.
  const s = stopOnly({ entry: 410, stop: 395, shares: 20, price: 418.2, gapPct: 0.03 });
  assert.equal(s.gapLoss, 300);
});
