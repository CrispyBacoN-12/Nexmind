import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeries, isEligible, rankScore } from "./signals";
import type { CsConfig } from "./types";
import type { Candle } from "@/lib/indicators";

const DAY = 86_400;

/** A flat series at `price`, long enough for SMA200 to exist. */
function flatSeries(n: number, price: number, volume = 1_000_000): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    t: (i + 1) * DAY, o: price, h: price * 1.01, l: price * 0.99, c: price, v: volume,
  }));
}

/**
 * A gently rising series. Wilder's RSI needs at least some up-moves to produce
 * distinguishable values — on a series with none, avgGain stays exactly 0 and
 * every RSI reading pins to 0 (or to 100 while avgLoss is also 0).
 */
function risingSeries(n: number, start: number, step = 0.1, volume = 1_000_000): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const p = start + i * step;
    return { t: (i + 1) * DAY, o: p, h: p * 1.01, l: p * 0.99, c: p, v: volume };
  });
}

// Optional filters start OFF here so each test can switch on exactly the one it
// is exercising. A fixture built to trip the SMA200 filter also trips the
// news filter, and vice versa — turning both on by default would make every
// assertion pass for the wrong reason.
const baseCfg: CsConfig = {
  lookback: 3, measure: "atrReturn", maxRankScore: 0,
  minPrice: 5, minDollarVol: 10_000_000,
  requireAboveSma200: false, regime: "off", maxSingleDayMovePct: null,
  slots: 5, holdDays: 5, exitOnSma5: false, stopAtrMult: null,
  costs: {}, capital: 10_000, regimeSymbol: "SPY",
};

test("buildSeries returns arrays aligned to the input length", () => {
  const s = buildSeries(flatSeries(250, 100));
  assert.equal(s.candles.length, 250);
  assert.equal(s.atr.length, 250);
  assert.equal(s.sma200.length, 250);
  assert.equal(s.sma5.length, 250);
  assert.equal(s.rsi2.length, 250);
  assert.equal(s.dollarVol20.length, 250);
  assert.equal(s.maxMovePct20.length, 250);
});

test("dollarVol20 averages close * volume over the trailing 20 bars", () => {
  const s = buildSeries(flatSeries(250, 100, 500_000));
  assert.equal(s.dollarVol20[249], 100 * 500_000);
  assert.equal(s.dollarVol20[5], null); // not enough history yet
});

test("isEligible rejects a symbol below the price floor", () => {
  const s = buildSeries(flatSeries(250, 3));
  assert.equal(isEligible(s, 249, baseCfg), false);
});

test("isEligible rejects a symbol below the dollar-volume floor", () => {
  const s = buildSeries(flatSeries(250, 100, 1000)); // $100k/day, well under $10M
  assert.equal(isEligible(s, 249, baseCfg), false);
});

test("isEligible rejects a symbol under its own SMA200 when the quality filter is on", () => {
  const candles = flatSeries(250, 100);
  for (let i = 240; i < 250; i++) { // sharp drop below the long average
    candles[i] = { ...candles[i], o: 50, h: 51, l: 49, c: 50 };
  }
  const s = buildSeries(candles);
  assert.equal(isEligible(s, 249, { ...baseCfg, requireAboveSma200: true }), false);
  assert.equal(isEligible(s, 249, baseCfg), true); // filter off: nothing else objects
});

test("isEligible rejects a symbol with a news-sized single-day move", () => {
  const candles = flatSeries(250, 100);
  candles[245] = { ...candles[245], o: 100, h: 130, l: 100, c: 125 }; // +25% day
  const s = buildSeries(candles);
  assert.equal(isEligible(s, 249, { ...baseCfg, maxSingleDayMovePct: 15 }), false);
  assert.equal(isEligible(s, 249, baseCfg), true); // filter off: nothing else objects
});

test("isEligible rejects indexes before the warm-up period completes", () => {
  const s = buildSeries(flatSeries(250, 100));
  assert.equal(isEligible(s, 10, baseCfg), false);
});

test("rankScore: atrReturn is negative for a faller and positive for a riser", () => {
  const down = flatSeries(250, 100);
  for (let i = 247; i < 250; i++) down[i] = { ...down[i], o: 95, h: 96, l: 94, c: 95 };
  const up = flatSeries(250, 100);
  for (let i = 247; i < 250; i++) up[i] = { ...up[i], o: 105, h: 106, l: 104, c: 105 };

  const downScore = rankScore(buildSeries(down), 249, baseCfg);
  const upScore = rankScore(buildSeries(up), 249, baseCfg);
  assert.ok(downScore !== null && upScore !== null);
  assert.ok(downScore < 0, `expected faller to score negative, got ${downScore}`);
  assert.ok(upScore > 0, `expected riser to score positive, got ${upScore}`);
  assert.ok(downScore < upScore); // lower = better candidate
});

test("rankScore: the rsi2 measure ranks the more oversold symbol lower", () => {
  const cfg: CsConfig = { ...baseCfg, measure: "rsi2" };
  // Rising baseline, not flat — see risingSeries. Each fixture's drop is written
  // relative to the previous close so the numbers do not depend on `step`.
  const mild = risingSeries(250, 100);
  const mPrev = mild[248].c;
  mild[249] = { ...mild[249], o: mPrev, h: mPrev, l: mPrev - 0.9, c: mPrev - 0.9 };

  const severe = risingSeries(250, 100);
  const sPrev = severe[247].c;
  severe[248] = { ...severe[248], o: sPrev, h: sPrev, l: sPrev - 5, c: sPrev - 5 };
  const sPrev2 = severe[248].c;
  severe[249] = { ...severe[249], o: sPrev2, h: sPrev2, l: sPrev2 - 5, c: sPrev2 - 5 };

  const mildScore = rankScore(buildSeries(mild), 249, cfg);
  const severeScore = rankScore(buildSeries(severe), 249, cfg);
  assert.ok(mildScore !== null && severeScore !== null);
  assert.ok(severeScore < mildScore, `expected ${severeScore} < ${mildScore}`);
});

test("rankScore returns null before the lookback window is available", () => {
  assert.equal(rankScore(buildSeries(flatSeries(250, 100)), 1, baseCfg), null);
});
