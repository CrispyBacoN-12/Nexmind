// Baseline check for US Stocks Desk (#11): does the current "combo-vote"
// strategy actually hold up on daily bars across a representative sp500
// sample, using the same real-$ + split-half robustness bar established for
// Gold/Bitcoin? Portfolio 11 config: 1d/2y bars, universe=sp500, $10,000
// starting balance, 1% risk/trade ($100), maxOpenPositions=15.
// Sample: liquid large-caps spanning sectors (tech, financials, energy,
// healthcare, consumer, industrials) rather than all 500 tickers, for a
// representative-but-tractable first pass.
// Usage: npx tsx scripts/stocks-baseline-check.ts

import { fetchCandles } from "../src/lib/marketData";
import { getStrategy } from "../src/lib/trading/strategies";
import { backtestCandles } from "../src/lib/backtest/engine";

const SAMPLE = ["AAPL", "MSFT", "NVDA", "AMD", "JPM", "XOM", "UNH", "HD", "PG", "CAT"];
const RANGE = "2y";
const INTERVAL = "1d";
const RISK_USD = 100; // 1% of $10,000, matches Portfolio 11
const STRATEGY_KEY = "combo-vote";

function equityStats(rMultiples: number[], riskUsd: number, startBalance: number) {
  let equity = startBalance;
  let peak = startBalance;
  let maxDrawdownPct = 0;
  for (const r of rMultiples) {
    equity += r * riskUsd;
    if (equity > peak) peak = equity;
    const ddPct = ((peak - equity) / peak) * 100;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
  }
  const totalPnl = rMultiples.reduce((s, r) => s + r * riskUsd, 0);
  return { totalPnl, maxDrawdownPct };
}

async function testSymbol(symbol: string) {
  const strat = getStrategy(STRATEGY_KEY)!;
  const resp = await fetchCandles(symbol, RANGE, INTERVAL);
  const bars = resp.candles;
  if (bars.length < 100) {
    console.log(`${symbol.padEnd(6)} too few bars (${bars.length}), skipped`);
    return null;
  }
  const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
  const yearFactor = 365 / days;
  const evalr = strat.build(bars);
  const entry = (i: number) => evalr(i)?.side ?? null;
  const result = backtestCandles(symbol, bars, 0.1, undefined, entry); // default tp1Mult=2.5, two-target ladder — matches live combo-vote

  const mid = Math.floor(bars.length / 2);
  const rsFull = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const wins = result.trades.filter((t) => t.outcome === "win").length;
  const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;

  // Split-half: re-run strategy standalone on each half so indicators warm up cleanly.
  const h1Bars = bars.slice(0, mid);
  const h2Bars = bars.slice(mid);
  const ev1 = strat.build(h1Bars);
  const ev2 = strat.build(h2Bars);
  const r1 = backtestCandles(symbol, h1Bars, 0.1, undefined, (i) => ev1(i)?.side ?? null);
  const r2 = backtestCandles(symbol, h2Bars, 0.1, undefined, (i) => ev2(i)?.side ?? null);
  const rs1 = r1.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const rs2 = r2.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const win1 = r1.trades.length ? (r1.trades.filter((t) => t.outcome === "win").length / r1.trades.length) * 100 : 0;
  const win2 = r2.trades.length ? (r2.trades.filter((t) => t.outcome === "win").length / r2.trades.length) * 100 : 0;

  const eqFull = equityStats(rsFull, RISK_USD, 10000);
  const eq1 = equityStats(rs1, RISK_USD, 10000);
  const eq2 = equityStats(rs2, RISK_USD, 10000);
  const annFull = eqFull.totalPnl * yearFactor;
  const ann1 = eq1.totalPnl * (365 / (days / 2));
  const ann2 = eq2.totalPnl * (365 / (days / 2));

  console.log(
    `${symbol.padEnd(6)} trades=${String(result.trades.length).padStart(3)} win%=${winRate.toFixed(1).padStart(5)} ann=$${annFull.toFixed(0).padStart(6)}  ` +
    `H1[trades=${rs1.length} win%=${win1.toFixed(1)} ann=$${ann1.toFixed(0)}]  H2[trades=${rs2.length} win%=${win2.toFixed(1)} ann=$${ann2.toFixed(0)}]  ` +
    `${ann1 > 0 && ann2 > 0 ? "STABLE+" : "unstable"}`
  );
  return { symbol, trades: result.trades.length, winRate, annFull, ann1, ann2, stable: ann1 > 0 && ann2 > 0 };
}

async function main() {
  console.log(`US Stocks Desk baseline: ${STRATEGY_KEY} on ${SAMPLE.length} sp500 sample stocks, ${INTERVAL}/${RANGE}\n`);
  const results = [];
  for (const s of SAMPLE) {
    const r = await testSymbol(s);
    if (r) results.push(r);
  }
  const totalTrades = results.reduce((s, r) => s + r.trades, 0);
  const avgWinRate = results.reduce((s, r) => s + r.winRate * r.trades, 0) / (totalTrades || 1);
  const avgAnnPerSymbol = results.reduce((s, r) => s + r.annFull, 0) / results.length;
  const stableCount = results.filter((r) => r.stable).length;
  console.log(`\n=== Aggregate across ${results.length} symbols ===`);
  console.log(`Total trades: ${totalTrades}, weighted avg win%: ${avgWinRate.toFixed(1)}, avg ann P/L per symbol: $${avgAnnPerSymbol.toFixed(0)}`);
  console.log(`Symbols stable both halves: ${stableCount}/${results.length}`);
}

main();
