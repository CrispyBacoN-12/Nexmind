// New York session clock for the scan. Every screen row belongs to one US
// trading session, and "which session is this data from" is a New York
// question, not a UTC or Bangkok one: the owner reads the page in Thailand,
// the exchange lives on Eastern time and moves its clocks twice a year.
//
// Weekends are handled; exchange holidays are not (there is no free calendar
// in this repo). A holiday session therefore reads as a normal weekday.

import type { MarketPhase } from "./types";

const ET = "America/New_York";
const PRE_START_MIN = 4 * 60; // 04:00 ET
const OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const CLOSE_MIN = 16 * 60; // 16:00 ET

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
});

interface EtParts {
  date: string;
  minutes: number; // minutes since 00:00 ET
  weekday: boolean;
}

function etParts(ms: number): EtParts {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    weekday: p.weekday !== "Sat" && p.weekday !== "Sun",
  };
}

/** The YYYY-MM-DD New York calendar date of an epoch-seconds timestamp. */
export function etDate(epochSec: number): string {
  return etParts(epochSec * 1000).date;
}

/** Calendar arithmetic on a YYYY-MM-DD string, free of any timezone. */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function isWeekday(date: string): boolean {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6;
}

/** The weekday strictly before `date`. */
function previousWeekday(date: string): string {
  let d = addDays(date, -1);
  while (!isWeekday(d)) d = addDays(d, -1);
  return d;
}

export function marketPhase(nowMs: number): MarketPhase {
  const { minutes, weekday } = etParts(nowMs);
  if (!weekday) return "closed";
  if (minutes >= PRE_START_MIN && minutes < OPEN_MIN) return "pre";
  if (minutes >= OPEN_MIN && minutes < CLOSE_MIN) return "open";
  return "closed";
}

/**
 * The session the data on screen belongs to, and the one before it.
 * Today counts once it is a weekday at/after 04:00 ET; otherwise it is the
 * most recent earlier weekday.
 */
export function sessionDates(nowMs: number): {
  session: string;
  previous: string;
} {
  const { date, minutes, weekday } = etParts(nowMs);
  const session =
    weekday && minutes >= PRE_START_MIN ? date : previousWeekday(date);
  return { session, previous: previousWeekday(session) };
}

/** 16:00 New York on `date` (YYYY-MM-DD) as epoch ms, correct across DST. */
export function etSessionCloseMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, 16, 0);
  // New York is UTC-4 (EDT) or UTC-5 (EST): keep the candidate whose own
  // New York wall clock reads exactly 16:00 on that date.
  for (const offsetHours of [4, 5]) {
    const candidate = wallAsUtc + offsetHours * 3_600_000;
    const p = etParts(candidate);
    if (p.date === date && p.minutes === CLOSE_MIN) return candidate;
  }
  throw new Error(`etSessionCloseMs: cannot resolve 16:00 ET on ${date}`);
}
