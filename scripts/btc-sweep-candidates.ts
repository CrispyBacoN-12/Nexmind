// Broader candidate search for BTC-USD, mirroring the process that found
// DI-Cross for GC=F (sweep-candidates.ts). The straight DI-Cross port scored
// only 53-58% win% on BTC-USD and lost money over 1y (see
// btc-di-cross-check.ts) - crypto trends differently from gold, so we sweep
// the existing candidate library (plus a couple of crypto-leaning momentum
// variants) against BTC-USD under the exact production ladder
// (SL=1.5xATR, TP=1.2xATR, singleTarget=true) and report REAL $ P/L
// (rMultiple * $100 risk, matching the account's real 1%-risk sizing).
// Usage: npx tsx scripts/btc-sweep-candidates.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "BTC-USD";
const RISK_USD = 100;
const RANGES: Array<{ range: "3mo" | "1y"; interval: "1h" }> = [
  { range: "3mo", interval: "1h" },
  { range: "1y", interval: "1h" },
];
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
  for (const { range, interval } of RANGES) {
    const resp = await fetchCandles(SYMBOL, range, interval);
    const bars = resp.candles;
    const snaps = computeSnapshots(bars);
    const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
    const yearFactor = 365 / days;
    console.log(`\n===== ${SYMBOL} ${interval}/${range} (${bars.length} bars, ~${days.toFixed(0)}d, annualize x${yearFactor.toFixed(2)}) =====`);
    for (const c of CANDIDATES) {
      let compiled;
      try {
        compiled = compileStrategy(c.code);
      } catch (e) {
        console.log(`${c.label.padEnd(48)} SAFETY REJECTED: ${e}`);
        continue;
      }
      const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
      const result = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, TP1_MULT);
      const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
      const wins = result.trades.filter((t) => t.outcome === "win").length;
      const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
      const realPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);
      const realPnlAnnualized = realPnl * yearFactor;
      console.log(
        `${c.label.padEnd(48)} trades=${String(result.trades.length).padStart(3)}  win%=${winRate.toFixed(1).padStart(5)}  ` +
        `REAL P/L(period)=$${realPnl.toFixed(2).padStart(8)}  annualized=$${realPnlAnnualized.toFixed(2).padStart(9)} (${((realPnlAnnualized / 10000) * 100).toFixed(1)}%/yr)`
      );
    }
  }
}

main();
