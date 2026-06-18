// Yahoo option-chain fetcher + pure parser.

import type { OptionType } from "./blackScholes";

export interface OptionQuote {
  type: OptionType;
  strike: number;
  expiry: number;          // unix seconds
  bid: number;
  ask: number;
  lastPrice: number;
  impliedVolatility: number;
}

export interface OptionChain {
  underlyingPrice: number;
  expiries: number[];      // unix seconds, all available expirations
  calls: OptionQuote[];
  puts: OptionQuote[];
}

interface RawQuote { strike?: number; bid?: number; ask?: number; lastPrice?: number; impliedVolatility?: number }

/** Pure transform of a Yahoo options response into an OptionChain. Throws if empty. */
export function parseOptionChain(json: unknown): OptionChain {
  const result = (json as { optionChain?: { result?: unknown[] } })?.optionChain?.result?.[0] as
    | { expirationDates?: number[]; quote?: { regularMarketPrice?: number }; options?: { expirationDate?: number; calls?: RawQuote[]; puts?: RawQuote[] }[] }
    | undefined;
  if (!result) throw new Error("options: no chain result");
  const underlyingPrice = result.quote?.regularMarketPrice;
  if (underlyingPrice == null) throw new Error("options: no underlying price");
  const opt = result.options?.[0];
  const expiry = opt?.expirationDate ?? 0;
  const map = (q: RawQuote, type: OptionType): OptionQuote => ({
    type, strike: q.strike ?? 0, expiry, bid: q.bid ?? 0, ask: q.ask ?? 0,
    lastPrice: q.lastPrice ?? 0, impliedVolatility: q.impliedVolatility ?? 0,
  });
  return {
    underlyingPrice,
    expiries: result.expirationDates ?? [],
    calls: (opt?.calls ?? []).map((q) => map(q, "call")),
    puts: (opt?.puts ?? []).map((q) => map(q, "put")),
  };
}

const OPTIONS_BASE = "https://query1.finance.yahoo.com/v7/finance/options";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Yahoo's v7 options endpoint now requires a session cookie + matching crumb,
// or it answers 401. We fetch both once and cache them for a while, refreshing
// on demand (e.g. after a 401).
let yahooAuth: { cookie: string; crumb: string; expires: number } | null = null;
const AUTH_TTL_MS = 30 * 60_000;

async function fetchWithTimeout(url: string, headers: Record<string, string>, ms = 15_000): Promise<Response> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  try {
    return await fetch(url, { signal: abort.signal, headers, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

/** Get (and cache) a Yahoo cookie + crumb pair. `force` skips the cache. */
async function getYahooAuth(force = false): Promise<{ cookie: string; crumb: string }> {
  if (!force && yahooAuth && yahooAuth.expires > Date.now()) return yahooAuth;

  // 1. Hit a Yahoo host to obtain the A1/A3 session cookies.
  const seed = await fetchWithTimeout("https://fc.yahoo.com", { "User-Agent": UA, Accept: "*/*" });
  const setCookies = seed.headers.getSetCookie?.() ?? [];
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("options auth: no cookie from Yahoo");

  // 2. Exchange the cookie for a crumb.
  const crumbRes = await fetchWithTimeout("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    "User-Agent": UA, Accept: "text/plain", Cookie: cookie,
  });
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes("<")) throw new Error("options auth: no crumb from Yahoo");

  yahooAuth = { cookie, crumb, expires: Date.now() + AUTH_TTL_MS };
  return yahooAuth;
}

async function fetchChainJson(underlying: string, expiryUnix: number | undefined, auth: { cookie: string; crumb: string }): Promise<Response> {
  const params = new URLSearchParams({ crumb: auth.crumb });
  if (expiryUnix) params.set("date", String(expiryUnix));
  const url = `${OPTIONS_BASE}/${encodeURIComponent(underlying)}?${params}`;
  return fetchWithTimeout(url, { "User-Agent": UA, Accept: "application/json", Cookie: auth.cookie });
}

/** Fetch a Yahoo option chain. With `expiryUnix`, returns that expiry's chain;
 *  without it, returns the nearest expiry's chain plus the full `expiries` list. */
export async function fetchOptionChain(underlying: string, expiryUnix?: number): Promise<OptionChain> {
  let auth = await getYahooAuth();
  let res = await fetchChainJson(underlying, expiryUnix, auth);
  // A stale cookie/crumb shows up as 401/403 — refresh once and retry.
  if (res.status === 401 || res.status === 403) {
    auth = await getYahooAuth(true);
    res = await fetchChainJson(underlying, expiryUnix, auth);
  }
  if (!res.ok) throw new Error(`options upstream ${res.status}`);
  return parseOptionChain(await res.json());
}
