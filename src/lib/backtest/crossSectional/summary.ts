// Headline metrics for a cross-sectional run. Unlike the single-symbol engine's
// summary, these are computed from a real daily equity curve, which is what
// makes max drawdown, CAGR, and time-in-market meaningful. Time-in-market is
// reported because a regime filter that sits flat most of the year changes what
// the strategy is, and a profit factor alone hides that.
import type { CsSummary, CsTrade, EquityPoint } from "./types";

const TRADING_DAYS_PER_YEAR = 252;

export function summarizeCrossSectional(
  trades: CsTrade[],
  equityCurve: EquityPoint[],
  capital: number,
): CsSummary {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl > 0).length;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);

  const grossWin = trades.reduce((s, t) => s + Math.max(t.pnl, 0), 0);
  const grossLoss = trades.reduce((s, t) => s + Math.max(-t.pnl, 0), 0);

  const rs = trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const rets = trades.map((t) => t.retPct);

  let maxDrawdownPct: number | null = null;
  let cagrPct: number | null = null;
  if (equityCurve.length) {
    let peak = equityCurve[0].equity;
    let worst = 0;
    for (const p of equityCurve) {
      if (p.equity > peak) peak = p.equity;
      if (peak > 0) worst = Math.max(worst, ((peak - p.equity) / peak) * 100);
    }
    maxDrawdownPct = worst;

    const finalEquity = equityCurve[equityCurve.length - 1].equity;
    const years = equityCurve.length / TRADING_DAYS_PER_YEAR;
    if (years > 0 && capital > 0 && finalEquity > 0) {
      cagrPct = (Math.pow(finalEquity / capital, 1 / years) - 1) * 100;
    }
  }

  const daysInMarket = equityCurve.filter((p) => p.positions > 0).length;

  return {
    trades: n,
    wins,
    winRate: n ? (wins / n) * 100 : 0,
    totalPnl,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null,
    avgRetPct: rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : null,
    cagrPct,
    maxDrawdownPct,
    timeInMarketPct: equityCurve.length ? (daysInMarket / equityCurve.length) * 100 : 0,
    tradingDays: equityCurve.length,
  };
}
