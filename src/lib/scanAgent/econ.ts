// Today's high-importance US economic releases (CPI, jobs, FOMC...) with their Thai
// time, for the scan banner. Source: the TradingView economic-calendar endpoint,
// which needs an Origin header (probed live 2026-10-31).

import type { EconEvent } from "./types";
import { etDate } from "./session";

const ENDPOINT = "https://economic-calendar.tradingview.com/events";

const thaiTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function toThaiTime(ms: number): string {
  return thaiTimeFormat.format(new Date(ms));
}

/**
 * Keeps `importance === 1` US rows. Throws when `result` is not an array, or when a
 * kept row has no title or an unreadable date (a banner with a wrong time is worse
 * than no banner).
 */
export function parseEconEvents(json: unknown): EconEvent[] {
  const result = (json as { result?: unknown } | null)?.result;
  if (!Array.isArray(result)) throw new Error("economic calendar response has no result array");
  const out: EconEvent[] = [];
  for (const raw of result) {
    const r = raw as { title?: unknown; country?: unknown; date?: unknown; importance?: unknown } | null;
    if (!r || r.importance !== 1 || r.country !== "US") continue;
    const ms = typeof r.date === "string" ? Date.parse(r.date) : NaN;
    if (typeof r.title !== "string" || Number.isNaN(ms)) {
      throw new Error("economic calendar row has no title or a bad date");
    }
    out.push({ title: r.title, at: new Date(ms).toISOString(), thaiTime: toThaiTime(ms) });
  }
  return out;
}

/** Events whose New York calendar date is the session date (YYYY-MM-DD). */
export function eventsForSession(events: EconEvent[], session: string): EconEvent[] {
  return events.filter((e) => etDate(Date.parse(e.at) / 1000) === session);
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Fetches a window one day either side of the session (so no New York-date edge is
 * cut by the UTC boundary) and returns the high-importance US events, unfiltered by
 * session: callers pair this with `eventsForSession`.
 */
export async function fetchEconEvents(session: string): Promise<EconEvent[]> {
  const from = `${shiftDate(session, -1)}T00:00:00.000Z`;
  const to = `${shiftDate(session, 1)}T23:59:59.000Z`;
  const url = `${ENDPOINT}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&countries=US`;
  const res = await fetch(url, { headers: { Origin: "https://www.tradingview.com" } });
  if (!res.ok) throw new Error(`economic calendar HTTP ${res.status}`);
  return parseEconEvents(await res.json());
}
