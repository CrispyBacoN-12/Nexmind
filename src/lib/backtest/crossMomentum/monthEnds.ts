// Monthly rebalancing needs to know which days on the shared union calendar are
// month ends. Day keys are UTC day counts (see dayKey in crossSectional/calendar),
// so the month a key belongs to has to be read back out of a Date.
const DAY_SECONDS = 86_400;

/** The UTC calendar month a day key falls in, as an orderable integer. */
export function monthKey(day: number): number {
  const d = new Date(day * DAY_SECONDS * 1000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/**
 * Indices into `days` that are the last trading day of their UTC month.
 *
 * The final element is deliberately never counted. Its month is still in
 * progress as far as the data goes, and a rebalance there would have no later
 * rebalance to exit into — so excluding it is exactly what discards the partial
 * trailing period the spec calls for, rather than a separate special case.
 */
export function monthEndIndices(days: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < days.length - 1; i++) {
    if (monthKey(days[i + 1]) !== monthKey(days[i])) out.push(i);
  }
  return out;
}
