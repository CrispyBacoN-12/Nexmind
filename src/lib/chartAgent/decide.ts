// The one place setup statuses are decided, shared by the live chart agent and
// the cloud capture/review path. Pure: no I/O, no clock.

import type { LogStatus } from "./logRows";
import type { Review } from "./review";
import { CHART_MAX_SETUPS, UNREAD_REASON, type Setup } from "./types";

/**
 * Kept and unread setups are eligible; the first CHART_MAX_SETUPS eligible ones
 * are `shown`, the rest `capped`. Rejected and stripped ones take no slot.
 * A setup with no review is unread. Output keeps input order.
 */
export function decideSetups(
  setups: Setup[],
  reviews: Map<string, Review>,
): { setup: Setup; review: Review; status: LogStatus }[] {
  let shown = 0;
  return setups.map((setup) => {
    const review: Review =
      reviews.get(setup.ticker) ?? { status: "unread", reading: null, reason: UNREAD_REASON };
    let status: LogStatus;
    if (review.status === "rejected") status = "ai_rejected";
    else if (review.status === "stripped") status = "guard_stripped";
    else if (shown < CHART_MAX_SETUPS) {
      shown++;
      status = "shown";
    } else status = "capped";
    return { setup, review, status };
  });
}
