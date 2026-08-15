import "dotenv/config"; // engine.ts -> trading/scanner.ts -> research/adapter.ts imports prisma at module scope — needs DATABASE_URL to construct, same as other DB-touching scripts
import { test } from "node:test";
import assert from "node:assert/strict";
import { backtestCandles, openPosition, stepPosition, summarizeBacktest, type SimTrade } from "./engine";
import { decideSetup, type ScanSnapshot } from "@/lib/trading/scanner";
import type { Candle } from "@/lib/indicators";

const HOUR_S = 3600;
const t0 = 1_700_000_000;

function bar(i: number, h: number, l: number): Candle {
  const c = (h + l) / 2;
  return { t: t0 + i * HOUR_S, o: c, h, l, c, v: 1000 };
}

// ---- decideSetup (shared with the live scanner) ----

const goodLongSnap: ScanSnapshot = {
  price: 100, sma20: 98, sma50: 95, rsi: 52, adx: 30, plusDI: 25, minusDI: 12, macdHist: 0.05, atr: 1.5,
};

test("decideSetup: trend + pullback + MACD turning up → long", () => {
  assert.equal(decideSetup(goodLongSnap).side, "long");
});

test("decideSetup: mirror image → short", () => {
  const s: ScanSnapshot = { ...goodLongSnap, sma20: 92, sma50: 95, plusDI: 12, minusDI: 25 };
  assert.equal(decideSetup(s).side, "short");
});

test("decideSetup: weak trend (ADX 18) is rejected", () => {
  assert.equal(decideSetup({ ...goodLongSnap, adx: 18 }).side, null);
  // ADX 22 now passes the relaxed 20 floor.
  assert.equal(decideSetup({ ...goodLongSnap, adx: 22 }).side, "long");
});

test("decideSetup: RSI outside the 35-70 pullback band is rejected", () => {
  assert.equal(decideSetup({ ...goodLongSnap, rsi: 75 }).side, null);
  assert.equal(decideSetup({ ...goodLongSnap, rsi: 30 }).side, null);
  // Inside the widened band now passes.
  assert.equal(decideSetup({ ...goodLongSnap, rsi: 68 }).side, "long");
});

test("decideSetup: deeply negative MACD blocks the long", () => {
  assert.equal(decideSetup({ ...goodLongSnap, macdHist: -1.2 }).side, null);
});

// ---- stepPosition ladder mechanics ----
// Long opened at 100 with ATR 2 → SL 97, TP1 105, TP2 108 (1.5x / 2.5x / 4x).

function freshLong() {
  return openPosition("long", 100, 2, 0.2, new Date(t0 * 1000));
}

test("openPosition computes ATR-multiple levels, side-aware", () => {
  const p = freshLong();
  assert.equal(p.sl, 97);
  assert.equal(p.tp1, 105);
  assert.equal(p.tp2, 108);
  const s = openPosition("short", 100, 2, 0.2, new Date(t0 * 1000));
  assert.equal(s.sl, 103);
  assert.equal(s.tp1, 95);
  assert.equal(s.tp2, 92);
});

test("quiet bar holds the position", () => {
  const p = freshLong();
  assert.deepEqual(stepPosition(p, bar(1, 103, 99)), { status: "open" });
  assert.equal(p.ladder.tp1Hit, undefined);
});

test("SL bar books a full loss", () => {
  const p = freshLong();
  const r = stepPosition(p, bar(1, 99, 96.5));
  assert.equal(r.status, "closed");
  if (r.status === "closed") {
    assert.equal(r.trade.outcome, "loss");
    assert.equal(r.trade.exit, 97);
    // -3 points × 0.2 lot = -0.6
    assert.ok(Math.abs(r.trade.pnl - -0.6) < 1e-9);
    assert.ok(Math.abs((r.trade.rMultiple ?? 0) - -1) < 1e-9);
  }
});

test("TP1 bar takes the partial: banks half, SL → breakeven, stays open", () => {
  const p = freshLong();
  const r = stepPosition(p, bar(1, 105.5, 101));
  assert.deepEqual(r, { status: "open" });
  assert.equal(p.ladder.tp1Hit, true);
  // +5 points × 0.1 (half lot) = 0.5 banked
  assert.ok(Math.abs((p.ladder.partialPnl ?? 0) - 0.5) < 1e-9);
  assert.equal(p.sl, 100); // breakeven
  assert.equal(p.ladder.origSl, 97);
});

