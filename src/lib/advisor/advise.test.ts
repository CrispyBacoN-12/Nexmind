import test from "node:test";
import assert from "node:assert/strict";

import { atr, type Candle } from "@/lib/indicators";
import { advise } from "./advise";
import { baseRate, BASE_RATE_HORIZON } from "./baseRate";
import { sizeShares } from "./sizing";
import { ADVISOR_ATR_PERIOD, ADVISOR_ATR_SL_MULT, ADVISOR_NO_EDGE_CLAIM, ADVISOR_R_STEPS } from "./types";

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

/**
 * n daily bars whose close zigzags on a 5-day cycle, so daily returns have
 * variance. bars() cannot be used for a correlation test — a constant close
 * means zero variance and pearsonCorrelation returns null. Two zigzag series
 * built from different bases follow the same pattern, so they correlate ~1.
 */
function zigzag(n: number, base: number, range = 6): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const c = base + ((i % 5) - 2);
    out.push({ t: T0 + i * DAY, o: c, h: c + range / 2, l: c - range / 2, c, v: 1_000_000 });
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
  // The multiplier must actually be < 1 or this test asserts nothing: with no
  // holdings corrMultiplier is 1 and folding it in would change no number.
  const candles = zigzag(60, 180);
  const res = advise({
    ...BASE,
    candles,
    entryOverride: 180,
    holdings: [
      { ticker: "MSFT", candles: zigzag(60, 300) },
      { ticker: "NVDA", candles: zigzag(60, 420) },
    ],
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  const card = res.card;

  assert.ok(card.corrMultiplier < 1, `expected a damping multiplier, got ${card.corrMultiplier}`);
  assert.ok(card.sizing.shares > 0);

  // Shares must equal what sizeShares returns for the same inputs — unadjusted.
  const atrValue = atr(candles, ADVISOR_ATR_PERIOD).at(-1) as number;
  const expected = sizeShares({
    entry: 180,
    slDistance: ADVISOR_ATR_SL_MULT * atrValue,
    capital: BASE.capital,
    maxSlots: BASE.maxSlots,
    riskPct: BASE.riskPct,
  });
  assert.equal(card.sizing.shares, expected.shares);

  // And the adjusted number is a SEPARATE, strictly smaller field.
  assert.ok(
    card.corrAdjustedShares < card.sizing.shares,
    `corrAdjustedShares ${card.corrAdjustedShares} should be below shares ${card.sizing.shares}`,
  );

  // Both series end on the same date, so neither reading is hedged.
  assert.deepEqual(
    card.correlations.map((c) => c.note),
    ["", ""],
  );
});

