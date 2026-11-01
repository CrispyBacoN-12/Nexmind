import test from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { buildStopContext, findChartStop, STOP_READING_BARS } from "./chartStop";

const FAR = Date.parse("2030-01-01T00:00:00Z") / 1000;

// 2026-10-27..29 are EDT (UTC-4): 09:30 ET is 13:30Z.
function bar(
  date: string,
  hh: number,
  mm: number,
  low: number,
  extra: Partial<Candle> = {},
): Candle {
  const t = Date.parse(`${date}T${String(hh + 4).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`) / 1000;
  return { t, o: low + 0.2, h: low + 0.2, l: low, c: low + 0.2, v: 1000, ...extra };
}

/** Bars 5 minutes apart from 09:30 ET, one per low. */
function session(date: string, lows: number[]): Candle[] {
  return lows.map((low, i) => {
    const mins = 9 * 60 + 30 + i * 5;
    return bar(date, Math.floor(mins / 60), mins % 60, low);
  });
}

const PREV_DAY = session("2026-10-27", [9.5, 9.3, 9.0, 9.2, 9.4, 9.6]); // low 9.0
const SWING_LOWS = [10.0, 9.9, 9.5, 9.8, 9.9, 9.7, 9.6, 9.8, 9.9, 10.0];
const SWING_DAY = session("2026-10-28", SWING_LOWS);
const SWING_REASON = "ไม่มี swing low ใต้ราคาเข้าในกราฟ 5 นาทีวันที่ 2026-10-28";

test("picks the most recent pivot low below the entry", () => {
  // ATR 0.3: the older 9.5 low is 0.1 under the 9.6 pivot, beyond 0.25 x 0.3 = 0.075.
  const r = findChartStop({
    candles: [...PREV_DAY, ...SWING_DAY],
    entry: 10.2,
    atr: 0.3,
    cutoffSec: FAR,
  });
  assert.equal(r.kind, "found");
  if (r.kind !== "found") return;
  assert.equal(r.source, "swing");
  assert.ok(Math.abs(r.stop - 9.57) < 1e-9); // 9.6 - 0.03
  assert.equal(r.structure.level, 9.6);
  assert.equal(r.structure.sessionDate, "2026-10-28");
  assert.equal(r.structure.barT, SWING_DAY[6].t);
  assert.deepEqual(r.skipped, []);
  assert.equal(r.adjusted, null);
});

test("a lower low within 0.25 ATR under the swing low takes the stop under it", () => {
  // ATR 1: the 9.5 low (10:10 ET) is 0.1 under the 9.6 pivot, inside 0.25.
  const r = findChartStop({ candles: [...PREV_DAY, ...SWING_DAY], entry: 10.2, atr: 1, cutoffSec: FAR });
  assert.equal(r.kind, "found");
  if (r.kind !== "found") return;
  assert.equal(r.source, "swing");
  assert.equal(r.structure.level, 9.5);
  assert.equal(r.structure.barT, SWING_DAY[2].t);
  assert.ok(Math.abs(r.stop - 9.4) < 1e-9);
  assert.equal(r.adjusted, "ย้าย stop ลงใต้ low 9.50 (09:40 ET) ที่อยู่ใต้ swing low 9.60 ไม่เกิน 0.25×ATR");
});

test("the cluster move is one pass anchored on the swing low, not a staircase", () => {
  // 9.4 is within 0.25 of the 9.6 pivot; 9.2 is within 0.25 of 9.4 but not of 9.6.
  const day = session("2026-10-28", [10, 9.2, 10, 10, 9.4, 10, 10, 9.6, 10, 10]);
  const r = findChartStop({ candles: [...PREV_DAY, ...day], entry: 10.5, atr: 1, cutoffSec: FAR });
  assert.equal(r.kind, "found");
  if (r.kind !== "found") return;
  assert.equal(r.structure.level, 9.4);
  assert.ok(Math.abs(r.stop - 9.3) < 1e-9);
});

