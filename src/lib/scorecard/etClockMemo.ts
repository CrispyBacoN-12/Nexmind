// A memoised `etClock` for the scorer and the random control. Both call it on every
// bar of every trade, and the control does so once per draw (200 runs), so the same
// bar timestamps are converted over and over; `etClock` goes through
// Intl.DateTimeFormat.formatToParts, which is slow. Pure: same answers as `etClock`.

import { etClock } from "@/lib/scanAgent/session";

export type EtClock = { date: string; minutes: number };

/** The memo is cleared whole once it holds more than this many timestamps. */
export const ET_CLOCK_MEMO_MAX = 2_000_000;

/** A memoised etClock keyed by epoch second, cleared when it grows past `max`. */
export function makeEtClockMemo(max: number = ET_CLOCK_MEMO_MAX): { clock: (epochSec: number) => EtClock; size: () => number } {
  const memo = new Map<number, EtClock>();
  return {
    clock(epochSec: number): EtClock {
      const hit = memo.get(epochSec);
      if (hit) return { date: hit.date, minutes: hit.minutes };
      const c = etClock(epochSec);
      if (memo.size >= max) memo.clear();
      memo.set(epochSec, { date: c.date, minutes: c.minutes });
      return c;
    },
    size: () => memo.size,
  };
}

const shared = makeEtClockMemo();

/** `etClock(epochSec)`, O(1) after the first call for a timestamp. */
export const etClockMemo = shared.clock;
