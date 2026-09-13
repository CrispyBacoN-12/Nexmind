// The next scheduled earnings report. Finnhub's calendar, free tier, verified
// live on 2026-09-14 with the key already in .env.
//
// Deliberately NOT a field on `Fundamentals`. `fetchFundamentals` feeds
// `fundamentalsLine`, which feeds `buildAnalystContext`, which is in every HAWK
// and SAGE prompt on every scan — adding a line there changes what the desk's
// analysts read and splits the `Counterfactual` population at the date it
// ships. This module is read by the advisory tool only, which decides nothing
// and trades nothing.
//
// A vendor calendar is restated history and is therefore NOT research-grade:
// the 2026-09-08 earnings-event screen used SEC EDGAR acceptance timestamps for
// exactly that reason. It is fine here because this asks only about a report
// that has not happened yet, and the answer is shown to a human rather than
// backtested. Do not reach for this module from anything under scripts/.

import type { EarningsInfo } from "@/lib/advisor/types";

import { NON_EQUITY } from "./fundamentals";

/** How far ahead to look. One quarter plus slack, so a name that has just
 *  reported comes back "none scheduled" rather than with the wrong quarter. */
export const EARNINGS_HORIZON_DAYS = 120;

const MS_PER_DAY = 86_400_000;

interface FinnhubEarningsRow {
  date?: string;
  hour?: string;
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Never throws and never returns a bare null: a missing date always carries the
 * reason it is missing, because the card renders "unknown — <reason>" and
 * "unknown" on its own is what lets a dead API key read as a quiet all-clear.
 *
 * `today` is injectable so the tests do not depend on the clock.
 */
export async function fetchNextEarnings(symbol: string, today: Date = new Date()): Promise<EarningsInfo> {
  const none = (note: string): EarningsInfo => ({ date: null, hour: null, note });

  if (NON_EQUITY.test(symbol)) return none("not a single stock — it has no earnings calendar");
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return none("FINNHUB_API_KEY not set");

  const from = isoDay(today);
  const to = isoDay(new Date(today.getTime() + EARNINGS_HORIZON_DAYS * MS_PER_DAY));

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}` +
        `&symbol=${encodeURIComponent(symbol)}&token=${key}`,
    );
    if (!res.ok) return none(`Finnhub HTTP ${res.status}`);

    const rows = ((await res.json()) as { earningsCalendar?: FinnhubEarningsRow[] }).earningsCalendar ?? [];
    // Sorted rather than taken as given: the endpoint is a calendar query and
    // its ordering is not part of the contract. ISO dates sort lexically.
    const dated = rows
      .filter((r): r is FinnhubEarningsRow & { date: string } => typeof r.date === "string" && r.date !== "")
      .sort((a, b) => a.date.localeCompare(b.date));

    const next = dated[0];
    if (!next) return none(`no report scheduled in the next ${EARNINGS_HORIZON_DAYS} days`);

    return { date: next.date, hour: typeof next.hour === "string" && next.hour !== "" ? next.hour : null };
  } catch (e) {
    return none(`earnings calendar fetch failed: ${String(e).slice(0, 80)}`);
  }
}
