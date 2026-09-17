// Recent company news for a single ticker (Finnhub free tier).
//
// This is deliberately NOT src/lib/intel/news.ts: that module pulls once per
// open position and writes into the NewsItem table for the dashboard's SCOUT
// Intel panel, and its own header comment says plainly that nothing it
// fetches feeds an analyst or a trade. RAVEN needs the opposite shape — one
// symbol, on demand, held in memory only, never persisted — so this mirrors
// intel/news.ts's Finnhub call rather than reusing it.

import { NON_EQUITY } from "./fundamentals";

export interface NewsHeadline {
  headline: string;
  source: string;
  /** YYYY-MM-DD, from the Finnhub UNIX timestamp. */
  date: string;
  url: string;
}

export interface RecentNews {
  items: NewsHeadline[];
  /** Why `items` is empty, when it is — absent only when the fetch ran and
   *  genuinely found nothing to report beyond "no news in the window". */
  note?: string;
}

export const NEWS_LOOKBACK_DAYS = 7;
export const NEWS_LIMIT = 5;

const MS_PER_DAY = 86_400_000;
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

interface FinnhubCompanyNews {
  headline?: string;
  summary?: string;
  url?: string;
  datetime?: number;
  source?: string;
}

/** Never throws: a failure comes back as an empty list carrying the reason,
 *  the same fail-soft contract as fetchFundamentals and fetchNextEarnings. */
export async function fetchRecentNews(
  symbol: string,
  days: number = NEWS_LOOKBACK_DAYS,
  limit: number = NEWS_LIMIT,
): Promise<RecentNews> {
  if (NON_EQUITY.test(symbol)) return { items: [], note: "not a single stock — it has no company news feed" };
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return { items: [], note: "FINNHUB_API_KEY not set" };

  const now = new Date();
  const to = isoDay(now);
  const from = isoDay(new Date(now.getTime() - days * MS_PER_DAY));

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}` +
        `&from=${from}&to=${to}&token=${key}`,
    );
    if (!res.ok) return { items: [], note: `Finnhub HTTP ${res.status}` };

    const body = await res.json();
    if (!Array.isArray(body)) return { items: [], note: "Finnhub returned an unexpected shape" };

    // Sorted rather than taken as given, same reasoning as intel/news.ts: the
    // endpoint's ordering is not part of any contract we are owed.
    const items = (body as FinnhubCompanyNews[])
      .filter(
        (r): r is FinnhubCompanyNews & { url: string; datetime: number; headline: string } =>
          typeof r.datetime === "number" &&
          typeof r.url === "string" &&
          r.url !== "" &&
          typeof r.headline === "string" &&
          r.headline !== "",
      )
      .sort((a, b) => b.datetime - a.datetime)
      .slice(0, limit)
      .map((r) => ({
        headline: r.headline,
        source: r.source ?? "Finnhub",
        date: isoDay(new Date(r.datetime * 1000)),
        url: r.url,
      }));

    if (items.length === 0) return { items: [], note: `no company news in the last ${days} days` };
    return { items };
  } catch (e) {
    return { items: [], note: `news fetch failed: ${String(e).slice(0, 80)}` };
  }
}
