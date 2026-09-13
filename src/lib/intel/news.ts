// SCOUT goes live — pulls real news and the crypto Fear & Greed index
// (alternative.me) into the same NewsItem/Setting stores the dashboard reads.
//
// The news half used to call `news?category=general`, which is the whole
// market's front page: US politics, oil, a European bank, whatever Finnhub had
// that hour. Those rows landed in NewsItem with `symbol` null, so nothing on
// this desk could say which of them was about anything it owns. As of
// 2026-09-14 it asks `company-news?symbol=` instead, once per open position,
// and fills the `symbol` column that has been on the model all along.
//
// Nothing here feeds an analyst or a trade. The only reader is the dashboard's
// SCOUT Intel panel (src/app/page.tsx) — this is reading material for the
// owner, and the 2026-09-08 earnings screen is a standing reminder of how a
// non-price data class tends to do when it is asked to decide anything.

import { prisma } from "@/lib/db";
import { setSetting } from "@/lib/settings";

/** How far back to ask. A week of company news is already ~240 rows a name. */
export const NEWS_LOOKBACK_DAYS = 7;
/** Newest N kept per symbol. The panel shows 8 rows in total; this is about
 *  keeping one loud name from filling the whole panel. */
export const NEWS_PER_SYMBOL = 3;
/** Ceiling on the symbols asked about, so the number of API calls is bounded by
 *  this file and not by how many positions happen to be open. */
export const NEWS_MAX_SYMBOLS = 12;

const MS_PER_DAY = 86_400_000;

export interface NewsRefresh {
  inserted: number;
  skipped: number;
  /** The symbols actually asked about. Empty means the desk is flat — which is
   *  a different fact from "the fetch failed", and the caller can tell them
   *  apart because the failure also sets `error`. */
  symbols: string[];
  error?: string;
}

interface FinnhubCompanyNews {
  headline?: string; summary?: string; url?: string; datetime?: number; source?: string;
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Distinct symbols with an open trade, capped. The desk holds single stocks,
 *  so every one of these is a valid company-news symbol. */
async function openSymbols(): Promise<string[]> {
  const rows = await prisma.trade.findMany({
    where: { status: "open" },
    select: { symbol: true },
    distinct: ["symbol"],
    orderBy: { openedAt: "desc" },
    take: NEWS_MAX_SYMBOLS,
  });
  return rows.map((r) => r.symbol);
}

async function fetchSymbolNews(symbol: string, key: string, from: string, to: string): Promise<FinnhubCompanyNews[]> {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}` +
        `&from=${from}&to=${to}&token=${key}`,
    );
    if (!res.ok) return [];
    const body = await res.json();
    if (!Array.isArray(body)) return [];
    // Sorted rather than taken as given: the endpoint returns newest-first today
    // and that ordering is not part of any contract we are owed.
    return (body as FinnhubCompanyNews[])
      .filter((r) => typeof r.datetime === "number" && typeof r.url === "string" && r.url !== "")
      .sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))
      .slice(0, NEWS_PER_SYMBOL);
  } catch {
    // One dead symbol must not cost the other eleven their news.
    return [];
  }
}

export async function refreshFinnhubNews(): Promise<NewsRefresh> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return { inserted: 0, skipped: 0, symbols: [], error: "FINNHUB_API_KEY not set" };

  const symbols = await openSymbols();
  if (symbols.length === 0) {
    // Deliberately NOT falling back to the general feed. The whole point of the
    // change is that a row in this store is about something the desk holds; a
    // flat desk has no such news, and an empty panel says that honestly.
    return { inserted: 0, skipped: 0, symbols: [], error: "no open positions to pull news for" };
  }

  const now = new Date();
  const to = isoDay(now);
  const from = isoDay(new Date(now.getTime() - NEWS_LOOKBACK_DAYS * MS_PER_DAY));

  const perSymbol = await Promise.all(
    symbols.map(async (symbol) => ({ symbol, items: await fetchSymbolNews(symbol, key, from, to) })),
  );

  // Deduped twice: once inside this batch (two positions can share a story) and
  // once against what is already stored.
  const candidates: { symbol: string; it: FinnhubCompanyNews }[] = [];
  const batchUrls = new Set<string>();
  for (const { symbol, items } of perSymbol) {
    for (const it of items) {
      if (batchUrls.has(it.url!)) continue;
      batchUrls.add(it.url!);
      candidates.push({ symbol, it });
    }
  }

  const existing = await prisma.newsItem.findMany({
    where: { url: { in: [...batchUrls] } },
    select: { url: true },
  });
  const seen = new Set(existing.map((e) => e.url));

  let inserted = 0;
  for (const { symbol, it } of candidates) {
    if (seen.has(it.url!)) continue;
    await prisma.newsItem.create({
      data: {
        // The vendor, not the outlet: `it.source` is Yahoo/Reuters/etc and the
        // panel's badge is about where this desk got the row.
        source: "Finnhub",
        symbol,
        title: it.headline ?? "(no headline)",
        summary: it.summary || null,
        url: it.url,
        createdAt: new Date((it.datetime ?? 0) * 1000),
      },
    });
    inserted++;
  }
  return { inserted, skipped: candidates.length - inserted, symbols };
}

export interface FearGreedResult { value: number; label: string }

export async function refreshFearGreed(): Promise<FearGreedResult | null> {
  try {
    const res = await fetch("https://api.alternative.me/fng/");
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { value: string; value_classification: string }[] };
    const d = body.data?.[0];
    if (!d) return null;
    const fg = { value: Number(d.value), label: d.value_classification };
    await setSetting("fearGreed", JSON.stringify({ ...fg, fetchedAt: new Date().toISOString() }));
    return fg;
  } catch {
    return null;
  }
}
