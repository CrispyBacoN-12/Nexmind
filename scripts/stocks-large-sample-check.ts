// Re-tests the winning candidate ("ADX-Ignition Breakout", now live as
// research-28 on Portfolio 11) across a much larger, more representative
// sp500 sample than the original 10-stock sweep (stocks-sweep-candidates.ts).
// The original 10-stock pooled $661/yr figure was a big underestimate of live
// output since the real desk scans the full ~500-symbol universe, not 10
// names - this checks how the $ scales with a wider, sector-diverse sample.
// Usage: npx tsx scripts/stocks-large-sample-check.ts

import { fetchCandlesBatch } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";
import { UNIVERSES } from "../src/lib/trading/universe";

const RANGE = "2y";
const INTERVAL = "1d";
const RISK_USD = 100; // 1% of $10,000, matches Portfolio 11 live config
const TP1_MULT = 1.2; // production research ladder

// Every ~10th sp500 symbol -> ~50 names spread across sectors, not just mega-caps.
const ALL = UNIVERSES["sp500"].symbols;
const SAMPLE = ALL.filter((_, i) => i % 10 === 0);

const CODE = `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.plusDI == null || s.minusDI == null || s.sma50 == null || s.price == null) return null;
if (p.adx >= 25 || s.adx < 25) return null;
if (s.plusDI > s.minusDI && s.price > s.sma50) return { side: "long", note: "fresh ADX ignition, +DI dominant, above sma50" };
if (s.minusDI > s.plusDI && s.price < s.sma50) return { side: "short", note: "fresh ADX ignition, -DI dominant, below sma50" };
return null;
`;

async function main() {
  console.log(`Sample: ${SAMPLE.length} symbols -> ${SAMPLE.join(", ")}\n`);
  const candleMap = await fetchCandlesBatch(SAMPLE, RANGE, INTERVAL);
  const compiled = compileStrategy(CODE);

  let pooledTrades = 0, pooledWins = 0, pooledAnnPnl = 0;
  let h1AnnPnl = 0, h2AnnPnl = 0, h1Trades = 0, h2Trades = 0, h1Wins = 0, h2Wins = 0;
  let symbolsWithTrades = 0;
  const perSymbol: Array<{ symbol: string; trades: number; win: number; ann: number }> = [];

  for (const symbol of SAMPLE) {
    const resp = candleMap.get(symbol);
    if (!resp || resp.candles.length < 100) { console.log(`${symbol} skipped (no/insufficient data)`); continue; }
    const bars = resp.candles;
    const snaps = computeSnapshots(bars);
    const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
    const yearFactor = 365 / days;

    const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
    const result = backtestCandles(symbol, bars, 0.1, undefined, entry, true, TP1_MULT);
    const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
    const wins = result.trades.filter((t) => t.outcome === "win").length;
    const annPnl = rs.reduce((s, r) => s + r * RISK_USD, 0) * yearFactor;

    pooledTrades += result.trades.length;
    pooledWins += wins;
    pooledAnnPnl += annPnl;
    if (result.trades.length > 0) symbolsWithTrades++;
    perSymbol.push({ symbol, trades: result.trades.length, win: result.trades.length ? (wins / result.trades.length) * 100 : 0, ann: annPnl });

    const mid = Math.floor(bars.length / 2);
    const b1 = bars.slice(0, mid), s1 = snaps.slice(0, mid);
    const b2 = bars.slice(mid), s2 = snaps.slice(mid);
    const e1 = (i: number) => compiled.invoke(b1, s1, i)?.side ?? null;
    const e2 = (i: number) => compiled.invoke(b2, s2, i)?.side ?? null;
    const r1 = backtestCandles(symbol, b1, 0.1, undefined, e1, true, TP1_MULT);
    const r2 = backtestCandles(symbol, b2, 0.1, undefined, e2, true, TP1_MULT);
    const rs1 = r1.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
    const rs2 = r2.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
    const halfYearFactor = 365 / (days / 2);
    h1Trades += r1.trades.length; h1Wins += r1.trades.filter((t) => t.outcome === "win").length;
    h1AnnPnl += rs1.reduce((s, r) => s + r * RISK_USD, 0) * halfYearFactor;
    h2Trades += r2.trades.length; h2Wins += r2.trades.filter((t) => t.outcome === "win").length;
    h2AnnPnl += rs2.reduce((s, r) => s + r * RISK_USD, 0) * halfYearFactor;
  }

  perSymbol.sort((a, b) => b.ann - a.ann);
  console.log("Per-symbol (top 10 by ann $):");
  for (const p of perSymbol.slice(0, 10)) {
    console.log(`  ${p.symbol.padEnd(6)} trades=${String(p.trades).padStart(3)} win%=${p.win.toFixed(1).padStart(5)} ann=$${p.ann.toFixed(0)}`);
  }

  const winRate = pooledTrades ? (pooledWins / pooledTrades) * 100 : 0;
  const win1 = h1Trades ? (h1Wins / h1Trades) * 100 : 0;
  const win2 = h2Trades ? (h2Wins / h2Trades) * 100 : 0;
  const stable = h1AnnPnl > 0 && h2AnnPnl > 0;

  console.log(`\n${SAMPLE.length} symbols sampled, ${symbolsWithTrades} produced >=1 trade`);
  console.log(`Pooled: trades=${pooledTrades} win%=${winRate.toFixed(1)} ann=$${pooledAnnPnl.toFixed(0)}`);
  console.log(`H1: trades=${h1Trades} win%=${win1.toFixed(1)} ann=$${h1AnnPnl.toFixed(0)}`);
  console.log(`H2: trades=${h2Trades} win%=${win2.toFixed(1)} ann=$${h2AnnPnl.toFixed(0)}`);
  console.log(`Stable both halves: ${stable}`);
  console.log(`\nOn a $10,000 account (1% risk/trade = $${RISK_USD}): pooled ann=$${pooledAnnPnl.toFixed(0)} -> ${(pooledAnnPnl / 10000 * 100).toFixed(1)}%/yr`);
}

main();
