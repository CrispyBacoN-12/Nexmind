// Recent 8-K filings per ticker, from SEC EDGAR's submissions API. Free, no key.
//
// Read by Risk Sentry only (src/lib/riskSentry/filingWatch.ts decides what is
// worth an alert). The research scripts that read EDGAR — cache-earnings-dates,
// cache-insider-transactions — fetch whole histories into a cache; this asks
// only "what did these few names file this week", so it reads the `recent`
// block and never the overflow files.

import type { FilingFetchResult, FilingRow } from "@/lib/riskSentry/filingWatch";

/** SEC asks every caller to identify itself and to stay under 10 requests/second. */
const UA = process.env.SEC_USER_AGENT || "NEXMIND risk-sentry (personal, non-commercial; contact via repository owner)";
const CONCURRENCY = 4;
const RETRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      // A 404 is an answer ("no such submissions file"), not a transient failure.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`sec HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(400 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

interface RecentBlock {
  form?: string[];
  items?: string[];
  acceptanceDateTime?: string[];
  accessionNumber?: string[];
  primaryDocument?: string[];
}

/** Pure: the 8-K and 8-K/A rows of one submissions `recent` block. Exported for tests. */
export function eightKRows(cik: string, recent: RecentBlock | undefined): FilingRow[] {
  if (!recent?.form) return [];
  const { form, items = [], acceptanceDateTime = [], accessionNumber = [], primaryDocument = [] } = recent;
  const out: FilingRow[] = [];
  for (let i = 0; i < form.length; i++) {
    if (form[i] !== "8-K" && form[i] !== "8-K/A") continue;
    const acc = accessionNumber[i] ?? "";
    const doc = primaryDocument[i] ?? "";
    out.push({
      form: form[i],
      // "2.02,9.01" — split, never substring-match.
      items: (items[i] ?? "").split(",").map((x) => x.trim()).filter(Boolean),
      acceptedAt: acceptanceDateTime[i] ?? "",
      url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}/${doc}`,
    });
  }
  return out;
}

let cikMapPromise: Promise<Map<string, string>> | null = null;

/** ticker -> zero-padded CIK, fetched once per process. A failed fetch is not cached. */
function cikMap(): Promise<Map<string, string>> {
  if (!cikMapPromise) {
    cikMapPromise = (async () => {
      const raw = (await getJson("https://www.sec.gov/files/company_tickers.json")) as Record<
        string,
        { cik_str: number; ticker: string }
      > | null;
      if (!raw) throw new Error("company_tickers.json returned nothing");
      const m = new Map<string, string>();
      for (const row of Object.values(raw)) m.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
      return m;
    })().catch((e) => {
      cikMapPromise = null;
      throw e;
    });
  }
  return cikMapPromise;
}

/**
 * Never throws. A failure comes back per ticker as `{ error }` so Risk Sentry
 * can say which names went unchecked instead of reporting a quiet week.
 */
export async function fetchRecentFilings(tickers: string[]): Promise<Map<string, FilingFetchResult>> {
  const out = new Map<string, FilingFetchResult>();
  let map: Map<string, string>;
  try {
    map = await cikMap();
  } catch (e) {
    const error = `EDGAR ticker map unavailable: ${String(e).slice(0, 80)}`;
    for (const t of tickers) out.set(t, { error });
    return out;
  }

  // EDGAR writes class shares with a dot (BRK.B); the bar caches use a dash.
  const lookup = (t: string) => map.get(t.toUpperCase()) ?? map.get(t.toUpperCase().replace("-", "."));

  let next = 0;
  const worker = async () => {
    while (next < tickers.length) {
      const ticker = tickers[next++];
      const cik = lookup(ticker);
      if (!cik) {
        out.set(ticker, { noFiler: true });
        continue;
      }
      try {
        const sub = (await getJson(`https://data.sec.gov/submissions/CIK${cik}.json`)) as
          | { filings?: { recent?: RecentBlock } }
          | null;
        out.set(ticker, { filings: eightKRows(cik, sub?.filings?.recent) });
      } catch (e) {
        out.set(ticker, { error: String(e instanceof Error ? e.message : e).slice(0, 80) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tickers.length) }, worker));
  return out;
}
