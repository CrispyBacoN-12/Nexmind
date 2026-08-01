// Local sanity check for the newly-ported "Liquidity Sweep + Volume Profile + SMA50"
// strategy (validated on TradingView: 34 trades, 41.18% WR, PF 1.645, +13.12% PnL,
// max DD 7.67%, GC=F Jan 2025-Aug 2026). This runs the SAME entry+exit logic through
// NEXMIND's own backtest engine against its own (free-tier) GC=F feed, as a sanity
// check before trusting it in live/paper — NOT expected to match TradingView exactly,
// since NEXMIND's free feed has patchier volume data than TradingView's real feed.
// Usage: npx tsx scripts/sanity-check-liquidity-sweep-vp-sma50.ts

import { fetchCandles } from "../src/lib/marketData";
import { getStrategy } from "../src/lib/trading/strategies";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const RISK_USD = 100;

async function main() {
  const strat = getStrategy("liquidity-sweep-volume-profile-sma50");
  if (!strat) throw new Error("strategy not registered");
  const exit = strat.preferredExit!;

  const resp = await fetchCandles(SYMBOL, "2y", "1h");
  const bars = resp.candles;
  const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
  console.log(`${SYMBOL} 1h: ${bars.length} bars, ~${days.toFixed(0)} days\n`);

  const entry = strat.build(bars);
  const result = backtestCandles(
    SYMBOL, bars, 0.1, undefined, (i) => entry(i)?.side ?? null,
    exit.singleTarget, exit.tp1Mult, exit.costs, exit.slMult, exit.trail,
  );

  const closed = result.trades;
  const wins = closed.filter((t) => t.outcome === "win").length;
  const winRate = closed.length ? (wins / closed.length) * 100 : 0;
  const grossWin = closed.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(closed.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  const rs = closed.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const totalPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);

  let equity = 0, peak = 0, maxDD = 0;
  for (const r of rs) {
    equity += r * RISK_USD;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  }

  console.log(`signals ${result.signals} · closed trades ${closed.length} (openAtEnd=${result.openAtEnd})`);
  console.log(`win rate    ${winRate.toFixed(2)}%  (${wins}/${closed.length})`);
  console.log(`profit factor ${pf === Infinity ? "inf" : pf.toFixed(3)}`);
  console.log(`total P/L   $${totalPnl.toFixed(2)}  (risk $${RISK_USD}/trade)`);
  console.log(`max DD      $${maxDD.toFixed(2)}`);
  console.log(`\nTradingView reference: 34 trades, 41.18% WR, PF 1.645, +13.12% PnL, max DD 7.67%`);
}

main();
