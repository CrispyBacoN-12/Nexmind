// One on-demand risk analysis of the owner's holdings. LOCAL ONLY (404 on
// Vercel before reading anything). Read-only except for caching each holding's
// stock/ETF kind and industry back into the local file.

import { fetchNextEarnings } from "@/lib/market/earnings";
import { fetchLiveQuote } from "@/lib/market/quote";
import { fetchCandlesBatch } from "@/lib/marketData";
import { buildPortfolioAnalysis, makePacer } from "@/lib/portfolioRisk/analysis";
import { isDeployed } from "@/lib/portfolioRisk/localOnly";
import { fetchProfileKind } from "@/lib/portfolioRisk/profile";
import { readHoldings, setProfiles } from "@/lib/portfolioRisk/store";

export const dynamic = "force-dynamic";
/** Finnhub's free tier is 60/min; stay under it. */
const FINNHUB_PER_MINUTE = 55;

export async function GET() {
  if (isDeployed()) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  try {
    const holdings = await readHoldings();
    const asOf = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    if (holdings.length === 0) return Response.json({ ok: true, analysis: null, asOf });

    const tickers = holdings.map((h) => h.ticker);
    const batch = await fetchCandlesBatch([...tickers, "SPY"], "1y", "1d");
    const candles = new Map(tickers.map((t) => [t, batch.get(t)?.candles ?? null]));

    const analysis = await buildPortfolioAnalysis(
      holdings,
      {
        liveQuote: fetchLiveQuote,
        earnings: (t) => fetchNextEarnings(t),
        profile: (t) => fetchProfileKind(t),
        candles,
        spy: batch.get("SPY")?.candles ?? null,
        pace: makePacer(FINNHUB_PER_MINUTE),
      },
      asOf,
    );
    await setProfiles(analysis.profileUpdates);
    return Response.json({ ok: true, analysis });
  } catch (e) {
    return Response.json({ ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 120) }, { status: 500 });
  }
}
