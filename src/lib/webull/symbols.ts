// Resolves a stock ticker to Webull's internal numeric tickerId — every
// Webull data/order endpoint keys off this id, not the ticker string.
// Backed by a persistent WebullTickerCache row (not an in-memory Map), since
// tickerId is effectively static per symbol but the exec-stage hook and the
// polling cron are fresh, short-lived processes that share no memory.
//
// `@/lib/db` is imported lazily (not at module scope) so that merely
// importing this module — which happens on every marketData.ts import, i.e.
// nearly everywhere — doesn't force a live DATABASE_URL. Without Webull
// configured, symbol/candle fetches never reach getTickerId, so the DB
// should stay untouched, matching "falls back to Alpaca/Yahoo exactly as
// today" when WEBULL_APP_KEY/WEBULL_APP_SECRET are unset.
import { signedFetch } from "./auth";

const DATA_HOST = () => process.env.WEBULL_BASE_URL || "https://quotes-api.webullbroker.com"; // confirm host against the live API reference

interface WebullSymbolSearchResult { symbol?: string; tickerId?: number }

/** Pure: extracts the tickerId matching `symbol` from a symbol-search
 *  response body (falling back to the first result on no exact match).
 *  Throws when there's no usable result so the caller doesn't silently cache
 *  a wrong id. */
export function parseTickerIdResponse(json: unknown, symbol: string): number {
  const results = (json as { data?: WebullSymbolSearchResult[] })?.data ?? [];
  const match = results.find((r) => r.symbol?.toUpperCase() === symbol.toUpperCase()) ?? results[0];
  if (!match?.tickerId) throw new Error(`webull: no tickerId found for ${symbol}`);
  return match.tickerId;
}

/** Resolves symbol -> Webull tickerId. Checks the DB cache first; on a miss,
 *  calls Webull's symbol-search endpoint and upserts the result. */
export async function getTickerId(symbol: string): Promise<number> {
  const { prisma } = await import("@/lib/db");
  const cached = await prisma.webullTickerCache.findUnique({ where: { symbol } });
  if (cached) return cached.tickerId;

  const res = await signedFetch("/api/openapi/quote/symbol-search", {
    baseUrl: DATA_HOST(),
    method: "GET",
    params: { keyword: symbol },
  });
  if (!res.ok) throw new Error(`webull: symbol-search upstream ${res.status}`);
  const tickerId = parseTickerIdResponse(await res.json(), symbol);

  await prisma.webullTickerCache.upsert({
    where: { symbol },
    update: { tickerId },
    create: { symbol, tickerId },
  });
  return tickerId;
}
