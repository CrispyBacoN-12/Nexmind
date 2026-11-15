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
