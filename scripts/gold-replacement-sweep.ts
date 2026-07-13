// Finds a replacement for research-25 "DI-Cross" (live on Gold Desk #8),
// which just FAILED a genuine blind test (blind-test-gold.ts): 53.7% win on
// the held-out year, below the ~55.6% breakeven line for this ladder (SL=1.5x
// ATR/TP=1.2xATR), net -$880. Proper methodology this time: split GC=F 2y 1h
// data into TUNE (most recent 365 days - used for candidate selection/split-
// half stability) and BLIND (the older 365-730 day segment - checked ONLY
// after a candidate is chosen on TUNE, never used to pick or adjust anything).
// Candidates avoid duplicating research-30 "DI-Dominance Widening" (already
// live on #13) - these are fresh ideas, several reversal-style (confirmed,
// not raw crossover) since #8 was meant to cover the reversal regime.
// Usage: npx tsx scripts/gold-replacement-sweep.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const RISK_USD = 100;
const TP1_MULT = 1.2;

const CANDIDATES: Array<{ label: string; code: string }> = [
  {
    label: "10-Bar Donchian Continuation (ADX>20)",
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
    label: "RSI Extreme Reversal + Trend Filter (RSI<25/>75, confirmed)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.rsi == null || p.rsi == null || s.sma50 == null || s.price == null) return null;
if (p.rsi < 25 && s.rsi >= p.rsi && s.rsi < 35) return { side: "long", note: "extreme oversold, confirmed turn" };
if (p.rsi > 75 && s.rsi <= p.rsi && s.rsi > 65) return { side: "short", note: "extreme overbought, confirmed turn" };
return null;
`,
  },
  {
    label: "ATR-Band Reversal-Confirmed (chop only, ADX<20)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.sma20 == null || p.sma20 == null || s.atr == null || p.atr == null || s.rsi == null || p.rsi == null || s.price == null || p.price == null) return null;
if (s.adx > 20) return null;
var pUpper = p.sma20 + p.atr * 1.3;
var pLower = p.sma20 - p.atr * 1.3;
if (p.price > pUpper && p.rsi > 65 && s.price < p.price && s.rsi < p.rsi) return { side: "short", note: "reversal confirmed after band stretch" };
if (p.price < pLower && p.rsi < 35 && s.price > p.price && s.rsi > p.rsi) return { side: "long", note: "reversal confirmed after band stretch" };
return null;
`,
  },
  {
    label: "DI-Cross + RSI Confluence (cross + momentum agrees)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.rsi == null) return null;
if (p.plusDI <= p.minusDI && s.plusDI > s.minusDI && s.rsi > 50) return { side: "long", note: "DI cross up, RSI confirms" };
if (p.plusDI >= p.minusDI && s.plusDI < s.minusDI && s.rsi < 50) return { side: "short", note: "DI cross down, RSI confirms" };
return null;
`,
  },
  {
    label: "MACD Hist Flip + Trend Filter (sma20 vs sma50)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.macdHist == null || p.macdHist == null || s.sma20 == null || s.sma50 == null) return null;
if (p.macdHist <= 0 && s.macdHist > 0 && s.sma20 > s.sma50) return { side: "long", note: "MACD hist flips positive, uptrend" };
if (p.macdHist >= 0 && s.macdHist < 0 && s.sma20 < s.sma50) return { side: "short", note: "MACD hist flips negative, downtrend" };
return null;
`,
  },
];

function runOne(bars: any[], snaps: any[], code: string, days: number) {
  const compiled = compileStrategy(code);
  const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
  const result = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, TP1_MULT);
  const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const wins = result.trades.filter((t) => t.outcome === "win").length;
  const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
  const totalPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);
  const annPnl = totalPnl * (365 / days);
  return { trades: result.trades.length, winRate, totalPnl, annPnl };
}

async function main() {
  const resp = await fetchCandles(SYMBOL, "2y", "1h");
  const bars = resp.candles;
  const cutoffTs = bars[bars.length - 1].t - 365 * 86400;
  const TUNE = bars.filter((b) => b.t >= cutoffTs);
  const BLIND = bars.filter((b) => b.t < cutoffTs);
  const tuneSnaps = computeSnapshots(TUNE);
  const blindSnaps = computeSnapshots(BLIND);
  const tuneDays = (TUNE[TUNE.length - 1].t - TUNE[0].t) / 86400;
  const blindDays = (BLIND[BLIND.length - 1].t - BLIND[0].t) / 86400;
  console.log(`TUNE: ${TUNE.length} bars ~${tuneDays.toFixed(0)}d   BLIND (never touched until now): ${BLIND.length} bars ~${blindDays.toFixed(0)}d\n`);

  for (const c of CANDIDATES) {
    let compiled;
    try {
      compiled = compileStrategy(c.code);
    } catch (e) {
      console.log(`${c.label.padEnd(55)} SAFETY REJECTED: ${e}`);
      continue;
    }

    // Split-half stability on TUNE only.
    const mid = Math.floor(TUNE.length / 2);
    const b1 = TUNE.slice(0, mid), s1 = tuneSnaps.slice(0, mid);
    const b2 = TUNE.slice(mid), s2 = tuneSnaps.slice(mid);
    const halfDays = tuneDays / 2;
    const h1 = runOne(b1, s1, c.code, halfDays);
    const h2 = runOne(b2, s2, c.code, halfDays);
    const tuneStable = h1.annPnl > 0 && h2.annPnl > 0;
    const tuneFull = runOne(TUNE, tuneSnaps, c.code, tuneDays);

    // Blind check - only meaningful to report, never fed back into selection.
    const blind = runOne(BLIND, blindSnaps, c.code, blindDays);
    const blindPassed = blind.winRate > 50 && blind.totalPnl > 0;

    console.log(
      `${c.label.padEnd(55)}\n` +
      `  TUNE:  trades=${tuneFull.trades} win%=${tuneFull.winRate.toFixed(1)} ann=$${tuneFull.annPnl.toFixed(0)} ` +
      `H1[ann=$${h1.annPnl.toFixed(0)}] H2[ann=$${h2.annPnl.toFixed(0)}] ${tuneStable ? "STABLE+" : "unstable"}\n` +
      `  BLIND: trades=${blind.trades} win%=${blind.winRate.toFixed(1)} ann=$${blind.annPnl.toFixed(0)} ${blindPassed ? "PASSED" : "FAILED"}\n` +
      `  => ${tuneStable && blindPassed ? "*** QUALIFIES (stable on TUNE + passes BLIND) ***" : "reject"}\n`
    );
  }
}

main();
