// Support/resistance zones for /portfolio. LOCAL ONLY (404 on Vercel or for a
// request not addressed to localhost). Candles only: no Finnhub, no DB.
//   GET                       → summary for every holding (no price series)
//   GET ?ticker=X             → one ticker, held or not
//   GET ?ticker=X&series=1    → plus ~1 year of closes and MA50/MA200 for the chart

import { sma, type Candle } from "@/lib/indicators";
import { computeLevels, completedBars } from "@/lib/levels/levels";
import { fetchCandlesBatch } from "@/lib/marketData";
import { TICKER_RE } from "@/lib/portfolio/journalInput";
import { isDeployed, isLocalRequest } from "@/lib/portfolioRisk/localOnly";
import { readHoldings } from "@/lib/portfolioRisk/store";

export const dynamic = "force-dynamic";

const SERIES_BARS = 252;

function seriesOf(candles: Candle[], nowSec: number) {
  const { bars, forming } = completedBars(candles, nowSec);
  const closes = bars.map((b) => b.c);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const start = Math.max(0, bars.length - SERIES_BARS);
  const rows = bars.slice(start).map((b, k) => ({ t: b.t, c: b.c, ma50: ma50[start + k], ma200: ma200[start + k] }));
  if (forming) rows.push({ t: forming.t, c: forming.c, ma50: null, ma200: null });
  return rows;
}

export async function GET(request: Request) {
  if (isDeployed() || !isLocalRequest(request.headers)) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  try {
    const url = new URL(request.url);
    const one = url.searchParams.get("ticker")?.trim().toUpperCase() ?? "";
    const holdings = await readHoldings();
    const costOf = new Map(holdings.map((h) => [h.ticker, h.avgCost]));
    if (one && !TICKER_RE.test(one)) return Response.json({ ok: false, error: "Enter a ticker symbol, e.g. AAPL." }, { status: 400 });

    const tickers = one ? [one] : holdings.map((h) => h.ticker);
    const nowSec = Math.floor(Date.now() / 1000);
    const asOf = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    if (tickers.length === 0) return Response.json({ ok: true, asOf, rows: [] });

    const batch = await fetchCandlesBatch(tickers, "2y", "1d");
    const rows = tickers.map((t) => {
      const candles = batch.get(t)?.candles ?? [];
      return {
        ticker: t,
        held: costOf.has(t),
        avgCost: costOf.get(t) ?? null,
        result: computeLevels(candles, nowSec),
        ...(one && url.searchParams.get("series") === "1" ? { series: seriesOf(candles, nowSec) } : {}),
      };
    });
    return Response.json({ ok: true, asOf, rows });
  } catch (e) {
    return Response.json({ ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 120) }, { status: 500 });
  }
}
