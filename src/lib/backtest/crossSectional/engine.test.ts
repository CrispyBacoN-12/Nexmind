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

// The bar index a trade entered on. Fixtures stamp bar i with t = (i + 1) * DAY.
const barIdx = (t: number) => t / DAY - 1;

test("rewriting bar P and everything after it cannot change anything decided before P (interior lookahead)", () => {
  // This is the load-bearing causality test, and the shape of the perturbation
  // is the whole point. *Appending* bars past the end of the file proves
  // nothing — a day loop structurally cannot read past its own last index, so
  // that check passes even when the code reads `[i + 1]` everywhere. The shape
  // that can really exist is an interior read: a decision dated bar i that used
  // bar i+1, which sits harmlessly inside the array on every day but the last.
  // Only rewriting bar i+1 **in place** can detect it.
  const P = 256;

  // Bar P keeps its OPEN. An entry selected at P-1 legitimately fills at that
  // open, so holding it fixed lets this test compare that fill price too,
  // instead of having to exempt it.
  const rewriteFrom = (candles: Candle[]) =>
    candles.map((c, i) =>
      i < P ? c
        : i === P ? { ...c, h: 9_000, l: 10, c: 5_000, v: 1 }
          : { ...c, o: 5_000, h: 9_000, l: 10, c: 5_000, v: 1 },
    );

  const dipAt = (bar: number) => {
    const c = risingBase(280);
    c[bar] -= 8;
    return c;
  };
  // Dips at three separate times: one pair of trades opens and closes long
  // before P, and one entry is selected at P-1 and fills at P.
  const spyCloses = risingBase(280);
  const universe = (rewrite: boolean) => {
    const build = (closes: number[]) => (rewrite ? rewriteFrom(series(closes)) : series(closes));
    return new Map<string, Candle[]>([
      ["AAA", build(dipAt(210))],
      ["BBB", build(dipAt(230))],
      ["CCC", build(dipAt(P - 1))],
      ["SPY", build(spyCloses)],
    ]);
  };

  // Run the invariant under a permissive config and under one with every
  // optional filter engaged, so a lookahead hiding in any single filter has
  // something to break.
  const strict: CsConfig = {
    ...cfg, slots: 2, requireAboveSma200: true, regime: "spySma200",
    maxSingleDayMovePct: 15, stopAtrMult: 3, costs: { slippageBps: 0.5, commissionBps: 1 },
  };

  for (const [label, c] of [["permissive", cfg], ["all filters on", strict]] as [string, CsConfig][]) {
    const base = crossSectionalBacktest(universe(false), c);
    const moved = crossSectionalBacktest(universe(true), c);

    // Every entry filled at or before P was selected from bars <= P-1 and
    // filled at an open the rewrite left alone, so all of it must be identical.
    const entries = (r: typeof base) =>
      r.trades.filter((t) => barIdx(t.entryT) <= P)
        .map((t) => ({ symbol: t.symbol, entryT: t.entryT, entry: t.entry, shares: t.shares }));
    assert.ok(entries(base).length >= 3, `${label}: fixture must produce entries before P`);
    assert.deepEqual(entries(moved), entries(base), `${label}: an entry decided before bar ${P} moved`);

    // Trades that also *exited* before P are fully determined by bars < P.
    const closed = (r: typeof base) => r.trades.filter((t) => barIdx(t.exitT) < P);
    assert.ok(closed(base).length >= 2, `${label}: fixture must close trades before P`);
    assert.deepEqual(closed(moved), closed(base), `${label}: a trade closed before bar ${P} moved`);

    // Equity dated day d marks to market at day d's close and can depend on
    // nothing later.
    assert.deepEqual(
      moved.equityCurve.slice(0, P),
      base.equityCurve.slice(0, P),
      `${label}: the equity curve before bar ${P} moved`,
    );

    // Vacuity guard: the rewrite is large enough to move results that legitimately
    // may move, so a green run above means causality, not an inert perturbation.
    assert.notDeepEqual(moved.equityCurve.slice(P), base.equityCurve.slice(P), `${label}: perturbation was inert`);
  }
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
  // slots must be high enough that equity/slots stays BELOW available cash. With
  // slots: 2 the cash cap pins the allocation at `cash` in both runs, so the buggy
  // and correct sizings agree and the test passes for the wrong reason (verified by
  // mutation: reverting the fix left this test green at slots: 2). At slots: 5 with
  // one position held, cash is ~8000 while equity/5 is ~2000, so the equity term is
  // what actually decides the size — and a lookahead in it changes the share count.
  const holdCfg: CsConfig = { ...cfg, slots: 5, holdDays: 200 };

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

test("a tie in rank score is broken by symbol name, not by insertion order", () => {
  const closes = risingBase(260);
  closes[254] -= 8;
  const identical = series(closes);
  // Identical price paths score identically. Inserted reverse-alphabetically, so
  // an insertion-ordered or reversed tiebreak would pick ZZZ.
  const bars = new Map<string, Candle[]>([["ZZZ", identical], ["AAA", identical]]);

  const res = crossSectionalBacktest(bars, cfg);
  assert.ok(res.trades.length > 0);
  assert.equal(res.trades[0].symbol, "AAA");
});

test("running the same input twice produces byte-identical trades (determinism)", () => {
  const closes = risingBase(260);
  closes[254] -= 8;
  const bars = new Map<string, Candle[]>([["AAA", series(closes)]]);

  const r1 = crossSectionalBacktest(bars, cfg);
  const r2 = crossSectionalBacktest(bars, cfg);
  assert.deepEqual(r1.trades, r2.trades);
});

// --- Fills, costs, regime and slot accounting ---

/**
 * Like `series`, but each bar's open sits `gap` below its close. `series` sets
 * `o === c`, which makes "fill at the open" and "fill at the close" produce the
 * same number — so a fill-at-the-close bug ships green against it.
 */
function gappedSeries(closes: number[], gap = 1.5, volume = 5_000_000): Candle[] {
  return closes.map((c, i) => {
    const o = c - gap;
    return { t: (i + 1) * DAY, o, h: Math.max(o, c) * 1.01, l: Math.min(o, c) * 0.99, c, v: volume };
  });
}

test("entries fill at the entry bar's open and scheduled exits at the exit bar's open — never at a close", () => {
  const closes = risingBase(260);
  closes[254] -= 8;
  const candles = gappedSeries(closes);
  const res = crossSectionalBacktest(new Map([["AAA", candles]]), cfg);

  assert.equal(res.trades.length, 1);
  const t = res.trades[0];
  const entryBar = candles[barIdx(t.entryT)];
  const exitBar = candles[barIdx(t.exitT)];

  // The fixture only discriminates if open and close actually differ.
  assert.notEqual(entryBar.o, entryBar.c);
  assert.notEqual(exitBar.o, exitBar.c);
  assert.equal(t.entry, entryBar.o);
  assert.equal(t.exit, exitBar.o);
  assert.equal(t.reason, "hold-expiry");
});

test("slippage is charged on the exit leg as well as the entry", () => {
  const closes = risingBase(260);
  closes[254] -= 8;
  const candles = gappedSeries(closes);
  const slippageBps = 25;
  const res = crossSectionalBacktest(new Map([["AAA", candles]]), { ...cfg, costs: { slippageBps } });

  const t = res.trades[0];
  const s = slippageBps / 10_000;
  assert.ok(Math.abs(t.entry - candles[barIdx(t.entryT)].o * (1 + s)) < 1e-9, `entry ${t.entry} not slipped up`);
  assert.ok(Math.abs(t.exit - candles[barIdx(t.exitT)].o * (1 - s)) < 1e-9, `exit ${t.exit} not slipped down`);
});

test("regime spySlope tracks the slope of SPY's SMA200, not SPY's position relative to it", () => {
  const closes = risingBase(260);
  closes[254] -= 8;

  // SPY rises for 245 bars, then sits at 140. At bar 254 its close is far below
  // its own SMA200 (~173), so spySma200 blocks — but every new bar still
  // replaces a much older, lower one, so the 200-bar average is still rising
  // and spySlope allows. That divergence is what separates the two regimes.
  const spyCloses = Array.from({ length: 260 }, (_, i) => (i < 245 ? 100 + i * 0.5 : 140));
  const bars = new Map<string, Candle[]>([["AAA", series(closes)], ["SPY", series(spyCloses)]]);

  assert.equal(crossSectionalBacktest(bars, { ...cfg, regime: "spySma200" }).trades.length, 0);
  assert.ok(crossSectionalBacktest(bars, { ...cfg, regime: "spySlope" }).trades.length > 0);
});

test("regime spySlope blocks new entries while SPY's SMA200 is falling", () => {
  const closes = risingBase(260);
  closes[254] -= 8;
  const spyCloses = Array.from({ length: 260 }, (_, i) => 300 - i * 0.5); // every bar drags the average down
  const bars = new Map<string, Candle[]>([["AAA", series(closes)], ["SPY", series(spyCloses)]]);

  assert.equal(crossSectionalBacktest(bars, { ...cfg, regime: "spySlope" }).trades.length, 0);
  assert.ok(crossSectionalBacktest(bars, { ...cfg, regime: "off" }).trades.length > 0);
});

test("a slot whose exit is only queued still counts as occupied — no same-bar backfill", () => {
  // TWO declining symbols, not one. The ranker skips any symbol it already
  // holds, so a single-symbol fixture never offers a replacement and the
  // accounting under test is never exercised — the free-slot bug survives it.
  // With AAA held and BBB standing by, a slot that stops counting a queued
  // position would let BBB fill on the very bar AAA's exit fills.
  const decline = (from: number, step: number) => {
    const c = risingBase(260);
    for (let i = from; i < 260; i++) c[i] = c[from - 1] - (i - from + 1) * step;
    return c;
  };
  const bars = new Map<string, Candle[]>([
    ["AAA", series(decline(220, 2))],   // falls faster, so it wins the rank
    ["BBB", series(decline(220, 1.5))], // the standby candidate
  ]);
  const res = crossSectionalBacktest(bars, cfg); // slots: 1

  assert.ok(res.trades.length >= 2, `expected repeated round trips, got ${res.trades.length}`);
  for (let i = 1; i < res.trades.length; i++) {
    assert.ok(
      res.trades[i].entryT > res.trades[i - 1].exitT,
      `trade ${i} entered at ${res.trades[i].entryT}, but the previous exit only filled at ${res.trades[i - 1].exitT}`,
    );
  }
  assert.ok(res.equityCurve.every((p) => p.positions <= cfg.slots));
});

test("the stop triggers off the bar's low, and only once the low actually reaches it", () => {
  const closes = risingBase(260);
  closes[254] -= 8;
  const candles = series(closes);
  const s = buildSeries(candles);
  const entryIdx = 255;
  const stop = candles[entryIdx].o - 2 * s.atr[entryIdx - 1]!;
  const withBar = (bar: Partial<Candle>) =>
    crossSectionalBacktest(
      new Map([["AAA", candles.map((c, i) => (i === 256 ? { ...c, ...bar } : c))]]),
      { ...cfg, stopAtrMult: 2 },
    );
  const stopped = (r: ReturnType<typeof withBar>) => r.trades.some((t) => t.reason === "stop");

  // A low that stays a hair above the stop must not fire it.
  assert.equal(stopped(withBar({ o: stop + 5, h: stop + 6, l: stop + 0.01, c: stop + 2 })), false);
  // A low that touches it exactly must — the comparison is <=, not <.
  assert.equal(stopped(withBar({ o: stop + 5, h: stop + 6, l: stop, c: stop + 2 })), true);
  // A low that pierces while the close recovers above the stop must still fire.
  // This is what pins the trigger to the low: a close-based check would miss it.
  assert.equal(stopped(withBar({ o: stop + 5, h: stop + 6, l: stop - 1, c: stop + 2 })), true);
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

test("isMember excludes a non-member symbol from candidate selection", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8; // same dip as the causality test above; signal fires on day 255
  const bars = new Map<string, Candle[]>([["AAA", series(closes)]]);

  // AAA is not a member on the signal day (255) — only from day 256 on, one
  // day too late to ever be seen as a candidate for this particular dip.
  const isMember = (symbol: string, d: number) => symbol === "AAA" && d >= 256;
  const res = crossSectionalBacktest(bars, cfg, isMember);
  assert.equal(res.trades.length, 0);
});

test("isMember admits a member symbol exactly as the unguarded engine would", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;
  const bars = new Map<string, Candle[]>([["AAA", series(closes)]]);

  const isMember = () => true;
  const res = crossSectionalBacktest(bars, cfg, isMember);
  assert.equal(res.trades.length, 1);
  assert.equal(res.trades[0].entryT, 256 * DAY);
});

test("omitting isMember reproduces today's behaviour bit-for-bit", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;
  const bars = new Map<string, Candle[]>([["AAA", series(closes)]]);

  const withUndefined = crossSectionalBacktest(bars, cfg, undefined);
  const withoutParam = crossSectionalBacktest(bars, cfg);
  assert.deepEqual(withUndefined, withoutParam);
});
