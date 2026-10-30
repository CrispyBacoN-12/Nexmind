// The last trade price, for /advisor's fill guard. Finnhub /quote, free tier,
// verified live on 2026-10-30: `c` is the last price and `t` its epoch-second
// stamp, 0.3 min old during the session.
//
// Read by the advisory tool only. A quote is never research data and nothing
// sizes off it: src/lib/advisor/fillGuard.ts reports what it does to the card.

import type { LiveQuote } from "@/lib/advisor/types";

/** Never throws and never returns a bare null — the reason travels with the miss. */
export async function fetchLiveQuote(symbol: string): Promise<LiveQuote> {
  const none = (note: string): LiveQuote => ({ price: null, at: null, note });
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return none("FINNHUB_API_KEY not set");
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`);
    if (!res.ok) return none(`Finnhub HTTP ${res.status}`);
    const j = (await res.json()) as { c?: number; t?: number };
    // Finnhub answers an unknown symbol with zeros rather than an error.
    if (typeof j.c !== "number" || j.c <= 0 || typeof j.t !== "number" || j.t <= 0) {
      return none("Finnhub returned no price for this symbol");
    }
    return { price: j.c, at: j.t };
  } catch (e) {
    return none(`quote fetch failed: ${String(e).slice(0, 80)}`);
  }
}
