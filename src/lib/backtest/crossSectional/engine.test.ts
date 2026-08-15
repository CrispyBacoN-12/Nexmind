import { test } from "node:test";
import assert from "node:assert/strict";
import { crossSectionalBacktest } from "./engine";
import { buildSeries } from "./signals";
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

// --- Fix round 1 regression tests (C1, C2, and the rest of the review) ---

test("point-in-time sizing: a still-open position's TODAY close cannot influence a new entry's size on the same day (C1 regression)", () => {
  const holdCfg: CsConfig = { ...cfg, slots: 2, holdDays: 200 };

  const aClosesBase = risingBase(260);
  aClosesBase[220] -= 8; // AAA dips and enters; holdDays is huge so it stays open throughout
  const bCloses = risingBase(260);
  bCloses[254] -= 8; // BBB dips; its entry fills at day 256's open (bar index 255)

  // BBB's entry fill day is bar index 255 (day 256). Perturb ONLY AAA's close on
  // that exact day; sizing must be based on yesterday's mark, so this must have
  // zero effect on BBB's share count.
  const build = (aaaCloseOnFillDay: number) => {
    const a = [...aClosesBase];
    a[255] = aaaCloseOnFillDay;
    return new Map<string, Candle[]>([["AAA", series(a)], ["BBB", series(bCloses)]]);
  };

  const baseline = crossSectionalBacktest(build(aClosesBase[255]), holdCfg);
  const perturbed = crossSectionalBacktest(build(500), holdCfg);

  const b1 = baseline.trades.find((t) => t.symbol === "BBB");
  const b2 = perturbed.trades.find((t) => t.symbol === "BBB");
  assert.ok(b1 && b2, "BBB should have entered in both runs");
  assert.equal(b1!.shares, b2!.shares);
});

test("slots fill to capacity and each position gets an equal share of equity", () => {
  const slotsCfg: CsConfig = { ...cfg, slots: 3 };
  const dip = (amount: number) => {
    const c = risingBase(260);
    c[254] -= amount;
    return c;
  };
  const bars = new Map<string, Candle[]>([
    ["AAA", series(dip(4))],
    ["BBB", series(dip(6))],
    ["CCC", series(dip(8))],
  ]);
  const res = crossSectionalBacktest(bars, slotsCfg);

  const entries = res.trades.filter((t) => t.entryT === 256 * DAY);
  assert.equal(entries.length, 3);
  const target = slotsCfg.capital / 3;
  for (const t of entries) {
    const notional = t.shares * t.entry;
    assert.ok(Math.abs(notional - target) / target < 0.01, `notional ${notional} not within 1% of ${target}`);
  }
});

test("an appreciating held position does not block a later slot from filling (C1 regression)", () => {
  const slotsCfg: CsConfig = { ...cfg, slots: 2, holdDays: 200 };

  const aCloses = risingBase(260);
  aCloses[220] -= 8; // AAA dips and enters
  // AAA then rallies hard, so its mark-to-market grows well past capital/2 while held.
  for (let i = 221; i < 260; i++) aCloses[i] = aCloses[220] * (1 + 0.01 * (i - 220));

  const bCloses = risingBase(260);
  bCloses[254] -= 8; // BBB dips mid-hold, well after AAA's rally is underway

  const bars = new Map<string, Candle[]>([["AAA", series(aCloses)], ["BBB", series(bCloses)]]);
  const res = crossSectionalBacktest(bars, slotsCfg);

  const bbbEntry = res.trades.find((t) => t.symbol === "BBB");
  assert.ok(bbbEntry, "BBB's entry should still fill even though AAA's book has appreciated");
});

test("cash conservation: final equity equals capital plus total realized pnl", () => {
  const closes = risingBase(260);
  closes[254] -= 8;
  const costedCfg: CsConfig = { ...cfg, costs: { slippageBps: 0.5, commissionBps: 1 } };
  const res = crossSectionalBacktest(new Map([["AAA", series(closes)]]), costedCfg);

  const finalEquity = res.equityCurve[res.equityCurve.length - 1].equity;
  assert.ok(Math.abs(finalEquity - (costedCfg.capital + res.summary.totalPnl)) < 1e-6);
});

test("a symbol that keeps qualifying while held is not entered twice (no re-entry while open)", () => {
  const manySlots: CsConfig = { ...cfg, slots: 3, holdDays: 5 };
  const closes = risingBase(260);
  // From bar 220 on, keep declining so the symbol would re-qualify as a
  // candidate on every day it is checked, including while it is held.
  for (let i = 220; i < 260; i++) closes[i] = closes[219] - (i - 219) * 2;

  const res = crossSectionalBacktest(new Map([["AAA", series(closes)]]), manySlots);
  assert.ok(res.equityCurve.every((p) => p.positions <= 1));
});

