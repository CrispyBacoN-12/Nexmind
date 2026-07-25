// Indicator-context + candlestick-confirmation confluence, on GC=F 1h.
//
// User's idea: use an INDICATOR to establish the context/direction first, then
// require a CANDLESTICK pattern to confirm the actual entry bar. Candlesticks
// failed as a standalone signal (overfit), but as a confirmation gate on top of
// an indicator context they might sharpen entry quality.
//
// The trap this measures directly: candlestick patterns are rare, so a candle
// gate SHRINKS trade count. If it drops from hundreds to teens, we are back in
// small-sample-fluke land (see combo-gold). Every cell prints its trade count
// so a "great PF on 12 trades" is obvious, not hidden.
//
// Matrix: context (trend / macd+trend / macd+trend+widening) x candle mode
// (none / confirm-on-bar / confirm-within-3-bars). Baseline = macd+trend, no
// candle. TP=2.0xATR, DEFAULT_COST_MODEL, singleTarget.
//
// Usage: npx tsx scripts/confluence-indicator-candle-gcf.mts [symbol] [range]

import "dotenv/config";
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import {
  isHammer, isBullishEngulfing, isPiercingLine, isMorningStar, isThreeWhiteSoldiers,
  isShootingStar, isBearishEngulfing, isDarkCloudCover, isEveningStar, isThreeBlackCrows,
} from "../src/lib/trading/candlestickPatterns";
import { backtestCandles, summarizeBacktest, DEFAULT_COST_MODEL } from "../src/lib/backtest/engine";
import type { Candle } from "../src/lib/indicators";

const SYMBOL = process.argv[2] ?? "GC=F";
const RANGE = (process.argv[3] ?? "2y") as "2y" | "5y" | "max";
const TP = 2.0;
type Snaps = ReturnType<typeof computeSnapshots>;
type Side = "long" | "short";

// --- Indicator contexts (give a direction, or null to stand aside) ---
function ctxTrend(s: Snaps, i: number): Side | null {
  const c = s[i];
  if (!c || c.sma20 == null || c.sma50 == null) return null;
  if (c.sma20 > c.sma50) return "long";
  if (c.sma20 < c.sma50) return "short";
  return null;
}
function ctxMacdTrend(s: Snaps, i: number): Side | null {
  const c = s[i];
  if (!c || c.macdHist == null || c.sma20 == null || c.sma50 == null) return null;
  if (c.macdHist > 0 && c.sma20 > c.sma50) return "long";
  if (c.macdHist < 0 && c.sma20 < c.sma50) return "short";
  return null;
}
function ctxMacdTrendWiden(s: Snaps, i: number): Side | null {
  if (i < 1) return null;
  const c = s[i], p = s[i - 1];
  if (!c || !p || c.plusDI == null || c.minusDI == null || p.plusDI == null || p.minusDI == null) return null;
  if (Math.abs(c.plusDI - c.minusDI) <= Math.abs(p.plusDI - p.minusDI)) return null;
  return ctxMacdTrend(s, i);
}

// --- Candlestick confirmation in a given direction ---
function bullishCandle(bars: Candle[], i: number): boolean {
  return isHammer(bars, i) || isBullishEngulfing(bars, i) || isPiercingLine(bars, i) || isMorningStar(bars, i) || isThreeWhiteSoldiers(bars, i);
}
function bearishCandle(bars: Candle[], i: number): boolean {
  return isShootingStar(bars, i) || isBearishEngulfing(bars, i) || isDarkCloudCover(bars, i) || isEveningStar(bars, i) || isThreeBlackCrows(bars, i);
}
type CandleMode = "none" | "bar" | "win3";
function candleOk(bars: Candle[], i: number, side: Side, mode: CandleMode): boolean {
  if (mode === "none") return true;
  const hit = (j: number) => (side === "long" ? bullishCandle(bars, j) : bearishCandle(bars, j));
  if (mode === "bar") return hit(i);
  for (let j = Math.max(0, i - 2); j <= i; j++) if (hit(j)) return true; // within 3 bars
  return false;
}

function evalCombo(bars: Candle[], snaps: Snaps, ctx: (s: Snaps, i: number) => Side | null, mode: CandleMode) {
  const entry = (i: number): Side | null => {
    const side = ctx(snaps, i);
    if (!side) return null;
    return candleOk(bars, i, side, mode) ? side : null;
  };
  const res = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, TP, DEFAULT_COST_MODEL);
  return summarizeBacktest(res.trades);
}

const CONTEXTS: [string, (s: Snaps, i: number) => Side | null][] = [
  ["trend            ", ctxTrend],
  ["macd+trend       ", ctxMacdTrend],
  ["macd+trend+widen ", ctxMacdTrendWiden],
];
const MODES: CandleMode[] = ["none", "bar", "win3"];

async function main() {
  const resp = await fetchCandles(SYMBOL, RANGE, "1h");
  const bars = resp.candles;
  console.log(`${SYMBOL} 1h: ${bars.length} bars, ${new Date(bars[0].t * 1000).toISOString().slice(0, 10)} -> ${new Date(bars.at(-1)!.t * 1000).toISOString().slice(0, 10)}\n`);

  const splitIdx = Math.floor(bars.length * 0.65);
  const trainBars = bars.slice(0, splitIdx), testBars = bars.slice(splitIdx);
  const trainSnaps = computeSnapshots(trainBars), testSnaps = computeSnapshots(testBars);
  console.log(`TRAIN ${trainBars.length} bars  TEST ${testBars.length} bars (OOS)\n`);

  console.log("context           | candle | TRAIN trades avgR   PF   | TEST trades avgR   PF    | trustworthy?");
  console.log("-".repeat(98));
  for (const [name, ctx] of CONTEXTS) {
    for (const mode of MODES) {
      const tr = evalCombo(trainBars, trainSnaps, ctx, mode);
      const te = evalCombo(testBars, testSnaps, ctx, mode);
      const trust = te.trades < 15 ? "NO - too few OOS trades" :
        (te.avgR ?? -9) > 0 && (te.profitFactor ?? 0) > 1.0 ? "positive OOS" : "negative OOS";
      const base = name.startsWith("macd+trend  ") && mode === "none" ? " <- BASELINE" : "";
      console.log(
        `${name} | ${mode.padEnd(6)} | ${String(tr.trades).padStart(5)} ${(tr.avgR ?? 0).toFixed(3).padStart(6)} ${(tr.profitFactor ?? 0).toFixed(2).padStart(5)} | ` +
        `${String(te.trades).padStart(5)} ${(te.avgR ?? 0).toFixed(3).padStart(6)} ${(te.profitFactor ?? 0).toFixed(2).padStart(5)}  | ${trust}${base}`,
      );
    }
  }
  console.log("\nBaseline = 'macd+trend / none'. A candle gate is worth it only if it lifts avgR/PF");
  console.log("meaningfully WITHOUT dropping TEST trades below ~15.");
}

main();
