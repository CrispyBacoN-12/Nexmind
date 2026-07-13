// Round 2: the original 8-candidate library (reused from Gold/Bitcoin) failed
// to hold up on the wider 49-stock sp500 sample (stocks-sweep-large.ts - all
// 8 came back "unstable"). Trying a different family of signals with
// documented equity-specific edges instead of momentum-ignition style
// patterns: pullback-buy-in-uptrend, oversold-reversion-with-trend-filter,
// and Donchian-channel breakout. Same 49-symbol sample, same production
// ladder, same pooled + split-half methodology.
// Usage: npx tsx scripts/stocks-sweep-v2.ts

import { fetchCandlesBatch } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";
import { UNIVERSES } from "../src/lib/trading/universe";

const RISK_USD = 100;
const TP1_MULT = 1.2;
const RANGE = "2y";
const INTERVAL = "1d";

const ALL = UNIVERSES["sp500"].symbols;
const SAMPLE = ALL.filter((_, i) => i % 10 === 0);

const CANDIDATES: Array<{ label: string; code: string }> = [
  {
    label: "Pullback-Buy in Uptrend (sma20>sma50, RSI dip+recover)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.sma20 == null || s.sma50 == null || s.rsi == null || p.rsi == null || s.price == null) return null;
if (s.sma20 > s.sma50 && s.price > s.sma50 && p.rsi < 45 && s.rsi >= 45) return { side: "long", note: "pullback recovery in uptrend" };
if (s.sma20 < s.sma50 && s.price < s.sma50 && p.rsi > 55 && s.rsi <= 55) return { side: "short", note: "pullback recovery in downtrend" };
return null;
`,
  },
  {
    label: "Oversold Reversion With Trend Filter (RSI<30/>70 + trend)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.sma20 == null || s.sma50 == null || s.rsi == null || p.rsi == null) return null;
if (s.sma20 > s.sma50 && p.rsi < 30 && s.rsi >= p.rsi) return { side: "long", note: "oversold reversion in uptrend" };
if (s.sma20 < s.sma50 && p.rsi > 70 && s.rsi <= p.rsi) return { side: "short", note: "overbought reversion in downtrend" };
return null;
`,
  },
  {
    label: "20-Day Donchian Breakout (ADX confirm)",
    code: `
var i = bars.length - 1;
if (i < 21) return null;
var s = snaps[i];
if (s.adx == null || s.plusDI == null || s.minusDI == null || s.price == null) return null;
if (s.adx < 20) return null;
var hi = -Infinity, lo = Infinity;
for (var k = i - 20; k < i; k++) {
  var pr = snaps[k].price;
  if (pr == null) continue;
  if (pr > hi) hi = pr;
  if (pr < lo) lo = pr;
}
if (s.price > hi && s.plusDI > s.minusDI) return { side: "long", note: "20-day high breakout" };
if (s.price < lo && s.minusDI > s.plusDI) return { side: "short", note: "20-day low breakdown" };
return null;
`,
  },
  {
    label: "Golden Pullback (price>sma50>sma20 fade then reclaim sma20)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.sma20 == null || s.sma50 == null || s.price == null || p.price == null) return null;
if (s.sma50 > 0 && s.sma20 > s.sma50 && p.price < p.sma20 && s.price >= s.sma20 && s.price > s.sma50) {
  return { side: "long", note: "reclaimed sma20 in uptrend" };
}
if (s.sma20 < s.sma50 && p.price > p.sma20 && s.price <= s.sma20 && s.price < s.sma50) {
  return { side: "short", note: "lost sma20 in downtrend" };
}
return null;
`,
  },
];

async function main() {
  console.log(`Sweeping ${CANDIDATES.length} v2 candidates across ${SAMPLE.length} sector-diverse sp500 symbols (${INTERVAL}/${RANGE}, pooled)\n`);
  const candleMap = await fetchCandlesBatch(SAMPLE, RANGE, INTERVAL);
  const data: Array<{ symbol: string; bars: any[]; snaps: any[]; yearFactor: number; days: number }> = [];
  for (const symbol of SAMPLE) {
    const resp = candleMap.get(symbol);
    if (!resp || resp.candles.length < 100) continue;
    const bars = resp.candles;
    const snaps = computeSnapshots(bars);
    const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
    data.push({ symbol, bars, snaps, yearFactor: 365 / days, days });
  }
  console.log(`(${data.length}/${SAMPLE.length} symbols had enough data)\n`);

  for (const c of CANDIDATES) {
    let compiled;
    try {
      compiled = compileStrategy(c.code);
    } catch (e) {
      console.log(`${c.label.padEnd(58)} SAFETY REJECTED: ${e}`);
      continue;
    }

    let pooledTrades = 0, pooledWins = 0, pooledAnnPnl = 0;
    let h1Trades = 0, h1Wins = 0, h1AnnPnl = 0;
    let h2Trades = 0, h2Wins = 0, h2AnnPnl = 0;

    for (const d of data) {
      const entry = (i: number) => compiled!.invoke(d.bars, d.snaps, i)?.side ?? null;
      const result = backtestCandles(d.symbol, d.bars, 0.1, undefined, entry, true, TP1_MULT);
      const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
      const wins = result.trades.filter((t) => t.outcome === "win").length;
      pooledTrades += result.trades.length;
      pooledWins += wins;
      pooledAnnPnl += rs.reduce((s, r) => s + r * RISK_USD, 0) * d.yearFactor;

      const mid = Math.floor(d.bars.length / 2);
      const b1 = d.bars.slice(0, mid), s1 = d.snaps.slice(0, mid);
      const b2 = d.bars.slice(mid), s2 = d.snaps.slice(mid);
      const e1 = (i: number) => compiled!.invoke(b1, s1, i)?.side ?? null;
      const e2 = (i: number) => compiled!.invoke(b2, s2, i)?.side ?? null;
      const r1 = backtestCandles(d.symbol, b1, 0.1, undefined, e1, true, TP1_MULT);
      const r2 = backtestCandles(d.symbol, b2, 0.1, undefined, e2, true, TP1_MULT);
      const rs1 = r1.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
      const rs2 = r2.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
      const halfYearFactor = 365 / (d.days / 2);
      h1Trades += r1.trades.length; h1Wins += r1.trades.filter((t) => t.outcome === "win").length;
      h1AnnPnl += rs1.reduce((s, r) => s + r * RISK_USD, 0) * halfYearFactor;
      h2Trades += r2.trades.length; h2Wins += r2.trades.filter((t) => t.outcome === "win").length;
      h2AnnPnl += rs2.reduce((s, r) => s + r * RISK_USD, 0) * halfYearFactor;
    }

    const winRate = pooledTrades ? (pooledWins / pooledTrades) * 100 : 0;
    const win1 = h1Trades ? (h1Wins / h1Trades) * 100 : 0;
    const win2 = h2Trades ? (h2Wins / h2Trades) * 100 : 0;
    const stable = h1AnnPnl > 0 && h2AnnPnl > 0;
    console.log(
      `${c.label.padEnd(58)} trades=${String(pooledTrades).padStart(4)} win%=${winRate.toFixed(1).padStart(5)} ann=$${pooledAnnPnl.toFixed(0).padStart(7)}  ` +
      `H1[trades=${h1Trades} win%=${win1.toFixed(1)} ann=$${h1AnnPnl.toFixed(0)}]  H2[trades=${h2Trades} win%=${win2.toFixed(1)} ann=$${h2AnnPnl.toFixed(0)}]  ` +
      `${stable ? "STABLE+" : "unstable"}`
    );
  }
}

main();
