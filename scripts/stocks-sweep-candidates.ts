// Baseline "combo-vote" scored only 29.5% weighted win-rate and 2/10 symbols
// stable both halves on the sp500 sample (stocks-baseline-check.ts) - well
// below the >50% win-rate / stable-both-halves bar used for Gold/Bitcoin.
// Sweeps the same candidate library used for BTC-USD (reused verbatim from
// btc-sweep-candidates.ts) against the sp500 sample at 1d/2y, production
// ladder (SL=1.5xATR, TP=1.2xATR, singleTarget=true - what runResearch.ts
// fixes any dispatched candidate to), pooling trades across all 10 symbols
// to get one win-rate/stability read per candidate (this is a universe
// strategy - real edge quality is judged across many stocks, not one).
// Usage: npx tsx scripts/stocks-sweep-candidates.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SAMPLE = ["AAPL", "MSFT", "NVDA", "AMD", "JPM", "XOM", "UNH", "HD", "PG", "CAT"];
const RANGE = "2y";
const INTERVAL = "1d";
const RISK_USD = 100;
const TP1_MULT = 1.2; // production ladder, fixed by runResearch.ts / RESEARCH_ATR_TP_MULT

const CANDIDATES: Array<{ label: string; code: string }> = [
  {
    label: "ATR-Band Reversal-Confirmed",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.sma20 == null || p.sma20 == null || s.atr == null || p.atr == null || s.rsi == null || p.rsi == null || s.price == null || p.price == null) return null;
if (s.adx > 20) return null;
var pUpper = p.sma20 + p.atr * 1.3;
var pLower = p.sma20 - p.atr * 1.3;
if (p.price > pUpper && p.rsi > 65 && s.price < p.price && s.rsi < p.rsi) {
  return { side: "short", note: "reversal confirmed after band stretch" };
}
if (p.price < pLower && p.rsi < 35 && s.price > p.price && s.rsi > p.rsi) {
  return { side: "long", note: "reversal confirmed after band stretch" };
}
return null;
`,
  },
  {
    label: "RSI-Cross-Back Range Fade",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.rsi == null || p.rsi == null) return null;
if (s.adx > 20) return null;
if (p.rsi < 30 && s.rsi >= 30) return { side: "long", note: "RSI crossed back above 30" };
if (p.rsi > 70 && s.rsi <= 70) return { side: "short", note: "RSI crossed back below 70" };
return null;
`,
  },
  {
    label: "Tight-Band Fade (1.0x ATR, ADX<15)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i];
if (s.adx == null || s.sma20 == null || s.atr == null || s.rsi == null || s.price == null) return null;
if (s.adx > 15) return null;
var upper = s.sma20 + s.atr * 1.0;
var lower = s.sma20 - s.atr * 1.0;
if (s.price > upper && s.rsi > 60) return { side: "short", note: "tight band fade" };
if (s.price < lower && s.rsi < 40) return { side: "long", note: "tight band fade" };
return null;
`,
  },
  {
    label: "DI-Dominance Continuation (no chop filter)",
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
    label: "ADX-Ignition Breakout (ADX crosses 25 fresh)",
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
    label: "Strong-Trend Rider (ADX>28 rising, MACD accel, aligned SMAs)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.plusDI == null || s.minusDI == null || s.sma20 == null || s.sma50 == null || s.macdHist == null || p.macdHist == null || s.price == null) return null;
if (s.adx < 28 || s.adx <= p.adx) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
if (gap < 10) return null;
if (s.plusDI > s.minusDI && s.price > s.sma20 && s.sma20 > s.sma50 && s.macdHist > p.macdHist && s.macdHist > 0) {
  return { side: "long", note: "strong trend rider" };
}
if (s.minusDI > s.plusDI && s.price < s.sma20 && s.sma20 < s.sma50 && s.macdHist < p.macdHist && s.macdHist < 0) {
  return { side: "short", note: "strong trend rider" };
}
return null;
`,
  },
  {
    label: "RSI-50 Momentum Cross (trend filter, ADX>20)",
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
    label: "MACD-Hist Zero-Cross (trend filter)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.macdHist == null || p.macdHist == null || s.sma50 == null || s.price == null) return null;
if (p.macdHist <= 0 && s.macdHist > 0 && s.price > s.sma50) return { side: "long", note: "MACD hist cross up, above sma50" };
if (p.macdHist >= 0 && s.macdHist < 0 && s.price < s.sma50) return { side: "short", note: "MACD hist cross down, below sma50" };
return null;
`,
  },
];

async function main() {
  // Fetch once per symbol, reuse across all candidates.
  const data: Array<{ symbol: string; bars: any[]; snaps: any[]; yearFactor: number; days: number }> = [];
  for (const symbol of SAMPLE) {
    const resp = await fetchCandles(symbol, RANGE, INTERVAL);
    const bars = resp.candles;
    if (bars.length < 100) { console.log(`${symbol} too few bars, skipped`); continue; }
    const snaps = computeSnapshots(bars);
    const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
    data.push({ symbol, bars, snaps, yearFactor: 365 / days, days });
  }

  console.log(`\nSweeping ${CANDIDATES.length} candidates across ${data.length} sp500 sample stocks (${INTERVAL}/${RANGE}, pooled)\n`);

  for (const c of CANDIDATES) {
    let compiled;
    try {
      compiled = compileStrategy(c.code);
    } catch (e) {
      console.log(`${c.label.padEnd(48)} SAFETY REJECTED: ${e}`);
      continue;
    }

    let pooledTrades = 0, pooledWins = 0, pooledAnnPnl = 0;
    let h1Trades = 0, h1Wins = 0, h1AnnPnl = 0;
    let h2Trades = 0, h2Wins = 0, h2AnnPnl = 0;

    for (const d of data) {
      const entry = (i: number) => compiled.invoke(d.bars, d.snaps, i)?.side ?? null;
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
      `${c.label.padEnd(48)} trades=${String(pooledTrades).padStart(4)} win%=${winRate.toFixed(1).padStart(5)} ann=$${pooledAnnPnl.toFixed(0).padStart(7)}  ` +
      `H1[trades=${h1Trades} win%=${win1.toFixed(1)} ann=$${h1AnnPnl.toFixed(0)}]  H2[trades=${h2Trades} win%=${win2.toFixed(1)} ann=$${h2AnnPnl.toFixed(0)}]  ` +
      `${stable ? "STABLE+" : "unstable"}`
    );
  }
}

main();