test("after the partial, TP2 closes the rest as a win with blended pnl", () => {
  const p = freshLong();
  stepPosition(p, bar(1, 105.5, 101)); // partial
  const r = stepPosition(p, bar(2, 108.5, 104));
  assert.equal(r.status, "closed");
  if (r.status === "closed") {
    assert.equal(r.trade.outcome, "win");
    assert.equal(r.trade.tp1Hit, true);
    // 0.5 banked + 8 points × 0.1 = 1.3 ; risk 3 × 0.2 lot → R = 1.3/0.6
    assert.ok(Math.abs(r.trade.pnl - 1.3) < 1e-9);
    assert.ok(Math.abs((r.trade.rMultiple ?? 0) - 1.3 / 0.6) < 1e-9);
  }
});

test("after the partial, a fade to entry closes breakeven keeping the banked half", () => {
  const p = freshLong();
  stepPosition(p, bar(1, 105.5, 101)); // partial
  const r = stepPosition(p, bar(2, 104, 99.5));
  assert.equal(r.status, "closed");
  if (r.status === "closed") {
    assert.equal(r.trade.outcome, "breakeven");
    assert.ok(Math.abs(r.trade.pnl - 0.5) < 1e-9); // only the banked partial
  }
});

test("pessimistic same-bar rule: bar spanning SL AND TP1 books the loss", () => {
  const p = freshLong();
  const r = stepPosition(p, bar(1, 106, 96));
  assert.equal(r.status, "closed");
  if (r.status === "closed") assert.equal(r.trade.outcome, "loss");
});

// ---- backtestCandles end-to-end sanity ----

test("flat series produces no signals and no trades", () => {
  const series = Array.from({ length: 120 }, (_, i) => bar(i, 100.2, 99.8));
  const r = backtestCandles("TEST", series);
  assert.equal(r.signals, 0);
  assert.equal(r.trades.length, 0);
  assert.equal(r.openAtEnd, false);
});

// ---- summarizeBacktest: profitFactor / maxDrawdownPct / Sharpe / Sortino ----

function trade(pnl: number, day: number): SimTrade {
  return {
    symbol: "TEST", side: "long", entry: 100, exit: 100 + pnl, sl: 97, tp1: 105, tp2: 108,
    lot: 0.1, outcome: pnl > 0 ? "win" : pnl < 0 ? "loss" : "breakeven", tp1Hit: false,
    pnl, grossPnl: pnl, rMultiple: null,
    openedAt: new Date(t0 * 1000),
    closedAt: new Date((t0 + day * 86400) * 1000),
  };
}

test("summarizeBacktest: profitFactor from mixed wins/losses, null with no losses", () => {
  const mixed = summarizeBacktest([trade(100, 0), trade(50, 1), trade(-30, 2), trade(-20, 3)]);
  assert.ok(Math.abs((mixed.profitFactor ?? 0) - 3) < 1e-9); // grossWin 150 / grossLoss 50

  const noLosses = summarizeBacktest([trade(100, 0), trade(50, 1)]);
  assert.equal(noLosses.profitFactor, null);
});

test("summarizeBacktest: maxDrawdownPct is a positive magnitude", () => {
  // Equity path (starting balance 1000): 100, 150, 70, -10, 0 → peak 150, trough -10 → drawdown 160 → 16%.
  const s = summarizeBacktest([trade(100, 0), trade(50, 1), trade(-80, 2), trade(-80, 3), trade(10, 4)], 1000);
  assert.ok(s.maxDrawdownPct !== null && s.maxDrawdownPct > 0);
  assert.ok(Math.abs((s.maxDrawdownPct ?? 0) - 16) < 1e-9);
});

test("summarizeBacktest: Sharpe/Sortino are non-null with enough daily variance, null with too little data", () => {
  const trades = Array.from({ length: 10 }, (_, i) => trade(i % 2 === 0 ? 40 : -25, i));
  const s = summarizeBacktest(trades);
  assert.ok(s.sharpeRatio !== null);
  assert.ok(s.sortinoRatio !== null);

  const single = summarizeBacktest([trade(50, 0)]);
  assert.equal(single.sharpeRatio, null);
  assert.equal(single.sortinoRatio, null);
});

