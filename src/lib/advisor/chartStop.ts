// Finds a stop for /advisor from the 5-minute chart instead of a flat ATR
// multiple: the most recent confirmed swing low of the latest session, else
// the previous day's low (PDL), each pushed a fraction of an ATR below so a
// wick through the level does not tag the stop. Pure: the caller fetches the
// bars and passes `cutoffSec`, so a forming bar is never read. When neither
// level sits under the entry the result is `none` with the reasons, and the
// caller falls back to the ATR stop.

import type { Candle } from "@/lib/indicators";
import { splitSessions } from "@/lib/chartAgent/bars";
import { computeLevels } from "@/lib/chartAgent/levels";
import { CHART_BAR_SECONDS, CHART_STOP_BUFFER_ATR } from "@/lib/chartAgent/types";
import type { Levels, SessionSplit } from "@/lib/chartAgent/types";
import { etClock } from "@/lib/scanAgent/session";

/** A pivot low must be strictly lower than this many bars on each side. */
export const STOP_PIVOT_SIDE_BARS = 2;
/** Bars of the reading session handed to the AI as context. */
export const STOP_READING_BARS = 48;

const OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const CLOSE_MIN = 16 * 60; // 16:00 ET

export type StructuralSource = "swing" | "pdl";

export interface StopStructure {
  level: number;
  /** Start time (epoch seconds) of the bar holding the level. */
  barT: number;
  /** ET date of the session that bar belongs to. */
  sessionDate: string;
}

export type ChartStopResult =
  | {
      kind: "found";
      source: StructuralSource;
      stop: number;
      structure: StopStructure;
      /** Why a higher-priority source was passed over, in order. */
      skipped: string[];
    }
  | { kind: "none"; reasons: string[] };

export interface StopContext {
  sessionDate: string;
  recent: Candle[];
  levels: Levels | null;
}

const NO_BARS = "ไม่มีแท่ง 5 นาทีที่ปิดแล้ว";
const NO_PREVIOUS = "ไม่มีวันทำการก่อนหน้าในกราฟ 5 นาที จึงไม่มี PDL";
const noSwing = (date: string) => `ไม่มี swing low ใต้ราคาเข้าในกราฟ 5 นาทีวันที่ ${date}`;
const pdlAboveEntry = (pdl: number) =>
  `PDL ${pdl.toFixed(2)} ลบระยะเผื่อแล้วไม่อยู่ใต้ราคาเข้า (มักเกิดจากเปิด gap ลง)`;

/**
 * The reading session is the latest ET date with finished regular bars; the
 * split's `previous` is the PDL session. Null when no such bar exists.
 */
function readingSplit(
  candles: Candle[],
  cutoffSec: number,
): { date: string; split: SessionSplit } | null {
  const finished = candles.filter((c) => c.t + CHART_BAR_SECONDS <= cutoffSec);
  let date: string | null = null;
  for (const c of finished) {
    const { date: d, minutes } = etClock(c.t);
    if (minutes < OPEN_MIN || minutes >= CLOSE_MIN) continue;
    if (date === null || d > date) date = d;
  }
  return date ? { date, split: splitSessions(finished, date) } : null;
}

/** Newest-first scan for a strict pivot low under the entry with a positive stop. */
function findSwing(
  bars: Candle[],
  entry: number,
  buffer: number,
): { low: number; barT: number } | null {
  const k = STOP_PIVOT_SIDE_BARS;
  for (let i = bars.length - 1 - k; i >= k; i--) {
    const low = bars[i].l;
    let pivot = true;
    for (let j = 1; j <= k && pivot; j++) {
      pivot = low < bars[i - j].l && low < bars[i + j].l;
    }
    if (pivot && low < entry && low - buffer > 0) return { low, barT: bars[i].t };
  }
  return null;
}

export function findChartStop(input: {
  candles: Candle[];
  entry: number;
  atr: number;
  cutoffSec: number;
}): ChartStopResult {
  const { candles, entry, atr, cutoffSec } = input;
  const reading = readingSplit(candles, cutoffSec);
  if (!reading) return { kind: "none", reasons: [NO_BARS] };

  const { date, split } = reading;
  const buffer = CHART_STOP_BUFFER_ATR * atr;
  const skipped: string[] = [];

  const swing = findSwing(split.regular, entry, buffer);
  if (swing) {
    return {
      kind: "found",
      source: "swing",
      stop: swing.low - buffer,
      structure: { level: swing.low, barT: swing.barT, sessionDate: date },
      skipped,
    };
  }
  skipped.push(noSwing(date));

  if (split.previous.length === 0 || split.previousDate === null) {
    return { kind: "none", reasons: [...skipped, NO_PREVIOUS] };
  }
  const low = split.previous.reduce((m, c) => (c.l < m.l ? c : m));
  if (!(low.l < entry && low.l - buffer > 0)) {
    return { kind: "none", reasons: [...skipped, pdlAboveEntry(low.l)] };
  }
  return {
    kind: "found",
    source: "pdl",
    stop: low.l - buffer,
    structure: { level: low.l, barT: low.t, sessionDate: split.previousDate },
    skipped,
  };
}

/** What the AI reads alongside a found stop: recent bars and session levels. */
export function buildStopContext(candles: Candle[], cutoffSec: number): StopContext | null {
  const reading = readingSplit(candles, cutoffSec);
  if (!reading) return null;
  const computed = computeLevels(reading.split);
  return {
    sessionDate: reading.date,
    recent: reading.split.regular.slice(-STOP_READING_BARS),
    levels: "levels" in computed ? computed.levels : null,
  };
}
