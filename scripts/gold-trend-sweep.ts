// research-25 "DI-Cross" only fires on a direction FLIP - it goes silent during
// a clean one-way trend (exactly what's happening now: ADX 45, no crossover
// in over a day). This sweeps a complementary family of TREND-CONTINUATION
// signals that fire *while already inside* an established trend (pullback
// re-entries, breakout continuation) instead of waiting for a reversal cross -
// so the two signal types cover different market regimes. Same GC=F 1h data,
// same production ladder (SL=1.5xATR, TP=1.2xATR), same split-half stability
// bar used throughout this session's stock/crypto sweeps.
// Usage: npx tsx scripts/gold-trend-sweep.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const RISK_USD = 100;
const TP1_MULT = 1.2;
const RUNS: Array<{ range: "3mo" | "1y"; interval: "1h" }> = [
  { range: "3mo", interval: "1h" },
  { range: "1y", interval: "1h" },
];

const CANDIDATES: Array<{ label: string; code: string }> = [
  {
    label: "Pullback-Continuation (ADX>25, dip to SMA20, resume trend)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.sma20 == null || s.sma50 == null || s.price == null || p.price == null) return null;
if (s.adx < 25) return null;
if (s.sma20 > s.sma50 && p.price <= p.sma20 && s.price > s.sma20) return { side: "long", note: "pullback to sma20, trend resumes up" };
if (s.sma20 < s.sma50 && p.price >= p.sma20 && s.price < s.sma20) return { side: "short", note: "pullback to sma20, trend resumes down" };
return null;
`,
  },
  {
    label: "DI-Dominance Widening (ADX>20, gap widening, no fresh cross needed)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 20) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long", note: "DI gap widening, +DI dominant" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short", note: "DI gap widening, -DI dominant" };
return null;
`,
  },
  {
    label: "10-Bar Donchian Continuation (ADX>20 confirm)",
    code: `
var i = bars.length - 1;
if (i < 11) return null;
var s = snaps[i];
if (s.adx == null || s.plusDI == null || s.minusDI == null || s.price == null) return null;
if (s.adx < 20) return null;
var hi = -Infinity, lo = Infinity;
for (var k = i - 10; k < i; k++) {
  var pr = snaps[k].price;
  if (pr == null) continue;
  if (pr > hi) hi = pr;
  if (pr < lo) lo = pr;
}
if (s.price > hi && s.plusDI > s.minusDI) return { side: "long", note: "10-bar high continuation" };
if (s.price < lo && s.minusDI > s.plusDI) return { side: "short", note: "10-bar low continuation" };
return null;
`,
  },
  {
    label: "RSI Pullback-Reload in Trend (RSI dips to 45/55 then resumes)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.rsi == null || p.rsi == null || s.sma50 == null || s.price == null) return null;
if (s.adx < 20) return null;
if (s.price > s.sma50 && p.rsi < 45 && s.rsi >= p.rsi && s.rsi < 60) return { side: "long", note: "RSI reload in uptrend" };
if (s.price < s.sma50 && p.rsi > 55 && s.rsi <= p.rsi && s.rsi > 40) return { side: "short", note: "RSI reload in downtrend" };
return null;
`,
  },
];

async function main() {
  for (const { range, interval } of RUNS) {
    const resp = await fetchCandles(SYMBOL, range, interval);
    const bars = resp.candles;
    const snaps = computeSnapshots(bars);
    const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
    console.log(`\n===== ${SYMBOL} ${interval}/${range} (${bars.length} bars, ~${days.toFixed(0)} days) =====`);

    for (const c of CANDIDATES) {
      let compiled;
      try {
        compiled = compileStrategy(c.code);
      } catch (e) {
        console.log(`${c.label.padEnd(60)} SAFETY REJECTED: ${e}`);
        continue;
      }

      const entry = (i: number) => compiled!.invoke(bars, snaps, i)?.side ?? null;
      const result = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, TP1_MULT);
      const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
      const wins = result.trades.filter((t) => t.outcome === "win").length;
      const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
      const totalPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);
      const perDay = result.trades.length / days;

      const mid = Math.floor(bars.length / 2);
      const b1 = bars.slice(0, mid), s1 = snaps.slice(0, mid);
      const b2 = bars.slice(mid), s2 = snaps.slice(mid);
      const e1 = (i: number) => compiled!.invoke(b1, s1, i)?.side ?? null;
      const e2 = (i: number) => compiled!.invoke(b2, s2, i)?.side ?? null;
      const r1 = backtestCandles(SYMBOL, b1, 0.1, undefined, e1, true, TP1_MULT);
      const r2 = backtestCandles(SYMBOL, b2, 0.1, undefined, e2, true, TP1_MULT);
      const rs1 = r1.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
      const rs2 = r2.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
      const w1 = r1.trades.filter((t) => t.outcome === "win").length;
      const w2 = r2.trades.filter((t) => t.outcome === "win").length;
      const win1 = r1.trades.length ? (w1 / r1.trades.length) * 100 : 0;
      const win2 = r2.trades.length ? (w2 / r2.trades.length) * 100 : 0;
      const pnl1 = rs1.reduce((s, r) => s + r * RISK_USD, 0);
      const pnl2 = rs2.reduce((s, r) => s + r * RISK_USD, 0);
      const stable = pnl1 > 0 && pnl2 > 0;

      console.log(
        `${c.label.padEnd(60)} trades=${String(result.trades.length).padStart(3)} win%=${winRate.toFixed(1).padStart(5)} ` +
        `trades/day=${perDay.toFixed(2)} pnl=$${totalPnl.toFixed(0).padStart(6)}  ` +
        `H1[n=${r1.trades.length} win%=${win1.toFixed(0)} pnl=$${pnl1.toFixed(0)}] H2[n=${r2.trades.length} win%=${win2.toFixed(0)} pnl=$${pnl2.toFixed(0)}]  ` +
        `${stable ? "STABLE+" : "unstable"}`
      );
    }
  }
}

main();
