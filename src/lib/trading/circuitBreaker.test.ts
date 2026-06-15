import { test } from "node:test";
import assert from "node:assert/strict";
import { currentDrawdownPct } from "./circuitBreaker";
import type { ClosedTrade } from "./stats";

function trade(pnl: number, day: string): ClosedTrade {
  return { pnl, rMultiple: null, outcome: null, closedAt: new Date(day) };
}

test("currentDrawdownPct: empty input returns 0", () => {
  assert.equal(currentDrawdownPct([], 10000), 0);
});

test("currentDrawdownPct: peak <= 0 returns 0 (division-by-zero guard)", () => {
  assert.equal(currentDrawdownPct([], -100), 0);
  assert.equal(currentDrawdownPct([], 0), 0);
});

test("currentDrawdownPct: equity strictly increasing returns 0", () => {
  const closed = [trade(10, "2026-06-01"), trade(20, "2026-06-02"), trade(30, "2026-06-03")];
  assert.equal(currentDrawdownPct(closed, 1000), 0);
});

test("currentDrawdownPct: simple drawdown from a single peak", () => {
  // 1000 -> +100 -> 1100 (peak) -> -50 -> 1050. dd = (1100-1050)/1100*100
  const closed = [trade(100, "2026-06-01"), trade(-50, "2026-06-02")];
  const expected = (50 / 1100) * 100;
  assert.ok(Math.abs(currentDrawdownPct(closed, 1000) - expected) < 1e-9);
});

test("currentDrawdownPct: recovery after a drawdown does not reset the peak", () => {
  // 1000 -> +200 -> 1200 (peak) -> -150 -> 1050 -> +50 -> 1100. dd = (1200-1100)/1200*100
  const closed = [trade(200, "2026-06-01"), trade(-150, "2026-06-02"), trade(50, "2026-06-03")];
  const expected = (100 / 1200) * 100;
  assert.ok(Math.abs(currentDrawdownPct(closed, 1000) - expected) < 1e-9);
});

test("currentDrawdownPct: multiple peaks/troughs reflects current gap, not the largest historical drawdown", () => {
  // 1000 -> +100 -> 1100 (peak) -> -80 -> 1020 (dd here would be ~7.27%, but not returned)
  //      -> +200 -> 1220 (new peak) -> -30 -> 1190. dd = (1220-1190)/1220*100 (~2.46%)
  const closed = [trade(100, "2026-06-01"), trade(-80, "2026-06-02"), trade(200, "2026-06-03"), trade(-30, "2026-06-04")];
  const expected = (30 / 1220) * 100;
  const result = currentDrawdownPct(closed, 1000);
  assert.ok(Math.abs(result - expected) < 1e-9);
  assert.ok(result < (80 / 1100) * 100, "current gap should be smaller than the earlier, larger drawdown");
});

test("currentDrawdownPct: trades with identical closedAt are processed in stable input order", () => {
  // Both have the same timestamp, so the sort comparator returns 0 and the
  // original array order is preserved (Array.prototype.sort is stable).
  // Order here: -50 first (1000 -> 950, peak stays 1000), then +100 (950 -> 1050, peak -> 1050).
  // dd = (1050-1050)/1050*100 = 0
  const closed = [trade(-50, "2026-06-01"), trade(100, "2026-06-01")];
  assert.equal(currentDrawdownPct(closed, 1000), 0);
});

test("currentDrawdownPct: does not mutate the input array", () => {
  const closed = [trade(-50, "2026-06-02"), trade(100, "2026-06-01")];
  const before = closed.map((t) => ({ ...t }));
  currentDrawdownPct(closed, 1000);
  assert.deepEqual(closed, before);
});
