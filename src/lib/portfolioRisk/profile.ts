// One Finnhub profile2 call per symbol: stock (with its industry) or ETF.
// Finnhub answers an ETF with HTTP 200 and an empty object (verified on two
// real ETFs 2026-11-25). Any failure is `kind: null` (unknown, retried later),
// never "etf", so a rate-limited stock is not mislabelled and its earnings
// are not skipped.

import type { HoldingKind } from "./risk";

export async function fetchProfileKind(
  symbol: string,
  opts: { fetchImpl?: typeof fetch; env?: { FINNHUB_API_KEY?: string } } = {},
): Promise<{ kind: HoldingKind; industry: string | null; note: string | null }> {
  const key = (opts.env ?? process.env).FINNHUB_API_KEY;
  const doFetch = opts.fetchImpl ?? fetch;
  const unknown = (note: string) => ({ kind: null, industry: null, note });
  if (!key) return unknown("FINNHUB_API_KEY not set");
  try {
    const res = await doFetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${key}`);
    if (!res.ok) return unknown(`Finnhub HTTP ${res.status}`);
    const body = (await res.json()) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return unknown("Finnhub returned no profile");
    if (Object.keys(body).length === 0) return { kind: "etf", industry: null, note: null };
    const industry = typeof body.finnhubIndustry === "string" && body.finnhubIndustry !== "" ? body.finnhubIndustry : null;
    return { kind: "stock", industry, note: null };
  } catch (e) {
    return unknown(`profile fetch failed: ${String(e).split(key).join("***").slice(0, 80)}`);
  }
}
