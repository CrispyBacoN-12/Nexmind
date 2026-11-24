// Indicative put quotes for one underlying, from Alpaca's free options data.
// "indicative" is Alpaca's derived/delayed quote, not the real NBBO: the card
// says so. `feed=opra` is the paid feed (403 on these keys) — never used.
//
// Never throws, and an error result carries a short reason only: the keys are
// sent as headers and never appear in a URL or a message.

import { parseOccSymbol } from "./math";
import type { PutQuote } from "./types";

export interface PutWindow {
  expGte: string;
  expLte: string;
  strikeGte: number;
  strikeLte: number;
}

export type PutQuotesResult = { quotes: PutQuote[] } | { error: string };

interface Snapshot {
  latestQuote?: { ap?: number; bp?: number; t?: string };
}

const BASE = "https://data.alpaca.markets/v1beta1/options/snapshots";

export async function fetchPutQuotes(
  ticker: string,
  w: PutWindow,
  opts: {
    fetchImpl?: typeof fetch;
    env?: { ALPACA_KEY?: string; ALPACA_SECRET?: string };
    maxPages?: number;
    timeoutMs?: number;
  } = {},
): Promise<PutQuotesResult> {
  const env = opts.env ?? process.env;
  const doFetch = opts.fetchImpl ?? fetch;
  const maxPages = opts.maxPages ?? 5;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  // Standard contracts only: after a split or merger, adjusted contracts get a
  // different root (AAPL1) and deliver something other than 100 shares, so their
  // premium and coverage would be silently wrong. BRK.B's root is BRKB.
  const root = ticker.toUpperCase().replace(/\./g, "");
  if (!env.ALPACA_KEY || !env.ALPACA_SECRET) return { error: "ALPACA_KEY/ALPACA_SECRET not set" };
  const headers = { "APCA-API-KEY-ID": env.ALPACA_KEY, "APCA-API-SECRET-KEY": env.ALPACA_SECRET };

  const quotes: PutQuote[] = [];
  let pageToken: string | undefined;
  try {
    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({
        feed: "indicative",
        type: "put",
        expiration_date_gte: w.expGte,
        expiration_date_lte: w.expLte,
        strike_price_gte: w.strikeGte.toFixed(2),
        strike_price_lte: w.strikeLte.toFixed(2),
        limit: "1000",
      });
      if (pageToken) params.set("page_token", pageToken);
      const res = await doFetch(`${BASE}/${encodeURIComponent(ticker.toUpperCase())}?${params}`, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { error: `Alpaca options HTTP ${res.status}` };

      const body = (await res.json()) as { snapshots?: Record<string, Snapshot>; next_page_token?: string | null };
      for (const [symbol, snap] of Object.entries(body.snapshots ?? {})) {
        const occ = parseOccSymbol(symbol);
        if (!occ || occ.type !== "P" || occ.root !== root) continue;
        const q = snap.latestQuote ?? {};
        quotes.push({
          symbol,
          expiry: occ.expiry,
          strike: occ.strike,
          bid: typeof q.bp === "number" && Number.isFinite(q.bp) ? q.bp : null,
          ask: typeof q.ap === "number" && q.ap > 0 ? q.ap : null,
          quotedAt: typeof q.t === "string" && q.t !== "" ? q.t : null,
        });
      }
      pageToken = body.next_page_token ?? undefined;
      if (!pageToken) break;
    }
  } catch (e) {
    return { error: `option quotes fetch failed: ${String(e).slice(0, 80)}` };
  }
  return { quotes };
}
