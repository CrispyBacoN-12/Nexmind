// The TradingView client is the scan's only price source, so the two things
// that can silently corrupt it are pinned here: the DOT/DASH class-share
// mapping (TradingView says BRK.B, this repo says BRK-B) and number coercion
// (a null or string must become null, never NaN reaching a filter or a sort).
// No test calls the live endpoint.

import { test } from "node:test";
import assert from "node:assert/strict";
import { TV_COLUMNS, buildTvRequest, parseTvResponse } from "./tradingview";

/** A d[] array in TV_COLUMNS order, with overrides keyed by column name. */
function dArray(over: Record<string, unknown> = {}): unknown[] {
  const base: Record<string, unknown> = {
    name: "BRK.B",
    exchange: "NYSE",
    type: "stock",
    close: 450.25,
    change: 1.2,
    gap: 0.4,
    premarket_change: 0.8,
    premarket_volume: 12000,
    "relative_volume_intraday|5": 1.9,
    relative_volume_10d_calc: 1.1,
    average_volume_10d_calc: 3_500_000,
    ATR: 6.5,
    earnings_release_date: 1_761_000_000,
    earnings_release_time: -1,
    earnings_release_next_date: 1_769_000_000,
    earnings_release_next_time: 1,
  };
  return TV_COLUMNS.map((c) => (c in over ? over[c] : base[c]));
}

test("buildTvRequest converts class-share dashes to dots", () => {
  const req = buildTvRequest(["BRK-B", "KO"]);
  const filters = req.filter as Array<{ left: string; operation: string; right: unknown }>;
  assert.ok(
    filters.some(
      (f) =>
        f.left === "name" &&
        f.operation === "in_range" &&
        JSON.stringify(f.right) === JSON.stringify(["BRK.B", "KO"]),
    ),
  );
  assert.ok(filters.some((f) => f.left === "type" && f.operation === "equal" && f.right === "stock"));
  const range = req.range as number[];
  assert.ok(range[1] >= 2);
  assert.deepEqual(req.columns, [...TV_COLUMNS]);
  assert.deepEqual(req.markets, ["america"]);
});

test("parseTvResponse maps a row and converts dots back to dashes", () => {
  const rows = parseTvResponse({ data: [{ s: "NYSE:BRK.B", d: dArray() }] });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.ticker, "BRK-B");
  assert.equal(r.exchange, "NYSE");
  assert.equal(r.type, "stock");
  assert.equal(r.close, 450.25);
  assert.equal(r.changePct, 1.2);
  assert.equal(r.gapPct, 0.4);
  assert.equal(r.premarketChangePct, 0.8);
  assert.equal(r.premarketVolume, 12000);
  assert.equal(r.rvolIntraday, 1.9);
  assert.equal(r.rvol10d, 1.1);
  assert.equal(r.avgVolume10d, 3_500_000);
  assert.equal(r.atr, 6.5);
  assert.equal(r.earningsLastAt, 1_761_000_000);
  assert.equal(r.earningsLastTime, -1);
  assert.equal(r.earningsNextAt, 1_769_000_000);
  assert.equal(r.earningsNextTime, 1);
});

test("parseTvResponse turns non-numbers into null, never NaN", () => {
  const rows = parseTvResponse({
    data: [{ s: "NASDAQ:AAPL", d: dArray({ premarket_change: null, ATR: "6.5", gap: NaN, change: Infinity }) }],
  });
  const r = rows[0];
  assert.equal(r.premarketChangePct, null);
  assert.equal(r.atr, null);
  assert.equal(r.gapPct, null);
  assert.equal(r.changePct, null);
});

test("parseTvResponse throws on a body without data", () => {
  assert.throws(() => parseTvResponse({ error: "x" }));
  assert.throws(() => parseTvResponse(null));
});

test("parseTvResponse throws on a row whose d[] has the wrong length", () => {
  assert.throws(() => parseTvResponse({ data: [{ s: "NYSE:KO", d: [1, 2] }] }));
});

test("parseTvResponse drops a row with no close instead of failing the whole scan", () => {
  const rows = parseTvResponse({
    data: [
      { s: "NYSE:KO", d: dArray({ name: "KO", close: null }) },
      { s: "NYSE:XOM", d: dArray({ name: "XOM" }) },
    ],
  });
  assert.deepEqual(rows.map((r) => r.ticker), ["XOM"]);
});
