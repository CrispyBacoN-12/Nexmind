// Round 3 - new angle: switch timeframe from daily to weekly bars. All 12
// daily-bar candidates (stocks-sweep-large.ts + stocks-sweep-v2.ts) failed to
// hold up on a diverse 49-stock sp500 sample. Weekly bars smooth out daily
// noise and are a standard lever for swing systems that don't have edge at
// daily resolution - same signals, same sample, same production ladder
// (ATR-relative SL/TP auto-adjusts to weekly volatility), just re-run on
// 1wk/5y bars instead of 1d/2y.
// Usage: npx tsx scripts/stocks-weekly-sweep.ts

import { fetchCandlesBatch } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";
import { UNIVERSES } from "../src/lib/trading/universe";

const RISK_USD = 100;
const TP1_MULT = 1.2;
const RANGE = "5y";
const INTERVAL = "1wk";

const ALL = UNIVERSES["sp500"].symbols;
const SAMPLE = ALL.filter((_, i) => i % 10 === 0);

const CANDIDATES: Array<{ label: string; code: string }> = [
  {
    label: "ADX-Ignition Breakout (weekly)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.plusDI == null || s.minusDI == null || s.sma50 == null || s.price == null) return null;
if (p.adx >= 25 || s.adx < 25) return null;
if (s.plusDI > s.minusDI && s.price > s.sma50) return { side: "long", note: "fresh ADX ignition, +DI dominant, above sma50" };
if (s.minusDI > s.plusDI && s.price < s.sma50) return { side: "short", note: "fresh ADX ignition, -DI dominant, below sma50" };
return null;
`,
  },
  {
    label: "DI-Dominance Continuation (weekly, no chop filter)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 25) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long", note: "DI gap widening, +DI dominant" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short", note: "DI gap widening, -DI dominant" };
return null;
`,
  },
  {
    label: "RSI-50 Momentum Cross (weekly, trend filter ADX>20)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.rsi == null || p.rsi == null || s.sma50 == null || s.price == null) return null;
if (s.adx < 20) return null;
if (p.rsi <= 50 && s.rsi > 50 && s.price > s.sma50) return { side: "long", note: "RSI cross above 50, uptrend" };
if (p.rsi >= 50 && s.rsi < 50 && s.price < s.sma50) return { side: "short", note: "RSI cross below 50, downtrend" };
return null;
`,
  },
  {
    label: "Pullback-Buy in Uptrend (weekly, sma20>sma50, RSI dip+recover)",
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
];

async function main() {
  console.log(`Sweeping ${CANDIDATES.length} candidates on WEEKLY bars across ${SAMPLE.length} sector-diverse sp500 symbols (${INTERVAL}/${RANGE}, pooled)\n`);
  const candleMap = await fetchCandlesBatch(SAMPLE, RANGE, INTERVAL);
  const data: Array<{ symbol: string; bars: any[]; snaps: any[]; yearFactor: number; days: number }> = [];
  for (const symbol of SAMPLE) {
    const resp = candleMap.get(symbol);
    if (!resp || resp.candles.length < 60) continue;
    const bars = resp.candles;
    const snaps = computeSnapshots(bars);
    const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
    data.push({ symbol, bars, snaps, yearFactor: 365 / days, days });
  }
  console.log(`(${data.length}/${SAMPLE.length} symbols had enough data, avg ${Math.round(data.reduce((s, d) => s + d.bars.length, 0) / data.length)} bars)\n`);

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