test("skips a pivot whose low is not below the entry and takes the older one", () => {
  const r = findChartStop({
    candles: [...PREV_DAY, ...SWING_DAY],
    entry: 9.55,
    atr: 1,
    cutoffSec: FAR,
  });
  assert.equal(r.kind, "found");
  if (r.kind !== "found") return;
  assert.equal(r.source, "swing");
  assert.equal(r.structure.level, 9.5);
  assert.ok(Math.abs(r.stop - 9.4) < 1e-9);
});

test("the last two bars are never pivots", () => {
  // 9.0 sits one bar from the end, so it is unconfirmed; the 9.9s tie, so they are not pivots.
  const prev = session("2026-10-27", [8.5, 8.0, 8.4, 8.6]); // PDL 8.0
  const day = session("2026-10-28", [10.0, 10.1, 9.9, 9.9, 9.0, 9.5]);
  const r = findChartStop({ candles: [...prev, ...day], entry: 10.5, atr: 1, cutoffSec: FAR });
  assert.equal(r.kind, "found");
  if (r.kind !== "found") return;
  assert.equal(r.source, "pdl");
  assert.equal(r.structure.level, 8.0);
});

test("equal neighbouring lows are not a pivot", () => {
  const day = session("2026-10-28", [10, 9.9, 9.5, 9.5, 9.9, 10]);
  const r = findChartStop({
    candles: [...PREV_DAY, ...day],
    entry: 10.2,
    atr: 1,
    cutoffSec: FAR,
  });
  assert.equal(r.kind, "found");
  if (r.kind !== "found") return;
  assert.equal(r.source, "pdl");
  assert.deepEqual(r.skipped, [SWING_REASON]);
});

test("a bar ending after the cutoff is not read", () => {
  const day = session("2026-10-28", [10.0, 9.9, 9.5, 9.8, 9.9]); // pivot at index 2
  const candles = [...PREV_DAY, ...day];
  const all = findChartStop({ candles, entry: 10.2, atr: 1, cutoffSec: FAR });
  assert.equal(all.kind === "found" && all.source, "swing");

  // Bar index 4 (the 2nd confirming bar) ends after the cutoff: it is not finished.
  const cutoffSec = day[4].t + 300 - 1;
  const r = findChartStop({ candles, entry: 10.2, atr: 1, cutoffSec });
  assert.equal(r.kind, "found");
  if (r.kind !== "found") return;
  assert.equal(r.source, "pdl");
  assert.deepEqual(r.skipped, [SWING_REASON]);

  // A bar ending exactly at the cutoff is finished.
  const exact = findChartStop({ candles, entry: 10.2, atr: 1, cutoffSec: day[4].t + 300 });
  assert.equal(exact.kind === "found" && exact.source, "swing");
});

test("no swing low falls back to PDL with the reason", () => {
  const falling = session("2026-10-28", [10.0, 9.9, 9.8, 9.7, 9.6, 9.5, 9.4, 9.3]);
  const r = findChartStop({
    candles: [...PREV_DAY, ...falling],
    entry: 9.2,
    atr: 1,
    cutoffSec: FAR,
  });
  assert.equal(r.kind, "found");
  if (r.kind !== "found") return;
  assert.equal(r.source, "pdl");
  assert.ok(Math.abs(r.stop - 8.9) < 1e-9); // 9.0 - 0.1
  assert.equal(r.structure.level, 9.0);
  assert.equal(r.structure.sessionDate, "2026-10-27");
  assert.equal(r.structure.barT, PREV_DAY[2].t);
  assert.deepEqual(r.skipped, [SWING_REASON]);
});

test("PDL above the entry gives none with both reasons", () => {
  const falling = session("2026-10-28", [10.0, 9.9, 9.8, 9.7, 9.6, 9.5, 9.4, 9.3]);
  const r = findChartStop({
    candles: [...PREV_DAY, ...falling],
    entry: 8.95,
    atr: 1,
    cutoffSec: FAR,
  });
  assert.equal(r.kind, "none");
  if (r.kind !== "none") return;
  assert.deepEqual(r.reasons, [
    SWING_REASON,
    "PDL 9.00 อยู่ไม่ต่ำกว่าราคาเข้า (มักเกิดจากเปิด gap ลง)",
  ]);
});

