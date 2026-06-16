import { test } from "node:test";
import assert from "node:assert/strict";
import { buyInto, sellFrom } from "./execute";

test("buyInto: first buy sets shares and avgCost to the buy price", () => {
  const r = buyInto(0, 0, 10, 100);
  assert.equal(r.shares, 10);
  assert.equal(r.avgCost, 100);
});

test("buyInto: adding recomputes the weighted-average cost", () => {
  const r = buyInto(10, 100, 10, 200);
  assert.equal(r.shares, 20);
  assert.ok(Math.abs(r.avgCost - 150) < 1e-9);
});

test("sellFrom: realized P/L is shares × (price − avgCost); avgCost unchanged", () => {
  const r = sellFrom(10, 100, 4, 120);
  assert.equal(r.shares, 6);
  assert.ok(Math.abs(r.realizedPnlDelta - 80) < 1e-9);
  assert.equal(r.sold, false);
});

test("sellFrom: selling all shares marks the holding sold", () => {
  const r = sellFrom(10, 100, 10, 90);
  assert.equal(r.shares, 0);
  assert.ok(Math.abs(r.realizedPnlDelta - -100) < 1e-9);
  assert.equal(r.sold, true);
});

test("sellFrom: selling more than held clamps to held shares", () => {
  const r = sellFrom(5, 100, 999, 110);
  assert.equal(r.shares, 0);
  assert.ok(Math.abs(r.realizedPnlDelta - 50) < 1e-9);
  assert.equal(r.sold, true);
});
