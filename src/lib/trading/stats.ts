// Performance math for reports — pure functions over closed trades.

export interface ClosedTrade { pnl: number; rMultiple: number | null; outcome: string | null; closedAt: Date | null }

export interface PerfStats {
  trades: number;
  wins: number;
  winRate: number; // %
  pnl: number;
  expectancy: number; // avg pnl per trade
  maxDrawdown: number; // largest peak-to-trough on the equity curve (USD)
  maxDrawdownPct: number | null; // largest peak-to-trough as % of starting balance
  avgR: number | null;
  sharpeRatio: number | null; // annualized, based on daily P/L
  sortinoRatio: number | null; // annualized, based on daily P/L
}

const ANNUAL_TRADING_DAYS = 252;

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stdDev(xs: number[], avg: number): number {
  return Math.sqrt(mean(xs.map((x) => (x - avg) ** 2)));
}

/** Sum pnl per closed-trade day, in chronological order. */
function dailyPnls(ordered: ClosedTrade[]): number[] {
  const byDay = new Map<string, number>();
  for (const t of ordered) {
    if (!t.closedAt) continue;
    const key = t.closedAt.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + (t.pnl ?? 0));
  }
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, pnl]) => pnl);
}

/** Annualized Sharpe ratio from daily P/L. Null if too little data or no variance. */
function sharpeRatio(daily: number[]): number | null {
  if (daily.length < 2) return null;
  const avg = mean(daily);
  const std = stdDev(daily, avg);
  if (std <= 1e-12) return null;
  return Math.sqrt(ANNUAL_TRADING_DAYS) * (avg / std);
}

/** Annualized Sortino ratio from daily P/L (downside deviation only). Null if too little data or no downside. */
function sortinoRatio(daily: number[]): number | null {
  if (daily.length < 2) return null;
  const avg = mean(daily);
  const downsideDev = Math.sqrt(mean(daily.map((d) => Math.min(d, 0) ** 2)));
  if (downsideDev <= 1e-12) return null;
  return Math.sqrt(ANNUAL_TRADING_DAYS) * (avg / downsideDev);
}

export function computeStats(closed: ClosedTrade[], startingBalance = 10000): PerfStats {
  const trades = closed.length;
  if (trades === 0) {
    return {
      trades: 0, wins: 0, winRate: 0, pnl: 0, expectancy: 0,
      maxDrawdown: 0, maxDrawdownPct: null, avgR: null,
      sharpeRatio: null, sortinoRatio: null,
    };
  }

  const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
  const pnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const expectancy = pnl / trades;

  // Equity curve in chronological order for drawdown.
  const ordered = [...closed].sort((a, b) => (a.closedAt?.getTime() ?? 0) - (b.closedAt?.getTime() ?? 0));
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  for (const t of ordered) {
    equity += t.pnl ?? 0;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  }
  const maxDrawdownPct = startingBalance <= 0 ? null : maxDD === 0 ? 0 : -(maxDD / startingBalance) * 100;

  const rs = closed.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const avgR = rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null;

  const daily = dailyPnls(ordered);

  return {
    trades, wins, winRate: (wins / trades) * 100, pnl, expectancy,
    maxDrawdown: maxDD, maxDrawdownPct, avgR,
    sharpeRatio: sharpeRatio(daily), sortinoRatio: sortinoRatio(daily),
  };
}
