// /journal's "เช็กประกัน put": one protective-put card per open journal
// position. Read-only and on demand (the page calls it only on a button press,
// because it makes several external calls per ticker). Fail-soft per ticker —
// see buildHedgeCard. Risk display only: it never recommends a put.

import { prisma } from "@/lib/db";
import { fetchPutQuotes, type PutQuotesResult, type PutWindow } from "@/lib/hedge/alpacaPuts";
import { buildHedgeCard, type HedgeCard } from "@/lib/hedge/card";
import { fetchNextEarnings } from "@/lib/market/earnings";
import { fetchLiveQuote } from "@/lib/market/quote";
import { fetchCandlesBatch } from "@/lib/marketData";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Same-ticker rows share one fetch. */
function memo<T>(fn: (t: string) => Promise<T>): (t: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>();
  return (t) => {
    if (!cache.has(t)) cache.set(t, fn(t));
    return cache.get(t)!;
  };
}

export async function GET() {
  try {
    const asOf = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const rows = await prisma.journalTrade.findMany({
      where: { exitDate: null },
      select: { id: true, ticker: true, shares: true, entryPrice: true, stop: true },
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) return Response.json({ ok: true, asOf, cards: [] });

    const positions = rows.map((r) => ({ ...r, ticker: r.ticker.toUpperCase() }));
    const tickers = Array.from(new Set(positions.map((p) => p.ticker)));
    const batch = await fetchCandlesBatch(tickers, "1y", "1d");

    const liveQuote = memo(fetchLiveQuote);
    const earnings = memo((t) => fetchNextEarnings(t));
    // Keyed by ticker + window: two rows of one ticker with different stops ask for different strikes.
    const putCache = new Map<string, Promise<PutQuotesResult>>();
    const putQuotes = (t: string, w: PutWindow) => {
      const key = `${t}|${JSON.stringify(w)}`;
      if (!putCache.has(key)) putCache.set(key, fetchPutQuotes(t, w));
      return putCache.get(key)!;
    };

    const cards: HedgeCard[] = [];
    for (const p of positions) {
      const candles = batch.get(p.ticker)?.candles ?? null;
      cards.push(await buildHedgeCard(p, { liveQuote, earnings, putQuotes, candles }, asOf, Date.now()));
    }
    return Response.json({ ok: true, asOf, cards });
  } catch (e) {
    return Response.json({ ok: false, error: String(e).slice(0, 80) }, { status: 500 });
  }
}
