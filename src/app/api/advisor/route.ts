// The advisory tool's only I/O. Everything in src/lib/advisor/ is pure and
// takes candle arrays; this route is what fetches them.
//
// The benchmark is fetched on its own rather than folded into the batch: SMA200
// needs 200 sessions (~290 calendar days), fetchCandlesBatch takes no minDays,
// and a "6mo" SPY would make the gate read BLIND on every request with nobody
// the wiser.

import { advise } from "@/lib/advisor/advise";
import type { HoldingInput } from "@/lib/advisor/types";
import { BENCHMARK } from "@/lib/market/regime";
import { fetchCandles, fetchCandlesBatch } from "@/lib/marketData";
import type { CandleResponse } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_HOLDINGS = 20;

function toPositiveNumber(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z.\-]{0,9}$/.test(ticker)) {
    return Response.json({ ok: false, error: "Enter a ticker symbol, e.g. AAPL." }, { status: 400 });
  }

  const holdingTickers = Array.isArray(body.holdings)
    ? body.holdings
        .map((h) => String(h ?? "").trim().toUpperCase())
        .filter((h) => /^[A-Z][A-Z.\-]{0,9}$/.test(h))
        .slice(0, MAX_HOLDINGS)
    : [];

  const capital = toPositiveNumber(body.capital, 2500);
  const maxSlots = Math.max(1, Math.round(toPositiveNumber(body.maxSlots, 5)));
  const riskPct = toPositiveNumber(body.riskPct, 1);

  const rawEntry = body.entry;
  const entryOverride =
    rawEntry === "" || rawEntry == null ? null : toPositiveNumber(rawEntry, 0) || null;

  const symbols = Array.from(new Set([ticker, ...holdingTickers]));

  let batch: Map<string, CandleResponse>;
  try {
    batch = await fetchCandlesBatch(symbols, "6mo", "1d");
  } catch (e) {
    return Response.json(
      { ok: false, error: `Price data could not be fetched: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const main = batch.get(ticker);
  if (!main || main.candles.length === 0) {
    return Response.json(
      { ok: false, error: `No daily price history came back for ${ticker}.` },
      { status: 502 },
    );
  }

  const holdings: HoldingInput[] = holdingTickers.map((h) => ({
    ticker: h,
    candles: batch.get(h)?.candles ?? null,
  }));

  // 2y at 1d with a 300-day floor, so SMA200 has the 200 sessions it needs.
  const benchmark = await fetchCandles(BENCHMARK, "2y", "1d", 300)
    .then((r) => (r.candles.length > 0 ? r.candles : null))
    .catch(() => null);

  const result = advise({
    ticker,
    candles: main.candles,
    entryOverride,
    capital,
    maxSlots,
    riskPct,
    holdings,
    benchmark,
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
}
