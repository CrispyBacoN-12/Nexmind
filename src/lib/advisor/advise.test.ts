import test from "node:test";
import assert from "node:assert/strict";

import { atr, type Candle } from "@/lib/indicators";
import { advise } from "./advise";
import { findChartStop } from "./chartStop";
import { baseRate, BASE_RATE_HORIZON } from "./baseRate";
import { fillGuard } from "./fillGuard";
import { gapRisk } from "./gapRisk";
import { costInR } from "./rLadder";
import { sizeShares } from "./sizing";
import {
  ADVISOR_ATR_PERIOD,
  ADVISOR_ATR_SL_MULT,
  ADVISOR_COST_BPS,
  ADVISOR_NO_EDGE_CLAIM,
  ADVISOR_R_STEPS,
} from "./types";

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

test("a given stop below the entry replaces the ATR stop and drives the sizing", () => {
  const res = advise({ ...BASE, candles: bars(60, 100, 6), entryOverride: 100, stopOverride: 95 });
  assert.ok(res.ok);
  const card = res.card;
  assert.equal(card.stop, 95);
  assert.equal(card.slDistance, 5);
  assert.equal(card.stopSource, "given");
  assert.ok(Math.abs(card.stopAtrMult - 5 / 6) < 1e-12);
  const expected = sizeShares({ entry: 100, slDistance: 5, capital: 2500, maxSlots: 5, riskPct: 1 });
  assert.deepEqual(card.sizing, expected);
  assert.equal(card.ladder[0].price, 105);
  assert.equal(card.warnings.some((w) => /Stop ที่ให้มา/.test(w)), false);
});

test("a given stop is judged against the FINAL entry, the last close when no entry is given", () => {
  const res = advise({ ...BASE, candles: bars(60, 100, 6), stopOverride: 96 });
  assert.ok(res.ok);
  assert.equal(res.card.entry, 100);
  assert.equal(res.card.stop, 96);
  assert.equal(res.card.stopSource, "given");
});

test("a given stop above the entry is ignored with a warning and the ATR stop is used", () => {
  const res = advise({ ...BASE, candles: bars(60, 100, 6), entryOverride: 100, stopOverride: 101 });
  assert.ok(res.ok);
  const card = res.card;
  assert.equal(card.stopSource, "atr");
  assert.equal(card.stop, 100 - ADVISOR_ATR_SL_MULT * 6);
  assert.equal(card.stopAtrMult, ADVISOR_ATR_SL_MULT);
  assert.ok(card.warnings.includes("Stop ที่ให้มา (101) ไม่ได้อยู่ใต้ราคาเข้า จึงหา stop จากกราฟแทน"));
});

