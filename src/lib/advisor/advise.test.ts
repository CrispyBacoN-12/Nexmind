import test from "node:test";
import assert from "node:assert/strict";

import type { Candle } from "@/lib/indicators";
import { advise } from "./advise";
import { ADVISOR_NO_EDGE_CLAIM } from "./types";

const DAY = 86_400;
const T0 = Date.parse("2020-01-01T00:00:00Z") / 1000;

/** n daily bars whose close is `close` and whose true range is exactly `range`. */
function bars(n: number, close: number, range = 6): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      t: T0 + i * DAY,
      o: close,
      h: close + range / 2,
      l: close - range / 2,
      c: close,
      v: 1_000_000,
    });
  }
  return out;
}

/** n daily bars rising by `step` each day — used for a benchmark above its SMA200. */
function rising(n: number, start: number, step: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const c = start + i * step;
    out.push({ t: T0 + i * DAY, o: c, h: c, l: c, c, v: 1_000_000 });
  }
  return out;
}

const BASE = {
  ticker: "AAPL",
  capital: 2500,
  maxSlots: 5,
  riskPct: 1,
  holdings: [],
  benchmark: null,
};

test("the worked example composes end to end", () => {
  const res = advise({ ...BASE, candles: bars(60, 180, 6), entryOverride: 180 });
  assert.equal(res.ok, true);
  if (!res.ok) return;

  const card = res.card;
  assert.equal(card.ticker, "AAPL");
  assert.equal(card.entry, 180);
  assert.equal(card.entrySource, "override");
  assert.equal(card.atr, 6);
  assert.equal(card.slDistance, 9);
  assert.equal(card.stop, 171);
  assert.equal(card.sizing.shares, 2);
  assert.equal(card.deployedUsd, 360);
  assert.equal(card.ladder[4].price, 207);
  assert.ok(Math.abs(card.costR - 0.02) < 1e-12);
  assert.equal(card.noEdgeClaim, ADVISOR_NO_EDGE_CLAIM);
});

test("a blank entry falls back to the last close, and asOf is the last bar's date", () => {
  const res = advise({ ...BASE, candles: bars(60, 180, 6) });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.card.entry, 180);
  assert.equal(res.card.entrySource, "last close");
  assert.equal(res.card.lastClose, 180);
  assert.equal(res.card.asOf, "2020-02-29");
});

test("too few bars for ATR is an explicit error, not a card", () => {
  const res = advise({ ...BASE, candles: bars(5, 180, 6) });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.error, /ATR/);
});

test("an empty candle array is an explicit error", () => {
  const res = advise({ ...BASE, candles: [] });
  assert.equal(res.ok, false);
});

test("a missing benchmark renders the card and reads the gate BLIND", () => {
  const res = advise({ ...BASE, candles: bars(60, 180, 6) });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.card.gate.benchAbove, null);
  assert.match(res.card.gate.note, /BLIND/);
  assert.ok(res.card.warnings.some((w) => /benchmark/i.test(w)));
});

test("a benchmark too short for SMA200 reads BLIND and still renders a card", () => {
  const res = advise({ ...BASE, candles: bars(60, 180, 6), benchmark: rising(120, 100, 0.5) });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.card.gate.benchAbove, null);
  assert.equal(res.card.gate.slots, 5);
  assert.equal(res.card.noEdgeClaim, ADVISOR_NO_EDGE_CLAIM);
});

test("a real benchmark above its SMA200 leaves the free slots alone", () => {
  const res = advise({ ...BASE, candles: bars(60, 180, 6), benchmark: rising(300, 100, 0.5) });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.card.gate.benchAbove, true);
  assert.equal(res.card.freeSlots, 5);
  assert.equal(res.card.gate.slots, 5);
});

test("holdings consume slots, and an unfetchable holding still consumes one", () => {
  const res = advise({
    ...BASE,
    candles: bars(60, 180, 6),
    holdings: [
      { ticker: "MSFT", candles: bars(60, 300, 4) },
      { ticker: "NVDA", candles: null },
    ],
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(res.card.freeSlots, 3);
  assert.equal(res.card.correlations.length, 2);

  const nvda = res.card.correlations.find((c) => c.ticker === "NVDA");
  assert.equal(nvda?.correlation, null);
  assert.match(nvda?.note ?? "", /could not be fetched/i);
  assert.ok(res.card.warnings.some((w) => /NVDA/.test(w)));
});

test("holding the asked-about ticker is flagged", () => {
  const res = advise({
    ...BASE,
    candles: bars(60, 180, 6),
    holdings: [{ ticker: "aapl", candles: bars(60, 180, 6) }],
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.card.alreadyHeld, true);
});

test("the correlation multiplier is reported, never folded into shares", () => {
  const res = advise({ ...BASE, candles: bars(60, 180, 6), entryOverride: 180 });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  // No holdings -> no correlation -> multiplier 1, and shares is untouched either way.
  assert.equal(res.card.avgCorrelation, null);
  assert.equal(res.card.corrMultiplier, 1);
  assert.equal(res.card.sizing.shares, 2);
  assert.equal(res.card.corrAdjustedShares, 2);
});