test("summarizeBacktest: empty trades returns sensible defaults without throwing", () => {
  const s = summarizeBacktest([]);
  assert.equal(s.trades, 0);
  assert.equal(s.wins, 0);
  assert.equal(s.losses, 0);
  assert.equal(s.winRate, 0);
  assert.equal(s.totalPnl, 0);
  assert.equal(s.avgR, null);
  assert.equal(s.expectancy, null);
  assert.equal(s.profitFactor, null);
  assert.equal(s.maxDrawdownPct, null);
  assert.equal(s.sharpeRatio, null);
  assert.equal(s.sortinoRatio, null);
  assert.equal(s.totalCostsUsd, 0);
});

// ---- CostModel: slippage + commission ----

test("openPosition with zero costs matches the no-costs call exactly (backward compatible)", () => {
  const withDefaults = openPosition("long", 100, 2, 0.2, new Date(t0 * 1000));
  const withExplicitZero = openPosition("long", 100, 2, 0.2, new Date(t0 * 1000), false, 2.5, {});
  assert.deepEqual(withDefaults, withExplicitZero);
});

test("openPosition applies slippageBps against the trader on entry (long fills higher, short fills lower)", () => {
  const long = openPosition("long", 100, 2, 0.2, new Date(t0 * 1000), false, 2.5, { slippageBps: 10 });
  assert.ok(Math.abs(long.entry - 100.1) < 1e-9); // +0.10% of 100

  const short = openPosition("short", 100, 2, 0.2, new Date(t0 * 1000), false, 2.5, { slippageBps: 10 });
  assert.ok(Math.abs(short.entry - 99.9) < 1e-9); // -0.10% of 100
});

test("stepPosition SL exit: slippage widens the loss, commission subtracts further, grossPnl stays theoretical", () => {
  const p = openPosition("long", 100, 2, 0.2, new Date(t0 * 1000), false, 2.5, { slippageBps: 10, commissionBps: 5 });
  const r = stepPosition(p, bar(1, 99, 96.5)); // touches SL at fillEntry - 3
  assert.equal(r.status, "closed");
  if (r.status !== "closed") return;
  // fillEntry = 100.1, sl = 97.1; exit slips further against the trader: 97.1 * (1 - 0.001) = 97.0029
  const expectedGross = (97.1 * (1 - 0.001) - 100.1) * 0.2;
  assert.ok(Math.abs(r.trade.grossPnl - expectedGross) < 1e-9);
  const notional = 0.2 * 100.1;
  const expectedCommission = notional * 0.0005;
  assert.ok(Math.abs(r.trade.pnl - (expectedGross - expectedCommission)) < 1e-9);
  assert.ok(r.trade.pnl < r.trade.grossPnl); // costs always make net pnl worse, never better
});

test("backtestCandles: same series nets less profit with a nonzero CostModel than with none", () => {
  const WARMUP = 60; // mirrors engine.ts's private WARMUP constant — first bar an entry rule can act on
  const series = Array.from({ length: 200 }, (_, i) => bar(i, 100 + i * 0.3 + 2, 100 + i * 0.3 - 2));
  const free = backtestCandles("TEST", series, 0.1, undefined, (i) => (i === WARMUP ? "long" : null));
  const costly = backtestCandles(
    "TEST", series, 0.1, undefined, (i) => (i === WARMUP ? "long" : null),
    false, 2.5, { slippageBps: 20, commissionBps: 10 },
  );
  assert.equal(free.trades.length, costly.trades.length);
  if (free.trades.length > 0) {
    assert.ok(costly.trades[0].pnl < free.trades[0].pnl);
    assert.equal(free.trades[0].pnl, free.trades[0].grossPnl); // zero-cost: net === gross
  }
});

// ---- trailing stop: openPosition / stepPosition ----

