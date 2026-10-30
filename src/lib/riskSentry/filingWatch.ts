// Pure: which held tickers filed an 8-K worth reading since the last run.
//
// An 8-K is the filing a US issuer must make within four business days of a
// material event, and its ITEM NUMBERS say what kind of event it was. That is
// the whole appeal for a risk check: the classification is the issuer's own,
// made under securities law, not a headline tagger's guess. Risk Sentry already
// warns before a scheduled earnings date; this catches the unscheduled ones — a
// restatement, an auditor change, a CEO leaving — that no calendar announces.
//
// The filings and the clock are supplied by the caller (runRiskSentry.ts), same
// boundary as the rest of src/lib/riskSentry/.

export type FilingTier = "red" | "notable" | "quiet";

/**
 * Item numbers from SEC Form 8-K General Instructions. "red" items are the ones
 * that can change what a holding is worth overnight; "notable" items are worth
 * reading before the next session; "quiet" items are routine and never alert
 * on their own (2.02 because the earnings watchdog already covered the date,
 * 9.01 because it is only the exhibit list attached to another item).
 */
export const EIGHT_K_ITEMS: Readonly<Record<string, { label: string; tier: FilingTier }>> = {
  "1.01": { label: "entered a material agreement", tier: "notable" },
  "1.02": { label: "terminated a material agreement", tier: "notable" },
  "1.03": { label: "bankruptcy or receivership", tier: "red" },
  "1.04": { label: "mine safety violation", tier: "notable" },
  "1.05": { label: "material cybersecurity incident", tier: "red" },
  "2.01": { label: "completed an acquisition or disposition", tier: "notable" },
  "2.02": { label: "results of operations (earnings release)", tier: "quiet" },
  "2.03": { label: "new direct financial obligation", tier: "quiet" },
  "2.04": { label: "event accelerating a financial obligation", tier: "red" },
  "2.05": { label: "exit or restructuring costs", tier: "notable" },
  "2.06": { label: "material impairment", tier: "red" },
  "3.01": { label: "delisting notice or listing-rule failure", tier: "red" },
  "3.02": { label: "unregistered sale of equity (dilution)", tier: "notable" },
  "3.03": { label: "change to shareholders' rights", tier: "notable" },
  "4.01": { label: "change of auditor", tier: "red" },
  "4.02": { label: "prior financial statements can no longer be relied on (restatement)", tier: "red" },
  "5.01": { label: "change in control", tier: "notable" },
  "5.02": { label: "director or officer departure/appointment", tier: "notable" },
  "5.03": { label: "bylaw or fiscal-year change", tier: "quiet" },
  "5.07": { label: "shareholder vote results", tier: "quiet" },
  "7.01": { label: "Regulation FD disclosure", tier: "quiet" },
  "8.01": { label: "other events", tier: "quiet" },
  "9.01": { label: "financial statements and exhibits", tier: "quiet" },
};

/** One 8-K (or 8-K/A) as the I/O layer hands it over. */
export interface FilingRow {
  form: string;
  /** Item numbers as filed, e.g. ["2.02", "9.01"]. */
  items: string[];
  /** EDGAR's acceptanceDateTime, ISO UTC. Point-in-time by construction. */
  acceptedAt: string;
  url: string;
}

export interface FilingHitItem {
  code: string;
  label: string;
  tier: FilingTier;
}

export interface FilingHit {
  ticker: string;
  form: string;
  acceptedAt: string;
  /** Only the items that are not quiet, red first. Never empty. */
  items: FilingHitItem[];
  tier: Exclude<FilingTier, "quiet">;
  url: string;
}

/** Per-ticker fetch outcome. `noFiler` is structural (an ETF has no 8-Ks);
 *  `error` is a failed check and must never read as an all-clear. */
export type FilingFetchResult = { filings: FilingRow[] } | { noFiler: true } | { error: string };

export interface FilingWatchResult {
  hits: FilingHit[];
  /** Tickers whose check failed — they were NOT checked, which is not the same as clean. */
  failed: { ticker: string; reason: string }[];
  /** Tickers with no SEC filer behind them (funds, ADRs filing elsewhere). */
  noFiler: string[];
}

const TIER_RANK: Record<FilingTier, number> = { red: 0, notable: 1, quiet: 2 };

/** An item code EDGAR returns that this table does not know is shown, not dropped. */
function classify(code: string): FilingHitItem {
  const known = EIGHT_K_ITEMS[code];
  return known ? { code, ...known } : { code, label: "unrecognised item", tier: "notable" };
}

/**
 * Filings accepted in (since, until]. The upper bound is the run's own start
 * time, and the caller stores that same instant as the next run's `since`, so a
 * filing accepted while this run is fetching is reported once, next time —
 * never twice and never lost.
 */
export function filingWatch(
  results: { ticker: string; result: FilingFetchResult }[],
  since: Date,
  until: Date,
): FilingWatchResult {
  const fromMs = since.getTime();
  const toMs = until.getTime();
  const hits: FilingHit[] = [];
  const failed: FilingWatchResult["failed"] = [];
  const noFiler: string[] = [];

  for (const { ticker, result } of results) {
    if ("error" in result) {
      failed.push({ ticker, reason: result.error });
      continue;
    }
    if ("noFiler" in result) {
      noFiler.push(ticker);
      continue;
    }
    for (const f of result.filings) {
      if (f.form !== "8-K" && f.form !== "8-K/A") continue;
      const at = Date.parse(f.acceptedAt);
      if (!Number.isFinite(at) || at <= fromMs || at > toMs) continue;
      const items = f.items
        .map((c) => classify(c.trim()))
        .filter((i) => i.tier !== "quiet")
        .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);
      if (items.length === 0) continue;
      hits.push({
        ticker,
        form: f.form,
        acceptedAt: f.acceptedAt,
        items,
        tier: items[0].tier === "red" ? "red" : "notable",
        url: f.url,
      });
    }
  }

  hits.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.acceptedAt.localeCompare(b.acceptedAt));
  return { hits, failed, noFiler };
}

/** First run looks back this far; a gap in runs is caught up to MAX. */
export const FILING_WATCH_FIRST_RUN_DAYS = 3;
export const FILING_WATCH_MAX_LOOKBACK_DAYS = 14;

const MS_PER_DAY = 86_400_000;

/** Where this run's window starts, from the stored end of the last one. */
export function filingWindowStart(stored: string | null, now: Date): Date {
  const floor = now.getTime() - FILING_WATCH_MAX_LOOKBACK_DAYS * MS_PER_DAY;
  const parsed = stored ? Date.parse(stored) : NaN;
  if (!Number.isFinite(parsed) || parsed > now.getTime()) {
    return new Date(now.getTime() - FILING_WATCH_FIRST_RUN_DAYS * MS_PER_DAY);
  }
  return new Date(Math.max(parsed, floor));
}
