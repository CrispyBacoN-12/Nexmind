// Cuts a ticker's 5-minute bars into the sessions the sweep rule needs:
// the previous regular session, today's pre-market and today's regular
// session. Bars are classified by their START time in New York, because a
// UTC cut is wrong half the year (13:30Z is the open in summer, pre-market
// in winter). "Previous" means the latest earlier date that has regular
// bars, not yesterday, so Mondays and days after a holiday work.

import type { Candle } from "@/lib/indicators";
import { etClock } from "@/lib/scanAgent/session";
import type { SessionSplit } from "./types";

const PRE_START_MIN = 4 * 60; // 04:00 ET
const OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const CLOSE_MIN = 16 * 60; // 16:00 ET

/** `today` is a YYYY-MM-DD New York date; `candles` ascending by `t`. */
export function splitSessions(candles: Candle[], today: string): SessionSplit {
  const premarket: Candle[] = [];
  const regular: Candle[] = [];
  const regularByDate = new Map<string, Candle[]>();

  for (const c of candles) {
    const { date, minutes } = etClock(c.t);
    if (date > today) continue;
    if (date === today) {
      if (minutes >= PRE_START_MIN && minutes < OPEN_MIN) premarket.push(c);
      else if (minutes >= OPEN_MIN && minutes < CLOSE_MIN) regular.push(c);
      continue;
    }
    if (minutes < OPEN_MIN || minutes >= CLOSE_MIN) continue;
    const day = regularByDate.get(date);
    if (day) day.push(c);
    else regularByDate.set(date, [c]);
  }

  // YYYY-MM-DD strings sort chronologically.
  let previousDate: string | null = null;
  for (const date of regularByDate.keys()) {
    if (previousDate === null || date > previousDate) previousDate = date;
  }
  const previous = previousDate ? (regularByDate.get(previousDate) ?? []) : [];
  return { previousDate, previous, premarket, regular };
}
