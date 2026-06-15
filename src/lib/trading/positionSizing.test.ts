import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLot } from "./positionSizing";

const base = { riskUsd: 10, maxLotPerTrade: 2, avgCorrelation: null as number | null };

test("larger SL distance -> smaller lot (volatility scaling)", () => {
  const tight = computeLot({ ...base, entry: 100, sl: 90 }); // slDistance 10 -> riskLot 1
  const wide = computeLot({ ...base, entry: 100, sl: 0 }); // slDistance 100 -> riskLot 0.1
  assert.equal(tight.lot, 1);
  assert.equal(wide.lot, 0.1);
  assert.ok(wide.lot < tight.lot);
});

test("lot clamped to maxLotPerTrade when riskLot would exceed it", () => {
  // slDistance 1 -> riskLot 10, maxLotPerTrade 2
  const r = computeLot({ ...base, entry: 100, sl: 99 });
  assert.equal(r.lot, 2);
});

test("lot clamped to minLot when riskLot would fall below it", () => {
  // slDistance 1000 -> riskLot 0.01, default minLot 0.01
  const r = computeLot({ ...base, riskUsd: 10, entry: 1000, sl: 0 });
  assert.equal(r.lot, 0.01);
});

test("custom minLot floors a very small riskLot", () => {
  // slDistance 10000 -> riskLot 0.001, custom minLot 0.05
  const r = computeLot({ ...base, riskUsd: 10, entry: 10000, sl: 0, minLot: 0.05 });
  assert.equal(r.lot, 0.05);
});

test("avgCorrelation buckets produce expected corrMultiplier and lot", () => {
  // slDistance 10 -> riskLot 1 (within [0.01, 2], no clamping)
  const input = { riskUsd: 10, maxLotPerTrade: 2, entry: 100, sl: 90 };

  const high = computeLot({ ...input, avgCorrelation: 0.85 });
  assert.equal(high.corrMultiplier, 0.7);
  assert.equal(high.lot, 0.7);

  const medium = computeLot({ ...input, avgCorrelation: 0.65 });
  assert.equal(medium.corrMultiplier, 0.85);
  assert.equal(medium.lot, 0.85);

  const low = computeLot({ ...input, avgCorrelation: 0.3 });
  assert.equal(low.corrMultiplier, 1);
  assert.equal(low.lot, 1);

  const none = computeLot({ ...input, avgCorrelation: null });
  assert.equal(none.corrMultiplier, 1);
  assert.equal(none.lot, 1);
});

test("slDistance <= 0 falls back to minLot", () => {
  const r = computeLot({ ...base, entry: 100, sl: 100 });
  assert.equal(r.lot, 0.01);
  assert.equal(r.corrMultiplier, 1);
  assert.match(r.reasoning, /min lot/i);
});

test("reasoning includes correlation note only when correlation is non-null", () => {
  const withCorr = computeLot({ riskUsd: 10, maxLotPerTrade: 2, avgCorrelation: 0.65, entry: 100, sl: 90 });
  assert.match(withCorr.reasoning, /corr 0\.65/);

  const withoutCorr = computeLot({ riskUsd: 10, maxLotPerTrade: 2, avgCorrelation: null, entry: 100, sl: 90 });
  assert.doesNotMatch(withoutCorr.reasoning, /corr/);
});