test("a holding whose series ends earlier is reported as approximate, not clean", () => {
  const res = advise({
    ...BASE,
    candles: zigzag(60, 180),
    entryOverride: 180,
    holdings: [{ ticker: "MSFT", candles: zigzag(59, 300) }],
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(res.card.asOf, "2020-02-29");
  const line = res.card.correlations[0];
  assert.ok(line.correlation != null, "the correlation is still computed and shown");
  assert.notEqual(line.note, "");
  assert.match(line.note, /2020-02-28/);
  assert.match(line.note, /2020-02-29/);
  assert.ok(res.card.warnings.some((w) => /MSFT/.test(w) && /approximate/i.test(w)));
});

test("inputNotes are prepended to the card's warnings, ahead of any core warning", () => {
  const note = "Counted MSFT once — 1 duplicate entry was collapsed.";
  const res = advise({ ...BASE, candles: bars(60, 180, 6), inputNotes: [note] });
  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(res.card.warnings[0], note);
  // BASE has no benchmark, so the core pushes its own warning afterwards.
  const coreIndex = res.card.warnings.findIndex((w) => /benchmark/i.test(w));
  assert.ok(coreIndex > 0, "the core-generated warning must follow the caller's notes");
});

test("a fresh quote past the walk-away price is a warning; the card's own size is untouched", () => {
  const candles = bars(40, 100);
  const nowSec = candles[candles.length - 1].t + 3600;
  const plain = advise({ ...BASE, candles });
  const moved = advise({ ...BASE, candles, quote: { price: 120, at: nowSec - 60 }, nowSec });
  assert.ok(plain.ok && moved.ok);
  assert.equal(moved.card.sizing.shares, plain.card.sizing.shares);
  assert.equal(moved.card.fillGuard.atQuote?.overWalkAway, true);
  assert.ok(moved.card.warnings.includes(moved.card.fillGuard.quoteNote));
  assert.equal(plain.card.fillGuard.quote, null);
});

// --- chart stop (?stop=) -----------------------------------------------------

/** A deterministic random walk, so stop-first counts differ between stop multiples. */
function walkBars(n: number, start: number): Candle[] {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const out: Candle[] = [];
  let prev = start;
  for (let i = 0; i < n; i++) {
    const o = prev * (1 + (rnd() - 0.5) * 0.01);
    const c = o * (1 + (rnd() - 0.5) * 0.03);
    const h = Math.max(o, c) * (1 + rnd() * 0.01);
    const l = Math.min(o, c) * (1 - rnd() * 0.01);
    out.push({ t: T0 + i * DAY, o, h, l, c, v: 1_000_000 });
    prev = c;
  }
  return out;
}

test("a chart stop below the entry replaces the ATR stop and drives the sizing", () => {
  const res = advise({ ...BASE, candles: bars(60, 100, 6), entryOverride: 100, stopOverride: 95 });
  assert.ok(res.ok);
  const card = res.card;
  assert.equal(card.stop, 95);
  assert.equal(card.slDistance, 5);
  assert.equal(card.stopSource, "chart");
  assert.ok(Math.abs(card.stopAtrMult - 5 / 6) < 1e-12);
  const expected = sizeShares({ entry: 100, slDistance: 5, capital: 2500, maxSlots: 5, riskPct: 1 });
  assert.deepEqual(card.sizing, expected);
  assert.equal(card.ladder[0].price, 105);
  assert.equal(card.warnings.some((w) => /Stop จากกราฟ/.test(w)), false);
});

test("a chart stop is judged against the FINAL entry, the last close when no entry is given", () => {
  const res = advise({ ...BASE, candles: bars(60, 100, 6), stopOverride: 96 });
  assert.ok(res.ok);
  assert.equal(res.card.entry, 100);
  assert.equal(res.card.stop, 96);
  assert.equal(res.card.stopSource, "chart");
});

test("a chart stop above the entry is ignored with a warning and the ATR stop is used", () => {
  const res = advise({ ...BASE, candles: bars(60, 100, 6), entryOverride: 100, stopOverride: 101 });
  assert.ok(res.ok);
  const card = res.card;
  assert.equal(card.stopSource, "atr");
  assert.equal(card.stop, 100 - ADVISOR_ATR_SL_MULT * 6);
  assert.equal(card.stopAtrMult, ADVISOR_ATR_SL_MULT);
  assert.ok(card.warnings.includes("Stop จากกราฟ (101) ไม่ได้อยู่ใต้ราคาเข้า จึงใช้ 1.5×ATR แทน"));
});

test("a chart stop equal to the entry, non-finite, or not positive is ignored", () => {
  for (const bad of [100, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const res = advise({ ...BASE, candles: bars(60, 100, 6), entryOverride: 100, stopOverride: bad });
    assert.ok(res.ok);
    assert.equal(res.card.stopSource, "atr", `stop ${bad}`);
    assert.equal(res.card.stop, 91, `stop ${bad}`);
    assert.ok(res.card.warnings.some((w) => /^Stop จากกราฟ \(/.test(w)), `stop ${bad}`);
  }
});

test("no stop override: ATR stop, stopAtrMult is exactly 1.5, no warning", () => {
  const res = advise({ ...BASE, candles: bars(60, 100, 6), entryOverride: 100 });
  assert.ok(res.ok);
  assert.equal(res.card.stopSource, "atr");
  assert.equal(res.card.stopAtrMult, 1.5);
  assert.equal(res.card.warnings.some((w) => /Stop จากกราฟ/.test(w)), false);
  const nul = advise({ ...BASE, candles: bars(60, 100, 6), entryOverride: 100, stopOverride: null });
  assert.ok(nul.ok);
  assert.equal(nul.card.stopSource, "atr");
});

test("the base-rate table replays the card's stop multiple, not the constant", () => {
  const hist = walkBars(400, 100);
  const withChart = advise({
    ...BASE,
    candles: bars(60, 100, 6),
    entryOverride: 100,
    stopOverride: 98, // 2 / 6 ATR: far tighter than 1.5
    gapHistory: hist,
  });
  const plain = advise({ ...BASE, candles: bars(60, 100, 6), entryOverride: 100, gapHistory: hist });
  assert.ok(withChart.ok && plain.ok);
  const mult = withChart.card.stopAtrMult;
  assert.ok(Math.abs(mult - 2 / 6) < 1e-12);

  assert.deepEqual(withChart.card.baseRate, baseRate(hist, ADVISOR_R_STEPS, BASE_RATE_HORIZON, mult));
  assert.deepEqual(plain.card.baseRate, baseRate(hist));
  // The fixture must actually discriminate between the two multiples.
  assert.notEqual(
    withChart.card.baseRate?.rows[0].stopFirstPct,
    plain.card.baseRate?.rows[0].stopFirstPct,
  );
});
