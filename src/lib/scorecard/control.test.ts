import "dotenv/config"; // control.ts reaches prisma via research/control.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { etClock } from "@/lib/scanAgent/session";
import { controlDistribution, type ControlTrade } from "./control";
import { scoreSetup } from "./score";

function etEpoch(date: string, hhmm: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const wanted = h * 60 + mi;
  for (const offset of [4, 5]) {
    const ms = Date.UTC(y, mo - 1, d, h + offset, mi);
    const c = etClock(ms / 1000);
    if (c.date === date && c.minutes === wanted) return ms / 1000;
  }
  throw new Error(`cannot resolve ${date} ${hhmm} ET`);
}

const DAY = "2026-11-02";
const AFTER = etEpoch("2026-11-03", "08:00");

// Flat 5-minute bars from 09:30 through 15:55 ET that never touch stop 99 or T1 102.
function flatDay(): Candle[] {
  const bars: Candle[] = [];
  for (let m = 570; m < 960; m += 5) {
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    bars.push({ t: etEpoch(DAY, `${hh}:${mm}`), o: 100, h: 100.2, l: 99.8, c: 100, v: 1000 });
  }
  return bars;
}

const trade = (runAtSec: number, bars: Candle[]): ControlTrade => ({
  runAtSec, fill: 100, stop: 99, t1: 102, bars, cutoffSec: AFTER,
});

test("controlDistribution is deterministic for a seed", () => {
  const bars = flatDay();
  const trades = [trade(etEpoch(DAY, "10:30"), bars), trade(etEpoch(DAY, "11:00"), bars)];
  const a = controlDistribution(trades, "sameDay", 50, 7);
  const b = controlDistribution(trades, "sameDay", 50, 7);
  assert.ok(a);
  assert.deepEqual(a, b);
});

test("controlDistribution uses the same stop distance and R as the setup", () => {
  const bars = flatDay();
  const trades = [trade(etEpoch(DAY, "10:30"), bars), trade(etEpoch(DAY, "11:00"), bars)];
  const d = controlDistribution(trades, "sameDay", 40, 1);
  assert.ok(d);
  const flat = scoreSetup({
    runAtSec: etEpoch(DAY, "10:30"), stop: 99, t1: 102, bars, cutoffSec: AFTER, variant: "sameDay",
  });
  assert.equal(flat.status, "closed");
  assert.equal(flat.exitReason, "time");
  // (100*0.9995 - 100.05 - 0.010005) / 1.05
  const expected = (100 * 0.9995 - 100.05 - 0.010005) / 1.05;
  assert.ok(Math.abs(flat.r! - expected) < 1e-9);
  assert.ok(Math.abs(d.median - expected) < 1e-9, `${d.median} vs ${expected}`);
  assert.ok(Math.abs(d.p95 - expected) < 1e-9);
});

test("controlDistribution skips trades with no eligible bar", () => {
  const bars = flatDay();
  // 15:31 ET: no bar at/after it before 15:30.
  assert.equal(controlDistribution([trade(etEpoch(DAY, "15:31"), bars)], "sameDay", 20, 1), null);
});

test("controlDistribution returns null for no trades", () => {
  assert.equal(controlDistribution([], "hold", 20, 1), null);
});
