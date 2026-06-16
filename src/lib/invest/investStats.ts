// Pure mark-to-market valuation of an invest portfolio. No DB/network — the
// caller supplies the holdings, a price lookup, and the cash balance.

export interface InvestHolding {
  symbol: string;
  shares: number;
  avgCost: number;
  status: string;      // "held" | "sold"
  realizedPnl: number;
}

export interface InvestStats {
  cash: number;
  marketValue: number;      // Σ held shares × price (cost basis when price missing)
  equity: number;           // cash + marketValue
  unrealizedPnl: number;    // marketValue − cost basis of held positions
  realizedPnl: number;      // Σ realizedPnl over all holdings
  missingPrices: string[];  // held symbols with no available price
}

export function computeInvestStats(
  holdings: InvestHolding[],
  priceOf: (symbol: string) => number | null,
  cash: number,
): InvestStats {
  const held = holdings.filter((h) => h.status === "held");
  const missingPrices: string[] = [];
  let marketValue = 0;
  let costBasis = 0;
  for (const h of held) {
    const px = priceOf(h.symbol);
    if (px == null) missingPrices.push(h.symbol);
    const valuePx = px ?? h.avgCost; // fall back to cost basis, never zero
    marketValue += h.shares * valuePx;
    costBasis += h.shares * h.avgCost;
  }
  const realizedPnl = holdings.reduce((sum, h) => sum + (h.realizedPnl ?? 0), 0);
  return {
    cash,
    marketValue,
    equity: cash + marketValue,
    unrealizedPnl: marketValue - costBasis,
    realizedPnl,
    missingPrices,
  };
}
