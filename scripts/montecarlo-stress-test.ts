// Applies the new Monte Carlo module (src/lib/backtest/montecarlo.ts) to
// every currently-live/approved desk, using each desk's REAL config
// (startingBalance, riskPctPerTrade, drawdownHaltPct) so the stress-test
// answers a concrete question per desk: "given the historical trade outcomes
// this strategy actually produced, how often would a bad-luck ordering (or a
// different-but-similar sample of future trades) have tripped THIS desk's
// own circuit breaker?"
// Usage: npx tsx scripts/montecarlo-stress-test.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";
import { monteCarloShuffle, monteCarloBootstrap } from "../src/lib/backtest/montecarlo";

const TP1_MULT = 1.2;
const MC_ITERATIONS = 3000;

interface DeskSpec {
  portfolioLabel: string;
  strategyLabel: string;
  code: string;
  symbols: string[];
  interval: "1h" | "1wk";
  range: "2y" | "5y";
  startingBalance: number;
  riskPctPerTrade: number;
  drawdownHaltPct: number;
}

const DESKS: DeskSpec[] = [
  {
    portfolioLabel: "#8 Gold Desk",
    strategyLabel: "research-31 MACD Hist Flip",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.macdHist == null || p.macdHist == null || s.sma20 == null || s.sma50 == null) return null;
if (p.macdHist <= 0 && s.macdHist > 0 && s.sma20 > s.sma50) return { side: "long" };
if (p.macdHist >= 0 && s.macdHist < 0 && s.sma20 < s.sma50) return { side: "short" };
return null;
`,
    symbols: ["GC=F"],
    interval: "1h",
    range: "2y",
    startingBalance: 10000,
    riskPctPerTrade: 1,
    drawdownHaltPct: 10,
  },
  {
    portfolioLabel: "#13 Gold Trend Desk",
    strategyLabel: "research-30 DI-Dominance Widening",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 20) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short" };
return null;
`,
    symbols: ["GC=F"],
    interval: "1h",
    range: "2y",
    startingBalance: 10000,
    riskPctPerTrade: 1,
    drawdownHaltPct: 10,
  },
  {
    portfolioLabel: "#9 Bitcoin Desk",
    strategyLabel: "research-27 RSI-50 Momentum Cross",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.rsi == null || p.rsi == null || s.sma50 == null || s.price == null) return null;
if (s.adx < 20) return null;
if (p.rsi <= 50 && s.rsi > 50 && s.price > s.sma50) return { side: "long" };
if (p.rsi >= 50 && s.rsi < 50 && s.price < s.sma50) return { side: "short" };
return null;
`,
    symbols: ["BTC-USD", "BNB-USD"],
    interval: "1h",
    range: "2y",
    startingBalance: 10000,
    riskPctPerTrade: 2,
    drawdownHaltPct: 25,
  },
  {
    portfolioLabel: "#11 US Stocks Desk",
    strategyLabel: "research-29 Weekly RSI-50 Momentum Cross",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.rsi == null || p.rsi == null || s.sma50 == null || s.price == null) return null;
if (s.adx < 20) return null;
if (p.rsi <= 50 && s.rsi > 50 && s.price > s.sma50) return { side: "long" };
if (p.rsi >= 50 && s.rsi < 50 && s.price < s.sma50) return { side: "short" };
return null;
`,
    symbols: ["AAPL", "AMD", "MSFT", "NVDA"],
    interval: "1wk",
    range: "5y",
    startingBalance: 10000,
    riskPctPerTrade: 1,
    drawdownHaltPct: 10,
  },
];

function fmtPct(x: McPct) {
  return `p5=${x.p5.toFixed(1)} p50=${x.p50.toFixed(1)} p95=${x.p95.toFixed(1)} worst=${x.worst.toFixed(1)}`;
}
type McPct = { p5: number; p25: number; p50: number; p75: number; p95: number; worst: number };

async function main() {
  for (const desk of DESKS) {
    const compiled = compileStrategy(desk.code);
    const allR: number[] = [];
    let totalTrades = 0;

    for (const symbol of desk.symbols) {
      let resp;
      try {
        resp = await fetchCandles(symbol, desk.range, desk.interval);
      } catch (e) {
        console.log(`  [${symbol}] fetch failed: ${e}`);
        continue;
      }
      const bars = resp.candles;
      const snaps = computeSnapshots(bars);
      const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
      const result = backtestCandles(symbol, bars, 0.1, undefined, entry, true, TP1_MULT);
      const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
      allR.push(...rs);
      totalTrades += result.trades.length;
    }

    console.log(`\n=== ${desk.portfolioLabel} (${desk.strategyLabel}) ===`);
    console.log(`Historical sample: ${totalTrades} trades across ${desk.symbols.join(", ")}`);
    console.log(`Live config: startingBalance=$${desk.startingBalance} riskPctPerTrade=${desk.riskPctPerTrade}% drawdownHaltPct=${desk.drawdownHaltPct}%`);

    if (allR.length < 20) {
      console.log(`  Too few trades (${allR.length}) for a meaningful Monte Carlo run - skipping.`);
      continue;
    }

    const cfg = { startingBalance: desk.startingBalance, riskPctPerTrade: desk.riskPctPerTrade, iterations: MC_ITERATIONS };
    const shuffle = monteCarloShuffle(allR, cfg);
    const bootstrap = monteCarloBootstrap(allR, cfg);

    console.log(`\n  SHUFFLE (${MC_ITERATIONS} reorderings of the same ${allR.length} trades):`);
    console.log(`    Max Drawdown %:      ${fmtPct(shuffle.maxDrawdownPct)}`);
    console.log(`    Final Return %:      ${fmtPct(shuffle.finalReturnPct)}`);
    console.log(`    Longest Losing Streak: ${fmtPct(shuffle.longestLosingStreak)}`);
    console.log(`    P(breach ${desk.drawdownHaltPct}% halt): ${(shuffle.probBreach(desk.drawdownHaltPct) * 100).toFixed(1)}%`);

    console.log(`\n  BOOTSTRAP (${MC_ITERATIONS} resamples w/ replacement, ${allR.length} trades each):`);
    console.log(`    Max Drawdown %:      ${fmtPct(bootstrap.maxDrawdownPct)}`);
    console.log(`    Final Return %:      ${fmtPct(bootstrap.finalReturnPct)}`);
    console.log(`    Longest Losing Streak: ${fmtPct(bootstrap.longestLosingStreak)}`);
    console.log(`    P(breach ${desk.drawdownHaltPct}% halt): ${(bootstrap.probBreach(desk.drawdownHaltPct) * 100).toFixed(1)}%`);
  }
}

main();
