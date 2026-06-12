import { test } from "node:test";
import assert from "node:assert/strict";
import { backtestCandles, openPosition, stepPosition } from "./engine";
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

test("decideSetup: weak trend (ADX 22) is rejected", () => {
  assert.equal(decideSetup({ ...goodLongSnap, adx: 22 }).side, null);
});

test("decideSetup: RSI outside the 40-60 pullback band is rejected", () => {
  assert.equal(decideSetup({ ...goodLongSnap, rsi: 68 }).side, null);
  assert.equal(decideSetup({ ...goodLongSnap, rsi: 35 }).side, null);
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
