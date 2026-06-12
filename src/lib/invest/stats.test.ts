import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLongTermStats } from "./stats";
import type { Candle } from "@/lib/indicators";

const WEEK_S = 7 * 24 * 3600;

/** Build weekly candles from a list of closes (high=close*1.01, low=close*0.99). */
function weekly(closes: number[]): Candle[] {
  const t0 = 1_600_000_000;
  return closes.map((c, i) => ({ t: t0 + i * WEEK_S, o: c, h: c * 1.01, l: c * 0.99, c, v: 1000 }));
}

test("doubles over ~2 years → CAGR ≈ 41%", () => {
  // 105 weekly closes climbing 100 → 200 (~2 years)
  const closes = Array.from({ length: 105 }, (_, i) => 100 + (100 * i) / 104);
  const s = computeLongTermStats(weekly(closes));
  assert.equal(s.price, 200);
  assert.ok(s.cagrPct! > 38 && s.cagrPct! < 44, `cagr ${s.cagrPct}`);
  assert.ok(s.change52wPct! > 0);
});

test("price at the all-time high → drawdown ≈ -1% (high = close*1.01)", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
  const s = computeLongTermStats(weekly(closes));
  assert.ok(s.drawdownFromHighPct > -2 && s.drawdownFromHighPct <= 0, `dd ${s.drawdownFromHighPct}`);
  assert.ok(s.rangePos52wPct! > 95, `rangePos ${s.rangePos52wPct}`);
});

test("30% crash from the high is reported as drawdown", () => {
  const closes = [...Array.from({ length: 60 }, () => 100), ...Array.from({ length: 10 }, () => 70)];
  const s = computeLongTermStats(weekly(closes));
  assert.ok(s.drawdownFromHighPct < -28 && s.drawdownFromHighPct > -32, `dd ${s.drawdownFromHighPct}`);
});

test("uptrend keeps price above the 40-week MA", () => {
  const closes = Array.from({ length: 80 }, (_, i) => 100 + i * 2);
  const s = computeLongTermStats(weekly(closes));
  assert.ok(s.sma40w != null && s.price > s.sma40w);
  assert.ok(s.priceVsSma40wPct! > 0);
});

test("short series degrades gracefully (nulls, no throw)", () => {
  const s = computeLongTermStats(weekly([100, 101, 102]));
  assert.equal(s.cagrPct, null);
  assert.equal(s.change52wPct, null);
  assert.equal(s.sma40w, null);
  assert.equal(s.price, 102);
});
