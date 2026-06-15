// Shared company fundamentals (Finnhub free tier; US listings) — used by both
// long-term investing analysis and short-term symbol analysis.

export interface Fundamentals {
  name: string | null;
  industry: string | null;
  marketCapM: number | null; // millions USD (Finnhub convention)
  peTTM: number | null;
  pb: number | null;
  roePct: number | null;
  netMarginPct: number | null;
  revenueGrowthPct: number | null;
  epsGrowthPct: number | null;
  debtToEquity: number | null;
  dividendYieldPct: number | null;
  note?: string; // why fundamentals are missing, when they are
}

export const NON_EQUITY = /=[FX]$|-USD$|^\^/; // futures (GC=F), forex (EURUSD=X), crypto (BTC-USD), indices (^GSPC)

const fmt = (n: number | null, d = 1) => (n == null ? "n/a" : n.toFixed(d));

/** One-line summary of fundamentals (or why they're missing), for AI prompts. */
export function fundamentalsLine(f: Fundamentals, symbol: string): string {
  return f.note
    ? `Fundamentals: ${f.note}`
    : `Fundamentals: ${f.name ?? symbol} (${f.industry ?? "?"}) · mktcap $${fmt(f.marketCapM, 0)}M · ` +
      `P/E ${fmt(f.peTTM)} · P/B ${fmt(f.pb)} · ROE ${fmt(f.roePct)}% · net margin ${fmt(f.netMarginPct)}% · ` +
      `rev growth ${fmt(f.revenueGrowthPct)}% · EPS growth ${fmt(f.epsGrowthPct)}% · D/E ${fmt(f.debtToEquity, 2)} · div yield ${fmt(f.dividendYieldPct)}%`;
}

export async function fetchFundamentals(symbol: string): Promise<Fundamentals> {
  const empty: Fundamentals = {
    name: null, industry: null, marketCapM: null, peTTM: null, pb: null, roePct: null,
    netMarginPct: null, revenueGrowthPct: null, epsGrowthPct: null, debtToEquity: null, dividendYieldPct: null,
  };
  if (NON_EQUITY.test(symbol)) return { ...empty, note: "not a single stock — judged on price history alone" };
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return { ...empty, note: "FINNHUB_API_KEY not set" };

  try {
    const [profileRes, metricRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${key}`),
      fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${key}`),
    ]);
    if (!profileRes.ok || !metricRes.ok) return { ...empty, note: `Finnhub HTTP ${profileRes.status}/${metricRes.status}` };

    const profile = (await profileRes.json()) as { name?: string; finnhubIndustry?: string; marketCapitalization?: number };
    const metric = ((await metricRes.json()) as { metric?: Record<string, number> }).metric ?? {};
    if (!profile.name && Object.keys(metric).length === 0) {
      return { ...empty, note: "no fundamentals on Finnhub (non-US listing?) — judged on price history alone" };
    }

    const pick = (...keys: string[]) => {
      for (const k of keys) {
        const v = metric[k];
        if (typeof v === "number" && Number.isFinite(v)) return v;
      }
      return null;
    };

    return {
      name: profile.name ?? null,
      industry: profile.finnhubIndustry ?? null,
      marketCapM: profile.marketCapitalization ?? null,
      peTTM: pick("peTTM", "peAnnual"),
      pb: pick("pbAnnual", "pb"),
      roePct: pick("roeTTM", "roeAnnual"),
      netMarginPct: pick("netProfitMarginTTM", "netProfitMarginAnnual"),
      revenueGrowthPct: pick("revenueGrowthTTMYoy", "revenueGrowth3Y"),
      epsGrowthPct: pick("epsGrowthTTMYoy", "epsGrowth3Y"),
      debtToEquity: pick("totalDebt/totalEquityAnnual", "totalDebt/totalEquityQuarterly"),
      dividendYieldPct: pick("dividendYieldIndicatedAnnual", "currentDividendYieldTTM"),
    };
  } catch (e) {
    return { ...empty, note: `fundamentals fetch failed: ${String(e).slice(0, 80)}` };
  }
}