test("a PDL equal to the entry is not below it and keeps the gap copy", () => {
  const falling = session("2026-10-28", [10.0, 9.9, 9.8, 9.7, 9.6, 9.5, 9.4, 9.3]);
  const r = findChartStop({ candles: [...PREV_DAY, ...falling], entry: 9.0, atr: 1, cutoffSec: FAR });
  assert.equal(r.kind, "none");
  if (r.kind !== "none") return;
  assert.equal(r.reasons[1], "PDL 9.00 อยู่ไม่ต่ำกว่าราคาเข้า (มักเกิดจากเปิด gap ลง)");
});

test("a PDL stop that would not be positive is refused", () => {
  const prev = session("2026-10-27", [0.2, 0.3, 0.25, 0.3]);
  const falling = session("2026-10-28", [0.6, 0.5, 0.45, 0.4]);
  const r = findChartStop({
    candles: [...prev, ...falling],
    entry: 0.9,
    atr: 1, // buffer 0.1: 0.2 - 0.1 = 0.1 > 0, taken
    cutoffSec: FAR,
  });
  assert.equal(r.kind === "found" && r.source, "pdl");
  const big = findChartStop({
    candles: [...prev, ...falling],
    entry: 0.9,
    atr: 3, // buffer 0.3: 0.2 - 0.3 < 0, refused
    cutoffSec: FAR,
  });
  assert.equal(big.kind, "none");
  if (big.kind !== "none") return;
  assert.equal(big.reasons.length, 2);
  assert.equal(big.reasons[1], "PDL 0.20 ลบระยะเผื่อแล้วไม่เป็นบวก");
});

test("a pivot broken by a later non-pivot low is not the stop", () => {
  // 9.5 is the only pivot, but bar 7 printed 9.3 (one of the last bars, never a pivot itself).
  const day = session("2026-10-28", [10.0, 9.9, 9.5, 9.8, 9.9, 9.7, 9.8, 9.3, 9.8]);
  const r = findChartStop({ candles: [...PREV_DAY, ...day], entry: 10.0, atr: 1, cutoffSec: FAR });
  assert.equal(r.kind, "found");
  if (r.kind !== "found") return;
  assert.equal(r.source, "pdl");
  assert.equal(r.structure.level, 9.0);
  assert.deepEqual(r.skipped, ["swing low ล่าสุดถูกแท่งหลังทะลุแล้ว (วันที่ 2026-10-28)"]);

  // Without a previous session there is nothing to fall back to: both reasons stay.
  const alone = findChartStop({ candles: day, entry: 10.0, atr: 1, cutoffSec: FAR });
  assert.equal(alone.kind, "none");
  if (alone.kind !== "none") return;
  assert.equal(alone.reasons[0], "swing low ล่าสุดถูกแท่งหลังทะลุแล้ว (วันที่ 2026-10-28)");
});

test("a later bar tied with the pivot low also breaks it", () => {
  const day = session("2026-10-28", [10.0, 9.9, 9.5, 9.8, 9.9, 9.7, 9.8, 9.5, 9.8]);
  const r = findChartStop({ candles: [...PREV_DAY, ...day], entry: 10.0, atr: 1, cutoffSec: FAR });
  assert.equal(r.kind === "found" && r.source, "pdl");
});

test("a broken newer pivot is skipped and an older, lower, unbroken one is taken", () => {
  // 9.6 (index 6) is broken by the 9.5 that follows; 9.0 (index 2) is lower and untouched.
  const day = session("2026-10-28", [10.0, 9.4, 9.0, 9.4, 10.0, 9.9, 9.6, 9.8, 9.9, 9.5, 9.7]);
  const r = findChartStop({ candles: [...PREV_DAY, ...day], entry: 10.2, atr: 1, cutoffSec: FAR });
  assert.equal(r.kind, "found");
  if (r.kind !== "found") return;
  assert.equal(r.source, "swing");
  assert.equal(r.structure.level, 9.0);
  assert.equal(r.structure.barT, day[2].t);
  assert.ok(Math.abs(r.stop - 8.9) < 1e-9);
  assert.deepEqual(r.skipped, []);
});

