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
const ATTEMPTS = 4;
/** SEC's published ceiling is 10 requests/second; start no two requests closer than this. */
export const SEC_MIN_GAP_MS = 125;
/** Floor for a 403/429 wait when the response names no Retry-After. */
export const SEC_THROTTLE_MIN_WAIT_MS = 1500;
/** A server asking for more than this is not worth waiting for inside one request. */
const MAX_RETRY_AFTER_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * One limiter shared by every worker: `wait()` resolves when this caller may
 * start a request, no two starts closer than `minGapMs`. The slot is reserved
 * synchronously, so concurrent callers queue in order and never share one.
 * `penalize(ms)` pushes every later start back, so a throttled response slows
 * all workers, not just the one that saw it. Clock and sleep are injected.
 */
export function createRequestLimiter(
  minGapMs: number,
  now: () => number,
  sleepFn: (ms: number) => Promise<void>,
): { wait(): Promise<void>; penalize(ms: number): void } {
  let nextStart = 0;
  return {
    async wait() {
      const t = now();
      const start = Math.max(t, nextStart);
      nextStart = start + minGapMs;
      if (start > t) await sleepFn(start - t);
    },
    penalize(ms: number) {
      nextStart = Math.max(nextStart, now() + ms);
    },
  };
}

/** Retry-After is delta-seconds or an HTTP date. Returns ms, or null when absent or unreadable. */
export function parseRetryAfter(header: string | null | undefined, nowMs: number): number | null {
  if (header == null) return null;
  const v = header.trim();
  if (v === "") return null;
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

/**
 * How long to wait before retrying after a failed attempt (0-based). A 403 or
 * 429 is SEC saying slow down: honour Retry-After when it is sent (capped),
 * else at least SEC_THROTTLE_MIN_WAIT_MS and growing. Anything else backs off
 * 0.4 / 0.8 / 1.6 s.
 */
export function retryDelayMs(
  status: number | null,
  retryAfter: string | null | undefined,
  attempt: number,
  nowMs: number,
): number {
  if (status === 403 || status === 429) {
    const asked = parseRetryAfter(retryAfter, nowMs);
    if (asked !== null) return Math.min(asked, MAX_RETRY_AFTER_MS);
    return SEC_THROTTLE_MIN_WAIT_MS * 2 ** attempt;
  }
  return 400 * 2 ** attempt;
}

export interface SecHttpDeps {
  fetch: (url: string, init: { headers: Record<string, string> }) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  limiter: { wait(): Promise<void>; penalize(ms: number): void };
}

/** A 404 is an answer ("no such submissions file"); every other failure is retried. */
export async function getJsonWith(url: string, deps: SecHttpDeps, attempts: number = ATTEMPTS): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let status: number | null = null;
    let retryAfter: string | null = null;
    try {
      await deps.limiter.wait();
      const res = await deps.fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (res.status === 404) return null;
      if (!res.ok) {
        status = res.status;
        retryAfter = res.headers?.get("retry-after") ?? null;
        throw new Error(`sec HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
    if (attempt < attempts - 1) {
      const ms = retryDelayMs(status, retryAfter, attempt, deps.now());
      if (status === 403 || status === 429) deps.limiter.penalize(ms);
      await deps.sleep(ms);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const liveDeps: SecHttpDeps = {
  fetch: (url, init) => fetch(url, init),
  sleep,
  now: Date.now,
  limiter: createRequestLimiter(SEC_MIN_GAP_MS, Date.now, sleep),
};

const getJson = (url: string) => getJsonWith(url, liveDeps);

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
