// One sentence about the next earnings report, written once and read by three
// callers: the card, the facts sheet RAVEN argues about, and nothing else may
// format this differently.
//
// The reason it is its own module rather than a helper inside critiqueContext:
// the owner's screen and RAVEN's input must say the same thing about the same
// date. critiqueContext's own header is explicit that the numbers RAVEN argues
// about are byte-for-byte the numbers on the owner's screen, and an earnings
// line that existed only in the prompt would be the first exception to that —
// RAVEN would cite a date the owner cannot see.
//
// Pure — no I/O anywhere under src/lib/advisor/.

import type { EarningsInfo } from "./types";

const MS_PER_DAY = 86_400_000;

/**
 * Whole calendar days from `asOf` to `date`, both YYYY-MM-DD.
 *
 * Calendar days, not sessions. A session count would be the more useful number
 * and this module cannot compute one: it has no exchange calendar and no
 * holiday list, and guessing 5/7ths of a span would print a number nobody
 * could reproduce. The phrase below says "calendar days" for that reason.
 *
 * Negative when the report already happened, which the caller must handle
 * rather than print.
 */
export function daysBetween(asOf: string, date: string): number | null {
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / MS_PER_DAY);
}

/** Finnhub's session tags, spelled out. An unrecognised tag is passed through. */
const HOUR_LABEL: Record<string, string> = {
  bmo: "before the open",
  amc: "after the close",
  dmh: "during the session",
};

/**
 * The line both surfaces print.
 *
 * `null` earnings and an earnings object with a null date are deliberately NOT
 * the same string. "unknown" means the lookup failed or was never made, and the
 * owner should go and check; "none scheduled" means the lookup succeeded and
 * found nothing in the horizon. Collapsing them would turn a data outage into a
 * reassurance, which is the exact failure mode this project keeps catching.
 */
export function earningsPhrase(earnings: EarningsInfo | null | undefined, asOf: string): string {
  if (earnings == null) return "unknown — no earnings lookup was made for this card";
  if (earnings.date == null) return `unknown — ${earnings.note ?? "no reason was recorded"}`;

  const when = earnings.hour ? ` ${HOUR_LABEL[earnings.hour] ?? earnings.hour}` : "";
  const days = daysBetween(asOf, earnings.date);
  if (days == null) return `${earnings.date}${when}`;
  if (days < 0) return `${earnings.date}${when} — already reported, ${-days} calendar day(s) before the as-of date`;
  if (days === 0) return `${earnings.date}${when} — the as-of date itself`;
  return `${earnings.date}${when} — ${days} calendar day(s) after the as-of date`;
}
