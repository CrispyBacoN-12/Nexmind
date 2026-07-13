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

// S&P 500 constituents (approximate; membership drifts over time). Dotted class
// shares (BRK.B/BF.B) are omitted to avoid Alpaca/Yahoo symbol-format mismatch —
// unfetchable tickers are simply skipped by the batch fetcher.
const SP500 = [
  "MMM", "AOS", "ABT", "ABBV", "ACN", "ADBE", "AMD", "AES", "AFL", "A", "APD", "ABNB", "AKAM", "ALB", "ARE",
  "ALGN", "ALLE", "LNT", "ALL", "GOOGL", "GOOG", "MO", "AMZN", "AMCR", "AEE", "AEP", "AXP", "AIG", "AMT", "AWK",
  "AMP", "AME", "AMGN", "APH", "ADI", "ANSS", "AON", "APA", "AAPL", "AMAT", "APTV", "ACGL", "ADM", "ANET", "AJG",
  "AIZ", "T", "ATO", "ADSK", "ADP", "AZO", "AVB", "AVY", "AXON", "BKR", "BALL", "BAC", "BAX", "BDX",
  "BBY", "BIO", "TECH", "BIIB", "BLK", "BX", "BK", "BA", "BKNG", "BSX", "BMY", "AVGO", "BR", "BRO", "BLDR",
  "BG", "CDNS", "CZR", "CPT", "CPB", "COF", "CAH", "KMX", "CCL", "CARR", "CAT", "CBOE", "CBRE", "CDW", "CE",
  "COR", "CNC", "CNP", "CF", "CHRW", "CRL", "SCHW", "CHTR", "CVX", "CMG", "CB", "CHD", "CI", "CINF", "CTAS",
  "CSCO", "C", "CFG", "CLX", "CME", "CMS", "KO", "CTSH", "CL", "CMCSA", "CAG", "COP", "ED", "STZ", "CEG",
  "COO", "CPRT", "GLW", "CTVA", "CSGP", "COST", "CTRA", "CCI", "CSX", "CMI", "CVS", "DHR", "DRI", "DVA",
  "DAY", "DECK", "DE", "DAL", "DVN", "DXCM", "FANG", "DLR", "DFS", "DG", "DLTR", "D", "DPZ", "DOV", "DOW",
  "DHI", "DTE", "DUK", "DD", "EMN", "ETN", "EBAY", "ECL", "EIX", "EW", "EA", "ELV", "EMR", "ENPH", "ETR",
  "EOG", "EPAM", "EQT", "EFX", "EQIX", "EQR", "ESS", "EL", "EG", "EVRG", "ES", "EXC", "EXPE", "EXPD", "EXR",
  "XOM", "FFIV", "FDS", "FICO", "FAST", "FRT", "FDX", "FIS", "FITB", "FSLR", "FE", "FI", "FMC", "F", "FTNT",
  "FTV", "FOXA", "FOX", "BEN", "FCX", "GRMN", "IT", "GE", "GEHC", "GEV", "GEN", "GNRC", "GD", "GIS", "GM",
  "GPC", "GILD", "GPN", "GL", "GDDY", "GS", "HAL", "HIG", "HAS", "HCA", "DOC", "HSIC", "HSY", "HES", "HPE",
  "HLT", "HOLX", "HD", "HON", "HRL", "HST", "HWM", "HPQ", "HUBB", "HUM", "HBAN", "HII", "IBM", "IEX", "IDXX",
  "ITW", "ILMN", "INCY", "IR", "PODD", "INTC", "ICE", "IFF", "IP", "IPG", "INTU", "ISRG", "IVZ", "INVH", "IQV",
  "IRM", "JBHT", "JBL", "JKHY", "J", "JNJ", "JCI", "JPM", "JNPR", "K", "KVUE", "KDP", "KEY", "KEYS", "KMB",
  "KIM", "KMI", "KKR", "KLAC", "KHC", "KR", "LHX", "LH", "LRCX", "LW", "LVS", "LDOS", "LEN", "LLY", "LIN",
  "LYV", "LKQ", "LMT", "L", "LOW", "LULU", "LYB", "MTB", "MPC", "MKTX", "MAR", "MMC", "MLM", "MAS", "MA",
  "MTCH", "MKC", "MCD", "MCK", "MDT", "MRK", "META", "MET", "MTD", "MGM", "MCHP", "MU", "MSFT", "MAA", "MRNA",
  "MHK", "MOH", "TAP", "MDLZ", "MPWR", "MNST", "MCO", "MS", "MOS", "MSI", "MSCI", "NDAQ", "NTAP", "NFLX",
  "NEM", "NWSA", "NWS", "NEE", "NKE", "NI", "NDSN", "NSC", "NTRS", "NOC", "NCLH", "NRG", "NUE", "NVDA",
  "NVR", "NXPI", "ORLY", "OXY", "ODFL", "OMC", "ON", "OKE", "ORCL", "OTIS", "PCAR", "PKG", "PANW", "PARA",
  "PH", "PAYX", "PAYC", "PYPL", "PNR", "PEP", "PFE", "PCG", "PM", "PSX", "PNW", "PNC", "POOL", "PPG", "PPL",
  "PFG", "PG", "PGR", "PLD", "PRU", "PEG", "PTC", "PSA", "PHM", "QRVO", "PWR", "QCOM", "DGX", "RL", "RJF",
  "RTX", "O", "REG", "REGN", "RF", "RSG", "RMD", "RVTY", "ROK", "ROL", "ROP", "ROST", "RCL", "SPGI", "CRM",
  "SBAC", "SLB", "STX", "SRE", "NOW", "SHW", "SPG", "SWKS", "SJM", "SNA", "SOLV", "SO", "LUV", "SWK", "SBUX",
  "STT", "STLD", "STE", "SYK", "SMCI", "SYF", "SNPS", "SYY", "TMUS", "TROW", "TTWO", "TPR", "TRGP", "TGT",
  "TEL", "TDY", "TFX", "TER", "TSLA", "TXN", "TXT", "TMO", "TJX", "TSCO", "TT", "TDG", "TRV", "TRMB", "TFC",
  "TYL", "TSN", "USB", "UBER", "UDR", "ULTA", "UNP", "UAL", "UPS", "URI", "UNH", "UHS", "VLO", "VTR", "VLTO",
  "VRSN", "VRSK", "VZ", "VRTX", "VTRS", "VICI", "V", "VST", "VMC", "WAB", "WMT", "DIS", "WBD", "WM", "WAT",
  "WEC", "WFC", "WELL", "WST", "WDC", "WY", "WMB", "WTW", "GWW", "WYNN", "XEL", "XYL", "YUM", "ZBRA", "ZBH", "ZTS",
];

// Depository/commercial + major investment banks — earnings are rate-cycle and
// credit-quality driven rather than the trend/momentum patterns the ATR-ladder
// strategies key off, and the whole group tends to move together on Fed days
// (correlated risk the pooled backtest doesn't account for). Excluded from
// screening on request, not the broader GICS Financials sector (insurers,
// asset managers, exchanges, card networks stay in).
export const BANK_STOCKS = [
  "JPM", "BAC", "WFC", "C", "GS", "MS", "USB", "PNC", "TFC", "COF",
  "BK", "STT", "RF", "HBAN", "KEY", "CFG", "FITB", "MTB", "NTRS", "SCHW",
  "DFS", "SYF",
];

export const UNIVERSES: Record<string, Universe> = {
  "us-mega": { label: "US Mega-cap (12)", symbols: MEGA },
  "dow30": { label: "Dow 30", symbols: DOW30 },
  "nasdaq100": { label: "NASDAQ-100 (~80)", symbols: NASDAQ100 },
  "sp500": { label: "S&P 500 (~500)", symbols: SP500 },
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
