// SCOUT goes live — pulls real market news (Finnhub) and the crypto Fear & Greed
// index (alternative.me) into the same NewsItem/Setting stores the analysts read.

import { prisma } from "@/lib/db";
import { setSetting } from "@/lib/settings";

export interface NewsRefresh { inserted: number; skipped: number; error?: string }

interface FinnhubItem {
  id: number; headline: string; summary: string; url: string; datetime: number; source: string;
}

export async function refreshFinnhubNews(): Promise<NewsRefresh> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return { inserted: 0, skipped: 0, error: "FINNHUB_API_KEY not set" };

  const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${key}`);
  if (!res.ok) return { inserted: 0, skipped: 0, error: `Finnhub HTTP ${res.status}` };

  const newest = ((await res.json()) as FinnhubItem[]).slice(0, 10);
  const existing = await prisma.newsItem.findMany({
    where: { url: { in: newest.map((i) => i.url) } },
    select: { url: true },
  });
  const seen = new Set(existing.map((e) => e.url));

  let inserted = 0;
  for (const it of newest) {
    if (!it.url || seen.has(it.url)) continue;
    await prisma.newsItem.create({
      data: {
        source: "Finnhub",
        title: it.headline,
        summary: it.summary || null,
        url: it.url,
        createdAt: new Date(it.datetime * 1000),
      },
    });
    inserted++;
  }
  return { inserted, skipped: newest.length - inserted };
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
