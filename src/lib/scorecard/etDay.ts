// The UTC span of one New York calendar date, DST-correct. Pure.

import { etClock } from "@/lib/scanAgent/session";

/** 00:00 New York on `date` (YYYY-MM-DD) as epoch ms: the candidate whose own ET wall clock reads 00:00 that date. */
function etMidnightMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, 0, 0);
  for (const offsetHours of [4, 5]) {
    const candidate = wallAsUtc + offsetHours * 3_600_000;
    const c = etClock(candidate / 1000);
    if (c.date === date && c.minutes === 0) return candidate;
  }
  throw new Error(`etDayBoundsMs: cannot resolve 00:00 ET on ${date}`);
}

/** [startMs, endMs): from 00:00 ET on `date` to 00:00 ET on the next calendar date. */
export function etDayBoundsMs(date: string): { startMs: number; endMs: number } {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { startMs: etMidnightMs(date), endMs: etMidnightMs(next) };
}
