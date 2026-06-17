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

const OPTIONS_BASE = "https://query2.finance.yahoo.com/v7/finance/options";

/** Fetch a Yahoo option chain. With `expiryUnix`, returns that expiry's chain;
 *  without it, returns the nearest expiry's chain plus the full `expiries` list. */
export async function fetchOptionChain(underlying: string, expiryUnix?: number): Promise<OptionChain> {
  const url = `${OPTIONS_BASE}/${encodeURIComponent(underlying)}${expiryUnix ? `?date=${expiryUnix}` : ""}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "application/json",
    },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`options upstream ${res.status}`);
  return parseOptionChain(await res.json());
}
