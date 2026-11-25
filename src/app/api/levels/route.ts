// Support/resistance for the /levels page. LOCAL ONLY (404 on Vercel or for a
// request not addressed to localhost), because a held ticker carries the
// owner's average cost. Candles only: no Finnhub, no DB.
//   GET ?ticker=X → one ticker: zones + 2 years of daily OHLCV with MA50/MA200

import { chartSeries, cleanCandles } from "@/lib/levels/chart";
import { computeLevels } from "@/lib/levels/levels";
import { fetchCandlesBatch } from "@/lib/marketData";
import { TICKER_RE } from "@/lib/portfolio/journalInput";
import { isDeployed, isLocalRequest } from "@/lib/portfolioRisk/localOnly";
import { readHoldings } from "@/lib/portfolioRisk/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (isDeployed() || !isLocalRequest(request.headers)) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  try {
    const ticker = new URL(request.url).searchParams.get("ticker")?.trim().toUpperCase() ?? "";
    if (!ticker || !TICKER_RE.test(ticker)) return Response.json({ ok: false, error: "Enter a ticker symbol, e.g. AAPL." }, { status: 400 });

    const holding = (await readHoldings()).find((h) => h.ticker === ticker);
    const nowSec = Math.floor(Date.now() / 1000);
    const asOf = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const candles = cleanCandles((await fetchCandlesBatch([ticker], "2y", "1d")).get(ticker)?.candles ?? []);
    return Response.json({
      ok: true,
      asOf,
      row: {
        ticker,
        held: holding != null,
        avgCost: holding?.avgCost ?? null,
        result: computeLevels(candles, nowSec),
        series: chartSeries(candles, nowSec),
      },
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 120) }, { status: 500 });
  }
}