test("a given stop equal to the entry, non-finite, or not positive is ignored", () => {
  for (const bad of [100, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const res = advise({ ...BASE, candles: bars(60, 100, 6), entryOverride: 100, stopOverride: bad });
    assert.ok(res.ok);
    assert.equal(res.card.stopSource, "atr", `stop ${bad}`);
    assert.equal(res.card.stop, 91, `stop ${bad}`);
    assert.ok(res.card.warnings.some((w) => /^Stop ที่ให้มา \(/.test(w)), `stop ${bad}`);
  }
});

test("no stop override: ATR stop, stopAtrMult is exactly 1.5, no warning", () => {
  const res = advise({ ...BASE, candles: bars(60, 100, 6), entryOverride: 100 });
  assert.ok(res.ok);
  assert.equal(res.card.stopSource, "atr");
  assert.equal(res.card.stopAtrMult, 1.5);
  assert.equal(res.card.warnings.some((w) => /Stop ที่ให้มา/.test(w)), false);
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

test("a given stop reaches gap risk, cost in R and the fill guard, not only sizing", () => {
  const hist = walkBars(400, 100);
  const candles = bars(60, 100, 6);
  const nowSec = candles[candles.length - 1].t + 3600;
  const quote = { price: 100.5, at: nowSec - 60 };
  const common = { ...BASE, candles, entryOverride: 100, gapHistory: hist, quote, nowSec };
  const withChart = advise({ ...common, stopOverride: 98 });
  const plain = advise(common);
  assert.ok(withChart.ok && plain.ok);
  const card = withChart.card;
  assert.equal(card.stopSource, "given");
  assert.equal(card.stop, 98);

  // Gap risk is measured in the chart stop's multiple, and its dollar figure in its distance.
  assert.deepEqual(card.gapRisk, gapRisk(hist, card.stopAtrMult));
  assert.ok(card.gapRisk);
  assert.equal(card.gapWorstLossUsd, card.sizing.shares * 2 * card.gapRisk.worstLossR);
  assert.notDeepEqual(card.gapRisk, plain.card.gapRisk);

  // Round-trip cost against the 2-point chart distance, not the 9-point ATR one.
  assert.equal(card.costR, costInR(100, 100 - 98, ADVISOR_COST_BPS));
  assert.ok(card.costR > plain.card.costR);

  // The fill guard measures risk at the quote down to the chart stop.
  assert.deepEqual(
    card.fillGuard,
    fillGuard({
      entry: 100,
      stop: 98,
      sizing: card.sizing,
      capital: BASE.capital,
      maxSlots: BASE.maxSlots,
      riskPct: BASE.riskPct,
      quote,
      nowSec,
    }),
  );
  assert.ok(card.fillGuard.atQuote);
  assert.equal(card.fillGuard.atQuote.plannedRiskUsd, card.sizing.shares * (100.5 - 98));
  assert.notEqual(card.fillGuard.walkAwayPrice, plain.card.fillGuard.walkAwayPrice);
});

// ---- the stop chain: given -> 5-minute swing -> PDL -> ATR ----------------
// Real 5-minute bars, so findChartStop runs for real. 2026-10-27..29 are EDT
// (UTC-4): 09:30 ET is 13:30Z. Only the lows matter to the pivot rule.
const INTRADAY_CUTOFF = Date.parse("2030-01-01T00:00:00Z") / 1000;

function intradaySession(date: string, lows: number[]): Candle[] {
  return lows.map((low, i) => {
    const mins = 9 * 60 + 30 + i * 5;
    const hh = String(Math.floor(mins / 60) + 4).padStart(2, "0");
    const mm = String(mins % 60).padStart(2, "0");
    const t = Date.parse(`${date}T${hh}:${mm}:00Z`) / 1000;
    return { t, o: low + 0.2, h: low + 0.2, l: low, c: low + 0.2, v: 1000 };
  });
}

/** A previous session (lowest bar `prevLow`) then a session whose one pivot low is `pivot`. */
function intradayWith(pivot: number, prevLow = 90) {
  const prev = intradaySession("2026-10-27", [prevLow + 2, prevLow + 1, prevLow, prevLow + 1, prevLow + 2, prevLow + 3]);
  const day = intradaySession("2026-10-28", [
    pivot + 4, pivot + 3.5, pivot, pivot + 3, pivot + 3.5, pivot + 4, pivot + 4.5, pivot + 5, pivot + 5.5, pivot + 6,
  ]);
  return { candles: [...prev, ...day], cutoffSec: INTRADAY_CUTOFF };
}

const CHAIN = { ...BASE, candles: bars(60, 100, 6), entryOverride: 100 };

test("a given stop wins over a swing low in the intraday bars", () => {
  const res = advise({ ...CHAIN, stopOverride: 95, intraday: intradayWith(96) });
  assert.ok(res.ok);
  assert.equal(res.card.stopSource, "given");
  assert.equal(res.card.stop, 95);
  assert.equal(res.card.stopStructure, null);
  assert.deepEqual(res.card.stopNotes, []);
  assert.equal(res.card.atrAlternative?.stop, 100 - ADVISOR_ATR_SL_MULT * 6);
});

test("no given stop: the swing low drives stop, size and stopAtrMult", () => {
  const intraday = intradayWith(96);
  const found = findChartStop({ candles: intraday.candles, entry: 100, atr: 6, cutoffSec: intraday.cutoffSec });
  assert.equal(found.kind, "found");
  if (found.kind !== "found") return;
  const res = advise({ ...CHAIN, intraday });
  assert.ok(res.ok);
  const card = res.card;
  assert.equal(card.stopSource, "swing");
  assert.equal(card.stop, found.stop);
  assert.ok(Math.abs(card.stop - 95.4) < 1e-9);
  assert.equal(card.slDistance, 100 - found.stop);
  assert.equal(card.stopAtrMult, (100 - found.stop) / 6);
  assert.deepEqual(card.stopStructure, found.structure);
  assert.deepEqual(card.stopNotes, []);
  assert.deepEqual(card.stopFlags, []);
  assert.deepEqual(
    card.sizing,
    sizeShares({ entry: 100, slDistance: 100 - found.stop, capital: 2500, maxSlots: 5, riskPct: 1 }),
  );
  assert.deepEqual(card.atrAlternative, {
    stop: 100 - ADVISOR_ATR_SL_MULT * 6,
    atrMult: ADVISOR_ATR_SL_MULT,
    shares: sizeShares({ entry: 100, slDistance: ADVISOR_ATR_SL_MULT * 6, capital: 2500, maxSlots: 5, riskPct: 1 }).shares,
  });
});

test("a typed entry below every pivot falls to PDL with the swing reason", () => {
  const res = advise({ ...CHAIN, entryOverride: 94, intraday: intradayWith(96, 88) });
  assert.ok(res.ok);
  const card = res.card;
  assert.equal(card.stopSource, "pdl");
  assert.ok(Math.abs(card.stop - 87.4) < 1e-9);
  assert.ok(card.stopNotes[0].startsWith("ไม่มี swing low"));
  assert.equal(card.stopStructure?.level, 88);
  assert.equal(card.stopStructure?.sessionDate, "2026-10-27");
  assert.notEqual(card.atrAlternative, null);
});

test("neither swing nor PDL under the entry falls to ATR with both reasons", () => {
  const res = advise({ ...CHAIN, entryOverride: 80, intraday: intradayWith(96, 88) });
  assert.ok(res.ok);
  const card = res.card;
  assert.equal(card.stopSource, "atr");
  assert.equal(card.stop, 80 - ADVISOR_ATR_SL_MULT * 6);
  assert.equal(card.stopStructure, null);
  assert.equal(card.stopNotes.length, 3);
  assert.ok(card.stopNotes[0].startsWith("ไม่มี swing low"));
  assert.equal(card.stopNotes[2], "จึงใช้ 1.5×ATR");
  assert.equal(card.atrAlternative, null);
});

test("an intraday fetch error falls to ATR with the reason", () => {
  const res = advise({ ...CHAIN, intraday: { error: "timeout" } });
  assert.ok(res.ok);
  const card = res.card;
  assert.equal(card.stopSource, "atr");
  assert.deepEqual(card.stopNotes, ["ดึงกราฟ 5 นาทีไม่ได้: timeout", "จึงใช้ 1.5×ATR"]);
  assert.equal(card.atrAlternative, null);
});

test("an invalid given stop warns and the chain continues to the swing low", () => {
  const res = advise({ ...CHAIN, stopOverride: 101, intraday: intradayWith(96) });
  assert.ok(res.ok);
  assert.equal(res.card.stopSource, "swing");
  assert.ok(res.card.warnings.includes("Stop ที่ให้มา (101) ไม่ได้อยู่ใต้ราคาเข้า จึงหา stop จากกราฟแทน"));
  assert.deepEqual(res.card.stopNotes, []);
});

test("no intraday input keeps today's ATR card with no stop notes", () => {
  for (const intraday of [undefined, null]) {
    const res = advise({ ...CHAIN, intraday });
    assert.ok(res.ok);
    assert.equal(res.card.stopSource, "atr");
    assert.deepEqual(res.card.stopNotes, []);
    assert.deepEqual(res.card.stopFlags, []);
    assert.equal(res.card.stopStructure, null);
    assert.equal(res.card.atrAlternative, null);
  }
});

test("a stop under 0.5 ATR is flagged tight, never moved", () => {
  const res = advise({ ...CHAIN, intraday: intradayWith(99.5) }); // stop 98.9, distance 1.1 = 0.18 ATR
  assert.ok(res.ok);
  assert.equal(res.card.stopSource, "swing");
  assert.ok(Math.abs(res.card.stop - 98.9) < 1e-9);
  assert.deepEqual(res.card.stopFlags, ["แคบมาก โดน noise ง่าย"]);
});

test("a stop over 3 ATR is flagged wide", () => {
  const res = advise({ ...CHAIN, intraday: intradayWith(80) }); // stop 79.4, distance 20.6 = 3.4 ATR
  assert.ok(res.ok);
  assert.equal(res.card.stopSource, "swing");
  assert.deepEqual(res.card.stopFlags, ["กว้างมาก หุ้นที่ซื้อได้จะน้อย"]);
});
