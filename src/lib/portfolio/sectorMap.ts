// finnhubIndustry -> the 11 GICS sectors. Pure lookup.
//
// The KEYS are what Finnhub's profile2 endpoint actually returns, not GICS
// industry names: Finnhub has no "Software", "IT Services" or "Technology
// Hardware" — AAPL, MSFT, ORCL, CRM, ACN and DELL all come back as plain
// "Technology". Every key below was either observed on a 124-symbol S&P probe
// (2026-09-27) or is a Finnhub value the probe did not happen to hit; the
// latter are marked. A value missing from this table resolves to "Other",
// which the SECTOR gate treats as unknown, never as a sector of its own.
//
// Mapping to the 11 sectors (not the raw ~45 Finnhub values) is the point: a
// 2-per-sector cap on raw values would let 2 Semiconductors + 3 Technology
// through, which is five names in one GICS sector.

export const GICS_SECTORS = [
  "Information Technology",
  "Communication Services",
  "Health Care",
  "Financials",
  "Consumer Discretionary",
  "Consumer Staples",
  "Industrials",
  "Energy",
  "Utilities",
  "Materials",
  "Real Estate",
] as const;

export type GicsSector = (typeof GICS_SECTORS)[number];
export type ResolvedSector = GicsSector | "Other";

export const FINNHUB_TO_GICS: Readonly<Record<string, GicsSector>> = {
  // Information Technology
  Technology: "Information Technology", // AAPL MSFT ORCL CRM ADBE IBM ACN DELL HPQ ROP
  Semiconductors: "Information Technology", // NVDA AMD INTC TXN QCOM MU AVGO
  Communications: "Information Technology", // CSCO (network equipment, GICS IT)

  // Communication Services
  Media: "Communication Services", // GOOGL META NFLX DIS EA
  Telecommunication: "Communication Services", // CMCSA T VZ TMUS

  // Health Care
  "Health Care": "Health Care", // UNH CVS MDT ABT ISRG HCA
  Pharmaceuticals: "Health Care", // JNJ PFE MRK LLY
  Biotechnology: "Health Care", // ABBV AMGN GILD
  "Life Sciences Tools & Services": "Health Care", // TMO

  // Financials
  Banking: "Financials", // JPM BAC WFC C
  "Financial Services": "Financials", // GS MS BLK AXP COF SCHW V MA SPGI BRK.B
  Insurance: "Financials", // AIG PGR MET

  // Consumer Discretionary
  Retail: "Consumer Discretionary", // AMZN HD LOW TJX — WMT/COST are overridden below
  Automobiles: "Consumer Discretionary", // TSLA GM F
  "Hotels, Restaurants & Leisure": "Consumer Discretionary", // MCD SBUX BKNG MAR
  "Textiles, Apparel & Luxury Goods": "Consumer Discretionary", // NKE
  "Auto Components": "Consumer Discretionary", // not observed
  "Diversified Consumer Services": "Consumer Discretionary", // not observed
  "Leisure Products": "Consumer Discretionary", // not observed
  Distributors: "Consumer Discretionary", // not observed

  // Consumer Staples
  Beverages: "Consumer Staples", // KO PEP
  "Food Products": "Consumer Staples", // MDLZ KHC
  Tobacco: "Consumer Staples", // PM MO
  "Consumer products": "Consumer Staples", // PG CL (Finnhub's own lower-case p)

  // Industrials
  "Aerospace & Defense": "Industrials", // BA LMT RTX GE
  "Electrical Equipment": "Industrials", // EMR
  Machinery: "Industrials", // CAT DE
  "Industrial Conglomerates": "Industrials", // HON MMM
  "Logistics & Transportation": "Industrials", // UPS FDX
  "Road & Rail": "Industrials", // UNP CSX
  Airlines: "Industrials", // DAL
  "Commercial Services & Supplies": "Industrials", // WM
  "Professional Services": "Industrials", // ADP PAYX
  Building: "Industrials", // not observed
  Marine: "Industrials", // not observed
  "Trading Companies & Distributors": "Industrials", // not observed
  "Transportation Infrastructure": "Industrials", // not observed

  // Energy, Utilities
  Energy: "Energy", // XOM CVX COP SLB EOG OXY
  Utilities: "Utilities", // NEE DUK SO D AEP

  // Materials
  Chemicals: "Materials", // LIN APD SHW DD ECL DOW
  "Metals & Mining": "Materials", // NEM FCX NUE
  Packaging: "Materials", // IP BALL
  Construction: "Materials", // VMC (aggregates). Imprecise if Finnhub also files builders here.
  "Paper & Forest": "Materials", // not observed

  // Real Estate
  "Real Estate": "Real Estate", // PLD AMT SPG O EQIX PSA CCI
};

/**
 * Finnhub's "Retail" spans both consumer sectors. GICS puts food and staples
 * retailers in Consumer Staples; everything else in Retail stays Discretionary.
 * Symbol-level, because the industry string alone cannot separate them.
 */
export const SYMBOL_SECTOR_OVERRIDES: Readonly<Record<string, GicsSector>> = {
  WMT: "Consumer Staples",
  COST: "Consumer Staples",
  KR: "Consumer Staples",
  TGT: "Consumer Staples",
  DG: "Consumer Staples",
  DLTR: "Consumer Staples",
  BJ: "Consumer Staples",
};

/** The GICS sector for a symbol, or "Other" when Finnhub's industry is missing or unmapped. */
export function resolveGicsSector(symbol: string, finnhubIndustry: string | null | undefined): ResolvedSector {
  const override = SYMBOL_SECTOR_OVERRIDES[symbol.trim().toUpperCase()];
  if (override) return override;
  if (finnhubIndustry == null) return "Other";
  return FINNHUB_TO_GICS[finnhubIndustry.trim()] ?? "Other";
}
