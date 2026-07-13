// Comparing the two trade-offs the user is weighing for Bitcoin Desk:
//   (A) keep the stable signal (RSI-50 Momentum Cross, research-27) but raise
//       risk % per trade (1% -> 1.5% -> 2%) to scale up the $ return
//   (B) switch to the higher-average-but-unstable signal (ADX-Ignition
//       Breakout) at the current 1% risk
// For both, computes not just annualized real $ P/L but a real equity curve
// (running balance from the actual trade sequence) to get max drawdown %,
// since raising risk multiplies drawdown by the same factor as return, and
// option B's instability needs to be shown as a literal losing stretch, not
// just an average.
// Usage: npx tsx scripts/btc-tradeoff-compare.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "BTC-USD";
const START_BALANCE = 10000;
const TP_MULT = 1.2; // production ladder

const RSI50 = `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.rsi == null || p.rsi == null || s.sma50 == null || s.price == null) return null;
if (s.adx < 20) return null;
if (p.rsi <= 50 && s.rsi > 50 && s.price > s.sma50) return { side: "long", note: "RSI cross above 50, uptrend" };
if (p.rsi >= 50 && s.rsi < 50 && s.price < s.sma50) return { side: "short", note: "RSI cross below 50, downtrend" };
return null;
`;

const ADX_IGNITION = `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.plusDI == null || s.minusDI == null || s.sma50 == null || s.price == null) return null;
if (p.adx >= 25 || s.adx < 25) return null;
if (s.plusDI > s.minusDI && s.price > s.sma50) return { side: "long", note: "ignition" };
if (s.minusDI > s.plusDI && s.price < s.sma50) return { side: "short", note: "ignition" };
return null;
`;

function equityStats(rMultiples: number[], riskUsd: number) {
  let equity = START_BALANCE;
  let peak = START_BALANCE;
  let maxDrawdownPct = 0;
  let maxDrawdownUsd = 0;
  for (const r of rMultiples) {
    equity += r * riskUsd;
    if (equity > peak) peak = equity;
    const ddUsd = peak - equity;
    const ddPct = (ddUsd / peak) * 100;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
    if (ddUsd > maxDrawdownUsd) maxDrawdownUsd = ddUsd;
  }
  const totalPnl = rMultiples.reduce((s, r) => s + r * riskUsd, 0);
  return { finalEquity: equity, totalPnl, maxDrawdownPct, maxDrawdownUsd };
}

function analyze(label: string, code: string, bars: any[], snaps: any[], riskUsd: number, yearFactor: number) {
  const compiled = compileStrategy(code);
  const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
  const result = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, TP_MULT);
  const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const wins = result.trades.filter((t) => t.outcome === "win").length;
  const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
  const eq = equityStats(rs, riskUsd);
  const annualizedPnl = eq.totalPnl * yearFactor;
  console.log(
    `${label.padEnd(38)} risk=$${String(riskUsd).padEnd(4)} trades=${String(result.trades.length).padStart(3)} win%=${winRate.toFixed(1).padStart(5)} ` +
    `P/L(period)=$${eq.totalPnl.toFixed(0).padStart(7)} ann=$${annualizedPnl.toFixed(0).padStart(7)} (${((annualizedPnl / START_BALANCE) * 100).toFixed(1).padStart(5)}%/yr)  ` +
    `maxDD=$${eq.maxDrawdownUsd.toFixed(0).padStart(6)} (${eq.maxDrawdownPct.toFixed(1).padStart(5)}%)`
  );
  return { rs, winRate };
}

async function main() {
  const resp = await fetchCandles(SYMBOL, "1y", "1h");
  const bars = resp.candles;
  const snaps = computeSnapshots(bars);
  const mid = Math.floor(bars.length / 2);
  const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
  const yearFactor = 365 / days;

  console.log(`${SYMBOL} 1h/1y (~${days.toFixed(0)}d), starting balance $${START_BALANCE}\n`);

  console.log("=== Option A: keep RSI-50 Momentum Cross (stable), raise risk % ===");
  for (const riskPct of [1, 1.5, 2]) {
    analyze(`RSI-50 Momentum Cross @ ${riskPct}%`, RSI50, bars, snaps, (START_BALANCE * riskPct) / 100, yearFactor);
  }
  console.log("  split-half check at 2% risk (does raising risk still hold up both halves?):");
  const riskUsd2pct = START_BALANCE * 0.02;
  analyze("  H1 (older 6mo)", RSI50, bars.slice(0, mid), snaps.slice(0, mid), riskUsd2pct, 365 / (days / 2));
  analyze("  H2 (recent 6mo)", RSI50, bars.slice(mid), snaps.slice(mid), riskUsd2pct, 365 / (days / 2));

  console.log("\n=== Option B: switch to ADX-Ignition Breakout (higher avg, unstable), 1% risk ===");
  const riskUsd1pct = START_BALANCE * 0.01;
  analyze("ADX-Ignition Breakout @ 1% (full year)", ADX_IGNITION, bars, snaps, riskUsd1pct, yearFactor);
  analyze("  H1 (older 6mo)", ADX_IGNITION, bars.slice(0, mid), snaps.slice(0, mid), riskUsd1pct, 365 / (days / 2));
  analyze("  H2 (recent 6mo)", ADX_IGNITION, bars.slice(mid), snaps.slice(mid), riskUsd1pct, 365 / (days / 2));
}

main();
