// Shapes for the cross-sectional (rank-the-universe) backtester. No logic here.
import type { CostModel } from "@/lib/backtest/engine"; // type-only: engine.ts pulls in Prisma at runtime

/** How "how far has it fallen" is measured. */
export type FallMeasure = "atrReturn" | "rsi2";

/** Market-wide on/off switch for opening new positions. */
export type RegimeMode = "off" | "spySma200" | "spySlope";

export interface CsConfig {
  /** Lookback in bars for the fall measure (ignored when measure is "rsi2"). */
  lookback: number;
  measure: FallMeasure;
  /**
   * A candidate must score at or below this to be entered at all. Ranking alone
   * is not enough: in a market where nothing has fallen, the top-ranked name is
   * merely the least-rising stock, which is not a mean-reversion setup. 0 for
   * "atrReturn" (the price must actually be down over K days); ~10 for "rsi2".
   * null disables the gate and reverts to pure ranking.
   */
  maxRankScore: number | null;
  /** Minimum close price on the signal bar. */
  minPrice: number;
  /** Minimum 20-day average dollar volume (close * volume) on the signal bar. */
  minDollarVol: number;
  /** Require the signal-bar close to sit above the symbol's own SMA200. */
  requireAboveSma200: boolean;
  regime: RegimeMode;
  /** Drop symbols whose largest close-to-close move in the trailing 20 bars exceeds this %. null = off. */
  maxSingleDayMovePct: number | null;
  /** Concurrent position slots. */
  slots: number;
  /** Bars to hold before the scheduled exit. */
  holdDays: number;
  /** Also exit early when the close crosses back above SMA5. */
  exitOnSma5: boolean;
  /** ATR multiple for the protective stop. null = no stop. */
  stopAtrMult: number | null;
  costs: CostModel;
  /** Starting equity. */
  capital: number;
  /** Symbol supplying the regime input; excluded from the tradable set. */
  regimeSymbol: string;
}

export type ExitReason = "hold-expiry" | "stop" | "sma5" | "end-of-data";

export interface CsTrade {
  symbol: string;
  entryT: number; // epoch seconds of the bar the fill happened on
  exitT: number;
  entry: number; // fill price, cost-adjusted
  exit: number; // fill price, cost-adjusted
  shares: number; // fractional shares are allowed
  grossPnl: number;
  pnl: number; // net of slippage + commission
  retPct: number; // pnl as a % of the capital allocated to this position
  /** pnl / risk-per-share*shares. null when stopAtrMult is null (no defined risk unit). */
  rMultiple: number | null;
  reason: ExitReason;
  daysHeld: number;
}

export interface EquityPoint {
  t: number; // epoch seconds of the trading day
  equity: number; // cash + marked-to-market open positions
  positions: number; // open position count that day
}

export interface CsSummary {
  trades: number;
  wins: number;
  winRate: number; // %
  totalPnl: number;
  profitFactor: number | null; // null when there are no losing trades
  avgR: number | null; // null when the config has no stop
  avgRetPct: number | null;
  cagrPct: number | null;
  maxDrawdownPct: number | null; // positive magnitude
  timeInMarketPct: number; // % of trading days with at least one open position
  tradingDays: number;
}

export interface CsResult {
  trades: CsTrade[];
  equityCurve: EquityPoint[];
  summary: CsSummary;
}
