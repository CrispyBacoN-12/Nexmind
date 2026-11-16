// When the scorecard's Discord summary is due. The job fires on every wake of the
// machine, so these decide that it does its work once per closed US session. Pure.

import { SIP_DELAY_MS } from "@/lib/alpaca";
import { etSessionCloseMs, sessionDates } from "@/lib/scanAgent/session";

/** The latest weekday whose 16:00 ET close is at least the SIP delay old at `nowMs`. Holidays read as weekdays. */
export function latestClosedSession(nowMs: number): string {
  const { session, previous } = sessionDates(nowMs);
  return nowMs >= etSessionCloseMs(session) + SIP_DELAY_MS ? session : previous;
}

/** `lastSent` is the session of the last summary sent, "" when none has been. */
export function summaryDue(nowMs: number, lastSent: string): boolean {
  return lastSent < latestClosedSession(nowMs);
}

export type ScoreAction = "summary" | "refresh" | "none";

/**
 * What the scorer does after its review step. "summary": score, save the live snapshot and
 * send Discord (marks the session sent). "refresh": no summary is due but the review finalized
 * `finalized` >= 1 row, so score and save the live snapshot without Discord (the page updates
 * the same hour; the session is not marked sent). "none": nothing to do.
 */
export function scoreAction(nowMs: number, lastSent: string, finalized: number): ScoreAction {
  if (summaryDue(nowMs, lastSent)) return "summary";
  return finalized >= 1 ? "refresh" : "none";
}