test("exitOnSma5 exits early with reason sma5 when the close recrosses above SMA5", () => {
  const closes = risingBase(260);
  closes[254] -= 8;
  const res = crossSectionalBacktest(new Map([["AAA", series(closes)]]), { ...cfg, exitOnSma5: true });
  assert.equal(res.trades[0].reason, "sma5");
  assert.ok(res.trades[0].daysHeld < cfg.holdDays);
});

test("stop fill price: a low that pierces the stop without a gap fills at the stop, not the low", () => {
  const closes = risingBase(260);
  closes[254] -= 8;
  const candles = series(closes);
  const s = buildSeries(candles);
  const entryIdx = 255; // bar the entry fills on (day 256's open)
  // Mirrors the engine's own I1 fix: the stop is sized off the bar BEFORE entry.
  const expectedStop = candles[entryIdx].o - 2 * s.atr[entryIdx - 1]!;

  const withPierce = candles.map((c, i) =>
    i === 256 ? { ...c, o: expectedStop + 3, h: expectedStop + 4, l: expectedStop - 5, c: expectedStop - 4 } : c,
  );
  const res = crossSectionalBacktest(new Map([["AAA", withPierce]]), { ...cfg, stopAtrMult: 2 });
  const stopped = res.trades.find((t) => t.reason === "stop");
  assert.ok(stopped);
  assert.equal(stopped!.exit, expectedStop);
});

test("stop fill price: an open that gaps below the stop fills at the open, not the stop", () => {
  const closes = risingBase(260);
  closes[254] -= 8;
  const candles = series(closes);
  const s = buildSeries(candles);
  const entryIdx = 255;
  const expectedStop = candles[entryIdx].o - 2 * s.atr[entryIdx - 1]!;
  const gapOpen = expectedStop - 10;

  const withGap = candles.map((c, i) =>
    i === 256 ? { ...c, o: gapOpen, h: gapOpen + 1, l: gapOpen - 5, c: gapOpen - 3 } : c,
  );
  const res = crossSectionalBacktest(new Map([["AAA", withGap]]), { ...cfg, stopAtrMult: 2 });
  const stopped = res.trades.find((t) => t.reason === "stop");
  assert.ok(stopped);
  assert.equal(stopped!.exit, gapOpen);
});

test("commission is charged once per trade, not on both legs", () => {
  const closes = risingBase(260);
  closes[254] -= 8;
  const bars = new Map<string, Candle[]>([["AAA", series(closes)]]);
  const commissionBps = 10;

  const free = crossSectionalBacktest(bars, cfg);
  const costed = crossSectionalBacktest(bars, { ...cfg, costs: { slippageBps: 0, commissionBps } });

  const notional = free.trades[0].shares * free.trades[0].entry;
  const expectedCommission = notional * (commissionBps / 10_000);
  assert.ok(Math.abs(free.trades[0].pnl - costed.trades[0].pnl - expectedCommission) < 1e-6);
});

test("running the same input twice produces byte-identical trades (determinism)", () => {
  const closes = risingBase(260);
  closes[254] -= 8;
  const bars = new Map<string, Candle[]>([["AAA", series(closes)]]);

  const r1 = crossSectionalBacktest(bars, cfg);
  const r2 = crossSectionalBacktest(bars, cfg);
  assert.deepEqual(r1.trades, r2.trades);
});

test("a symbol that stops trading mid-hold is force-closed at its last known price, not held forever (C2 regression)", () => {
  const aCloses = risingBase(260);
  aCloses[220] -= 8; // dip, causing entry
  // Crash hard after entry, then the symbol stops producing bars altogether.
  for (let i = 221; i < 235; i++) aCloses[i] = aCloses[220] * (1 - 0.05 * (i - 220));
  const aCandles = series(aCloses).slice(0, 235); // last AAA bar is day 235

  // BBB supplies bars through the full window, so the universe's last day (260)
  // is well past AAA's delisting on day 235.
  const bCloses = risingBase(260);
  const bCandles = series(bCloses);

  const holdCfg: CsConfig = { ...cfg, holdDays: 200 }; // still open when the bars stop
  const res = crossSectionalBacktest(new Map([["AAA", aCandles], ["BBB", bCandles]]), holdCfg);

  const aaaTrade = res.trades.find((t) => t.symbol === "AAA");
  assert.ok(aaaTrade, "the delisted position must still be reported as a closed trade, not silently dropped");
  assert.equal(aaaTrade!.reason, "end-of-data");
  assert.ok(aaaTrade!.pnl < 0, "the crash before delisting must show up as a loss, not be erased");
});