test("pre-market bars do not make a reading session", () => {
  const pre = [bar("2026-10-29", 8, 0, 9.0), bar("2026-10-29", 8, 5, 9.1), bar("2026-10-29", 8, 10, 9.2)];
  const r = findChartStop({
    candles: [...PREV_DAY, ...SWING_DAY, ...pre],
    entry: 10.2,
    atr: 1,
    cutoffSec: FAR,
  });
  assert.equal(r.kind, "found");
  if (r.kind !== "found") return;
  assert.equal(r.structure.sessionDate, "2026-10-28");

  // With no swing, the PDL session is 10-27, not 10-28.
  const falling = session("2026-10-28", [10.0, 9.9, 9.8, 9.7, 9.6, 9.5]);
  const p = findChartStop({
    candles: [...PREV_DAY, ...falling, ...pre],
    entry: 9.2,
    atr: 1,
    cutoffSec: FAR,
  });
  assert.equal(p.kind === "found" && p.structure.sessionDate, "2026-10-27");
});

test("no previous session: swing still works, PDL reason when swing fails", () => {
  const swing = findChartStop({ candles: SWING_DAY, entry: 10.2, atr: 1, cutoffSec: FAR });
  assert.equal(swing.kind === "found" && swing.source, "swing");

  const falling = session("2026-10-28", [10.0, 9.9, 9.8, 9.7, 9.6, 9.5]);
  const r = findChartStop({ candles: falling, entry: 9.4, atr: 1, cutoffSec: FAR });
  assert.equal(r.kind, "none");
  if (r.kind !== "none") return;
  assert.deepEqual(r.reasons, [SWING_REASON, "ไม่มีวันทำการก่อนหน้าในกราฟ 5 นาที จึงไม่มี PDL"]);
});

test("no candles gives none with the no-bars reason", () => {
  const r = findChartStop({ candles: [], entry: 10, atr: 1, cutoffSec: FAR });
  assert.deepEqual(r, { kind: "none", reasons: ["ไม่มีแท่ง 5 นาทีที่ปิดแล้ว"] });
  // Bars that all end after the cutoff count as no finished bars too.
  const late = findChartStop({ candles: SWING_DAY, entry: 10, atr: 1, cutoffSec: 0 });
  assert.deepEqual(late, { kind: "none", reasons: ["ไม่มีแท่ง 5 นาทีที่ปิดแล้ว"] });
});

test("buildStopContext returns the last 48 regular bars, the date and levels", () => {
  // 78 prev bars, 60 bars today; prices vary so the profile is not flat.
  const prev = session("2026-10-27", Array.from({ length: 78 }, (_, i) => 9 + (i % 7) * 0.1));
  const today = session("2026-10-28", Array.from({ length: 60 }, (_, i) => 9.5 + (i % 5) * 0.1));
  const ctx = buildStopContext([...prev, ...today], FAR);
  assert.ok(ctx);
  assert.equal(STOP_READING_BARS, 48);
  assert.equal(ctx.sessionDate, "2026-10-28");
  assert.equal(ctx.recent.length, 48);
  assert.deepEqual(ctx.recent, today.slice(-48));
  assert.ok(ctx.levels);
  assert.equal(ctx.levels.PDL, 9.0);
  assert.equal(ctx.levels.PML, null);
});

test("buildStopContext has null levels without a previous session", () => {
  const ctx = buildStopContext(SWING_DAY, FAR);
  assert.ok(ctx);
  assert.equal(ctx.sessionDate, "2026-10-28");
  assert.equal(ctx.recent.length, SWING_DAY.length);
  assert.equal(ctx.levels, null);
});

test("buildStopContext returns null with no reading session", () => {
  assert.equal(buildStopContext([], FAR), null);
  const pre = [bar("2026-10-29", 8, 0, 9.0)];
  assert.equal(buildStopContext(pre, FAR), null);
});
