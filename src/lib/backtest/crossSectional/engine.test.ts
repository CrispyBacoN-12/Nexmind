import { test } from "node:test";
import assert from "node:assert/strict";
import { crossSectionalBacktest } from "./engine";
import type { CsConfig } from "./types";
import type { Candle } from "@/lib/indicators";

const DAY = 86_400;

/** Build a series from an explicit close path; O/H/L are derived from the close. */
function series(closes: number[], volume = 5_000_000): Candle[] {
  return closes.map((c, i) => ({
    t: (i + 1) * DAY, o: c, h: c * 1.01, l: c * 0.99, c, v: volume,
  }));
}

/** A rising baseline long enough to clear the 200-bar warm-up. */
function risingBase(n: number, start = 100): number[] {
  return Array.from({ length: n }, (_, i) => start + i * 0.1);
}

// Filters off, maxRankScore at 0: on a rising baseline nothing qualifies, so
// each fixture's single engineered dip produces exactly one trade to assert on.
const cfg: CsConfig = {
  lookback: 3, measure: "atrReturn", maxRankScore: 0,
  minPrice: 5, minDollarVol: 1_000_000,
  requireAboveSma200: false, regime: "off", maxSingleDayMovePct: null,
  slots: 1, holdDays: 3, exitOnSma5: false, stopAtrMult: null,
  costs: {}, capital: 10_000, regimeSymbol: "SPY",
};

test("a symbol that dips is bought at the NEXT day's open, not the signal close", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8; // the dip; signal fires on this bar
  const bars = new Map<string, Candle[]>([["AAA", series(closes)]]);

  const res = crossSectionalBacktest(bars, cfg);
  assert.equal(res.trades.length, 1);
  // Entry fills on bar 255 (the day after the dip), at its open.
  assert.equal(res.trades[0].entryT, 256 * DAY);
  assert.equal(res.trades[0].entry, series(closes)[255].o);
});

test("future bars cannot change the result (no lookahead)", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;
  const baseline = crossSectionalBacktest(new Map([["AAA", series(closes)]]), cfg);

  // Same history, then a wildly favourable future appended. Trades that were
  // already decided must be byte-identical; only later trades may differ.
  const withFuture = [...closes, ...Array.from({ length: 20 }, (_, i) => 500 + i)];
  const extended = crossSectionalBacktest(new Map([["AAA", series(withFuture)]]), cfg);

  const first = baseline.trades[0];
  const firstExtended = extended.trades[0];
  assert.deepEqual(
    { t: first.entryT, e: first.entry, x: first.exitT },
    { t: firstExtended.entryT, e: firstExtended.entry, x: firstExtended.exitT },
  );
});

test("a position closes after holdDays and reports hold-expiry", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;
  const res = crossSectionalBacktest(new Map([["AAA", series(closes)]]), cfg);
  assert.equal(res.trades[0].reason, "hold-expiry");
  assert.equal(res.trades[0].daysHeld, 3);
});

test("slots cap concurrent positions and selection follows rank order", () => {
  // Two symbols dip on the same day; BBB falls harder, so with one slot BBB wins.
  const aCloses = risingBase(260);
  aCloses[254] = aCloses[254] - 4;
  const bCloses = risingBase(260);
  bCloses[254] = bCloses[254] - 12;

  const bars = new Map<string, Candle[]>([["AAA", series(aCloses)], ["BBB", series(bCloses)]]);
  const res = crossSectionalBacktest(bars, cfg);

  assert.equal(res.trades.filter((t) => t.entryT === 256 * DAY).length, 1);
  assert.equal(res.trades[0].symbol, "BBB");
});

test("the regime symbol is never traded", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;
  const bars = new Map<string, Candle[]>([["SPY", series(closes)]]);
  const res = crossSectionalBacktest(bars, cfg);
  assert.equal(res.trades.length, 0);
});

test("regime spySma200 blocks new entries while SPY is below its SMA200", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;

  // SPY falls steadily, so it sits under its own SMA200 throughout the signal window.
  const spyCloses = Array.from({ length: 260 }, (_, i) => 300 - i * 0.5);

  const bars = new Map<string, Candle[]>([["AAA", series(closes)], ["SPY", series(spyCloses)]]);
  const blocked = crossSectionalBacktest(bars, { ...cfg, regime: "spySma200" });
  const allowed = crossSectionalBacktest(bars, { ...cfg, regime: "off" });

  assert.equal(blocked.trades.length, 0);
  assert.ok(allowed.trades.length > 0);
});

test("a stop closes the position and reports a loss", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8; // the dip that triggers entry at 255's open
  // Then keep collapsing, so the stop is well clear of the entry-day ATR.
  closes[256] = 80;
  closes[257] = 60;
  closes[258] = 55;
  closes[259] = 50;
  const bars = new Map<string, Candle[]>([["AAA", series(closes)]]);

  const res = crossSectionalBacktest(bars, { ...cfg, stopAtrMult: 2 });
  // Do not assert a trade *count*: the bar that trips the stop is itself a large
  // decline, so the engine correctly re-enters afterwards. What this test pins is
  // the stopped trade, and that the stop is what produced it.
  const stopped = res.trades.find((t) => t.reason === "stop");
  assert.ok(stopped, `expected a stop exit, reasons were: ${res.trades.map((t) => t.reason).join(", ")}`);
  assert.equal(res.trades[0], stopped); // the stop is the first exit taken
  assert.ok(stopped.pnl < 0);
  assert.ok(stopped.rMultiple !== null);
  // holdDays is 3, so a hold-expiry exit would not have fired by bar 256.
  assert.ok(stopped.daysHeld < cfg.holdDays);

  // Control: the collapse alone does not produce a stop. Without stopAtrMult the
  // same bars exit on the hold clock, which is what makes the case above causal.
  const noStop = crossSectionalBacktest(bars, cfg);
  assert.ok(!noStop.trades.some((t) => t.reason === "stop"));
});

test("rMultiple is null when the config has no stop", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;
  const res = crossSectionalBacktest(new Map([["AAA", series(closes)]]), cfg);
  assert.equal(res.trades[0].rMultiple, null);
});

test("costs make an otherwise flat round trip lose money", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;
  const bars = new Map<string, Candle[]>([["AAA", series(closes)]]);

  const free = crossSectionalBacktest(bars, cfg);
  const costed = crossSectionalBacktest(bars, { ...cfg, costs: { slippageBps: 0.5, commissionBps: 1 } });
  assert.ok(costed.trades[0].pnl < free.trades[0].pnl);
  assert.ok(costed.trades[0].grossPnl !== costed.trades[0].pnl);
});

test("the equity curve covers every trading day and tracks open positions", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;
  const res = crossSectionalBacktest(new Map([["AAA", series(closes)]]), cfg);

  assert.equal(res.equityCurve.length, 260);
  assert.ok(res.equityCurve.some((p) => p.positions === 1));
  assert.equal(res.summary.tradingDays, 260);
  assert.ok(res.summary.timeInMarketPct > 0);
});

test("a position still open on the final bar is closed as end-of-data", () => {
  const closes = risingBase(260);
  closes[258] = closes[258] - 8; // dips so late that holdDays cannot elapse
  const res = crossSectionalBacktest(new Map([["AAA", series(closes)]]), cfg);
  assert.equal(res.trades.length, 1);
  assert.equal(res.trades[0].reason, "end-of-data");
});

test("an empty universe returns an empty result rather than throwing", () => {
  const res = crossSectionalBacktest(new Map(), cfg);
  assert.equal(res.trades.length, 0);
  assert.equal(res.equityCurve.length, 0);
  assert.equal(res.summary.trades, 0);
});
