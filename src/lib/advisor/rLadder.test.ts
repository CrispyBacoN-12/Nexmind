import test from "node:test";
import assert from "node:assert/strict";

import { rLadder, costInR } from "./rLadder";

test("the worked example ladder: five rungs from 1R to 3R", () => {
  const rows = rLadder(180, 9, 2);
  assert.equal(rows.length, 5);

  assert.deepEqual(rows[0], { r: 1, price: 189, gainPct: 5, plUsd: 18 });
  assert.deepEqual(rows[1], { r: 1.5, price: 193.5, gainPct: 7.5, plUsd: 27 });
  assert.deepEqual(rows[2], { r: 2, price: 198, gainPct: 10, plUsd: 36 });
  assert.deepEqual(rows[3], { r: 2.5, price: 202.5, gainPct: 12.5, plUsd: 45 });
  assert.deepEqual(rows[4], { r: 3, price: 207, gainPct: 15, plUsd: 54 });
});

test("zero shares still prints prices, with zero P/L", () => {
  const rows = rLadder(180, 9, 0);
  assert.equal(rows[0].price, 189);
  assert.equal(rows[0].plUsd, 0);
  assert.equal(rows[4].plUsd, 0);
});

test("the ladder honours a custom step list", () => {
  const rows = rLadder(100, 10, 1, [1, 2]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].price, 120);
});

test("round-trip cost at 5bps on a 9-dollar stop is 0.02R", () => {
  assert.ok(Math.abs(costInR(180, 9, 5) - 0.02) < 1e-12);
});

test("a tighter stop makes the same cost a larger share of one R", () => {
  const wide = costInR(180, 9, 5);
  const tight = costInR(180, 1, 5);
  assert.ok(tight > wide);
  assert.ok(Math.abs(tight - 0.18) < 1e-12);
});

test("cost in R scales linearly with the bps assumption", () => {
  assert.ok(Math.abs(costInR(180, 9, 10) - 2 * costInR(180, 9, 5)) < 1e-12);
  assert.equal(costInR(180, 9, 0), 0);
});

test("P/L on every rung equals shares * r * slDistance", () => {
  const shares = 7;
  const slDistance = 3.25;
  for (const row of rLadder(88, slDistance, shares)) {
    assert.ok(Math.abs(row.plUsd - shares * row.r * slDistance) < 1e-9);
  }
});

test("an unusable stop distance reports zero cost rather than Infinity", () => {
  assert.equal(costInR(180, 0, 5), 0);
});