test("openPosition with slMult + trail computes ATR-scaled sl and trail distances, sets origSl", () => {
  const p = openPosition("long", 100, 2, 0.2, new Date(t0 * 1000), true, 3.5, {}, 2.0, { activateMult: 1, offsetMult: 1.75 });
  assert.equal(p.sl, 96); // 100 - 2.0*2
  assert.deepEqual(p.trail, { activateDist: 2, offsetDist: 3.5 }); // 1*2, 1.75*2
  assert.equal(p.ladder.origSl, 96);
});

function freshLongTrail() {
  // sl=96, trail activateDist=2, offsetDist=3.5
  return openPosition("long", 100, 2, 0.2, new Date(t0 * 1000), true, 3.5, {}, 2.0, { activateMult: 1, offsetMult: 1.75 });
}

test("trailing position: quiet bar below activation just tracks the extreme, stays open", () => {
  const p = freshLongTrail();
  const r = stepPosition(p, bar(1, 101, 100.5));
  assert.deepEqual(r, { status: "open" });
  assert.equal(p.sl, 96); // not armed yet
  assert.equal(p.ladder.trailExtreme, 101);
});

test("trailing position: a bar that gaps entirely above the prior extreme still ratchets off the TRUE bar high, not the low", () => {
  // Regression: the adverse (low) call alone would compute extreme=101 (only
  // from the low) and short-circuit before ever seeing the bar's real high of
  // 106, silently under-ratcheting the trail.
  const p = freshLongTrail();
  const r = stepPosition(p, bar(1, 106, 101)); // low 101 already clears the prior extreme (entry 100)
  assert.deepEqual(r, { status: "open" });
  assert.equal(p.ladder.trailExtreme, 106); // must use the bar's high, not its low
  assert.equal(p.sl, 106 - 3.5); // armed: 106 favorable move (6) >= activateDist (2)
});

test("trailing position: SL hit before ever arming books a loss", () => {
  const p = freshLongTrail();
  const r = stepPosition(p, bar(1, 99, 95));
  assert.equal(r.status, "closed");
  if (r.status === "closed") {
    assert.equal(r.trade.outcome, "loss");
    assert.equal(r.trade.exit, 96);
    assert.equal(r.trade.sl, 96); // origSl preserved for R-multiple math
  }
});

test("trailing position: arms, ratchets across bars, then closes at the trailed stop as a win", () => {
  const p = freshLongTrail();
  assert.deepEqual(stepPosition(p, bar(1, 106, 104)), { status: "open" }); // arms: extreme 106, sl -> 102.5
  assert.equal(p.sl, 102.5);
  assert.deepEqual(stepPosition(p, bar(2, 105, 103)), { status: "open" }); // no new extreme, sl unchanged
  assert.equal(p.sl, 102.5);
  const r = stepPosition(p, bar(3, 103, 102)); // drops through the trailed stop
  assert.equal(r.status, "closed");
  if (r.status === "closed") {
    assert.equal(r.trade.outcome, "win");
    assert.equal(r.trade.exit, 102.5);
    assert.equal(r.trade.sl, 96); // origSl, not the ratcheted stop — true initial risk
    assert.ok(Math.abs((r.trade.rMultiple ?? 0) - (102.5 - 100) / (100 - 96)) < 1e-9);
  }
});

test("backtestCandles threads slMult/trail through to opened positions", () => {
  const WARMUP = 60;
  const series = Array.from({ length: 200 }, (_, i) => bar(i, 100 + i * 0.3 + 2, 100 + i * 0.3 - 2));
  const r = backtestCandles(
    "TEST", series, 0.1, undefined, (i) => (i === WARMUP ? "long" : null),
    true, 3.5, {}, 2.0, { activateMult: 1, offsetMult: 1.75 },
  );
  assert.ok(r.trades.length > 0 || r.openAtEnd); // trending series should trail rather than SL out
});

test("summarizeBacktest: totalCostsUsd aggregates grossPnl - pnl drag across trades", () => {
  const trades: SimTrade[] = [
    { ...trade(100, 0), grossPnl: 112 },
    { ...trade(-30, 1), grossPnl: -25 },
  ];
  const s = summarizeBacktest(trades);
  assert.ok(Math.abs(s.totalCostsUsd - 17) < 1e-9); // (112-100) + (-25 - -30) = 12 + 5
});
