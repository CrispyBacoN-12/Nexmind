// Fast iteration harness: test several candidate entry rules against the REAL
// backtest engine across multiple ranges (for robustness), without hitting the
// DB/API for every attempt. Edit CANDIDATES below and re-run.
// Usage: npx tsx scripts/sweep-candidates.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles, summarizeBacktest } from "../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const RANGES: Array<{ range: "3mo" | "1y"; interval: "1h" }> = [
  { range: "3mo", interval: "1h" },
  { range: "1y", interval: "1h" },
];
const TP1_MULT = Number(process.argv[2] ?? 1.0); // tight single target, validated via sweep-rr.ts

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
    label: "ATR-Band + RSI-Cross-Back combo",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.sma20 == null || s.atr == null || s.rsi == null || p.rsi == null || s.price == null) return null;
if (s.adx > 20) return null;
var upper = s.sma20 + s.atr * 1.3;
var lower = s.sma20 - s.atr * 1.3;
if (s.price > upper && p.rsi > 70 && s.rsi <= 70) return { side: "short", note: "band + RSI cross-back" };
if (s.price < lower && p.rsi < 30 && s.rsi >= 30) return { side: "long", note: "band + RSI cross-back" };
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
  return { side: "long", note: "strong trend rider: ADX " + s.adx.toFixed(0) + " rising, momentum accelerating" };
}
if (s.minusDI > s.plusDI && s.price < s.sma20 && s.sma20 < s.sma50 && s.macdHist < p.macdHist && s.macdHist < 0) {
  return { side: "short", note: "strong trend rider: ADX " + s.adx.toFixed(0) + " rising, momentum accelerating" };
}
return null;
`,
  },
];

async function main() {
  for (const { range, interval } of RANGES) {
    const resp = await fetchCandles(SYMBOL, range, interval);
    const bars = resp.candles;
    const snaps = computeSnapshots(bars);
    console.log(`\n===== ${SYMBOL} ${interval}/${range} (${bars.length} bars) =====`);
    for (const c of CANDIDATES) {
      let compiled;
      try {
        compiled = compileStrategy(c.code);
      } catch (e) {
        console.log(`${c.label.padEnd(40)} SAFETY REJECTED: ${e}`);
        continue;
      }
      const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
      const result = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, TP1_MULT);
      const s = summarizeBacktest(result.trades);
      console.log(
        `${c.label.padEnd(40)} trades=${String(s.trades).padStart(3)}  win%=${s.winRate.toFixed(0).padStart(3)}  ` +
        `avgR=${(s.avgR ?? 0).toFixed(2).padStart(6)}  expectancy=${(s.expectancy ?? 0).toFixed(2).padStart(7)}  totalPnl=${s.totalPnl.toFixed(2).padStart(8)}`
      );
    }
  }
}

main();
