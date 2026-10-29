// The /journal page's view of Risk Sentry's stop check: the same stopWatch()
// run against the open journal positions, on demand instead of once a day.
// Read-only and fail-soft — a ticker whose candles cannot be fetched is listed
// as unchecked rather than silently passing.

import { fetchCandlesBatch } from "@/lib/marketData";
import { getJournalOpenPositions } from "@/lib/riskSentry/holdings";
import { stopWatch } from "@/lib/riskSentry/stopWatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const positions = (await getJournalOpenPositions()).map((p) => ({ ticker: p.ticker.toUpperCase(), stop: p.stop }));
    if (positions.length === 0) return Response.json({ ok: true, hits: [], unchecked: [], lastBar: null });

    const tickers = Array.from(new Set(positions.map((p) => p.ticker)));
    const batch = await fetchCandlesBatch(tickers, "1mo", "1d");
    const candles = new Map(tickers.map((t) => [t, batch.get(t)?.candles ?? null]));

    const unchecked = tickers.filter((t) => !candles.get(t)?.length);
    const lastBars = tickers.flatMap((t) => {
      const c = candles.get(t);
      return c && c.length > 0 ? [new Date(c[c.length - 1].t * 1000).toISOString().slice(0, 10)] : [];
    });

    return Response.json({
      ok: true,
      hits: stopWatch(positions, candles),
      unchecked,
      lastBar: lastBars.length > 0 ? lastBars.sort().at(-1) : null,
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
