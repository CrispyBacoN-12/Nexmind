// Predefined US-market universes + dynamic discovery, so the desk can scan
// symbols you never typed in — effectively "scan the market" within a known set.

export interface Universe { label: string; symbols: string[] }

const DOW30 = [
  "AAPL", "AMGN", "AXP", "BA", "CAT", "CRM", "CSCO", "CVX", "DIS", "GS",
  "HD", "HON", "IBM", "JNJ", "JPM", "KO", "MCD", "MMM", "MRK", "MSFT",
  "NKE", "PG", "TRV", "UNH", "V", "VZ", "WMT", "DOW", "INTC", "WBA",
];

const NASDAQ100 = [
  "AAPL", "MSFT", "NVDA", "AMZN", "AVGO", "META", "TSLA", "GOOGL", "GOOG", "COST",
  "NFLX", "TMUS", "CSCO", "PEP", "ADBE", "LIN", "AMD", "INTC", "TXN", "QCOM",
  "AMGN", "INTU", "AMAT", "HON", "ISRG", "BKNG", "VRTX", "ADP", "REGN", "SBUX",
  "GILD", "MDLZ", "ADI", "PANW", "LRCX", "MU", "KLAC", "SNPS", "CDNS", "MELI",
  "MAR", "PYPL", "ABNB", "ORLY", "CRWD", "FTNT", "NXPI", "ASML", "CTAS", "MRVL",
  "CEG", "ROP", "MNST", "WDAY", "AEP", "PCAR", "DXCM", "KDP", "CPRT", "PAYX",
  "ROST", "ODFL", "FAST", "EA", "VRSK", "EXC", "CTSH", "TTD", "DDOG", "TEAM",
  "ON", "BIIB", "ZS", "ANSS", "GEHC", "CSGP", "XEL", "IDXX", "WBD", "ILMN",
];

const MEGA = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "BRK-B", "JPM", "V", "WMT"];

export const UNIVERSES: Record<string, Universe> = {
  "us-mega": { label: "US Mega-cap (12)", symbols: MEGA },
  "dow30": { label: "Dow 30", symbols: DOW30 },
  "nasdaq100": { label: "NASDAQ-100 (~80)", symbols: NASDAQ100 },
};

/**
 * Discover symbols the market is moving today (we didn't pick these). Uses
 * Yahoo's unofficial trending endpoint — best-effort; returns [] on failure.
 */
export async function discoverActive(count = 20): Promise<string[]> {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v1/finance/trending/US?count=${count}`, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const quotes = json?.finance?.result?.[0]?.quotes ?? [];
    return quotes.map((q: { symbol: string }) => q.symbol).filter(Boolean);
  } catch {
    return [];
  }
}

/** Dedupe + uppercase + cap a symbol list. */
export function prepareSymbols(symbols: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of symbols) {
    const sym = s.trim().toUpperCase();
    if (sym && !seen.has(sym)) { seen.add(sym); out.push(sym); }
    if (out.length >= max) break;
  }
  return out;
}
