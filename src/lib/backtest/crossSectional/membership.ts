// Point-in-time S&P 500 membership, vendored from fja05680/sp500 by
// scripts/fetch-sp500-membership.mts (see .cache/sp500-membership.csv). Pure
// parsing + lookup — no I/O here; that discipline is what lets this run
// inside a backtest without a network call.
import { dayKey } from "./calendar";

export interface MembershipSnapshot {
  /** dayKey of the snapshot date — the same integer day both cross-sectional engines use. */
  day: number;
  members: Set<string>;
}

/**
 * Parses the fja05680/sp500 "Updated" CSV: a `date,tickers` header, then one
 * row per snapshot as `YYYY-MM-DD,"TICK1,TICK2,...,TICKn"`. The quoted field
 * is a plain comma list — no ticker in the source contains a literal comma —
 * so this is a fixed two-column split, not a general CSV parser.
 */
export function parseMembershipCsv(csv: string): MembershipSnapshot[] {
  const lines = csv.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const snapshots: MembershipSnapshot[] = [];
  for (const line of lines.slice(1)) {
    const comma = line.indexOf(",");
    const dateStr = line.slice(0, comma);
    let rest = line.slice(comma + 1);
    if (rest.startsWith('"') && rest.endsWith('"')) rest = rest.slice(1, -1);
    const [y, m, d] = dateStr.split("-").map(Number);
    snapshots.push({
      day: dayKey(Date.UTC(y, m - 1, d) / 1000),
      members: new Set(rest.split(",").filter((t) => t.length > 0)),
    });
  }
  return snapshots;
}

/**
 * A `symbol`/`day` lookup against the latest snapshot on or before `day`.
 * Binary search, not a linear scan: this runs once per candidate per day
 * across a multi-year study. A day before the first snapshot has no members
 * (defined, not a crash); a day after the last snapshot uses that last
 * snapshot, i.e. today's "current membership" behaviour.
 */
export function buildMembershipIndex(
  snapshots: MembershipSnapshot[],
): (symbol: string, day: number) => boolean {
  const sorted = [...snapshots].sort((a, b) => a.day - b.day);

  return (symbol: string, day: number) => {
    let lo = 0;
    let hi = sorted.length - 1;
    let at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].day <= day) {
        at = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return at === -1 ? false : sorted[at].members.has(symbol);
  };
}
