// Mean-reversion zone + candlestick-reversal confirmation, on GC=F 1h.
//
// The principled pairing the trend version lacked: candlesticks ARE reversal
// signals, so they belong with a mean-reversion context, not a trend one. An
// indicator marks a stretched zone (RSI / Bollinger %B / VWAP deviation
// extreme), then a REVERSAL candle in the bounce direction confirms the turn.
// Contrarian direction: oversold -> long, overbought -> short.
//
// Same trap watch as the trend version: candles are rare, so the gate shrinks
// the sample. Every cell prints its trade count; TP=1.2xATR (tight, mean-revert
// to the mean), SL 1.5xATR, DEFAULT_COST_MODEL, singleTarget.
//
// Usage: npx tsx scripts/confluence-meanrev-candle-gcf.mts [symbol] [range]

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
const TP = 1.2; // tight target: revert to the mean
type Snaps = ReturnType<typeof computeSnapshots>;
type Side = "long" | "short";

// --- Mean-reversion contexts (CONTRARIAN: oversold->long, overbought->short) ---
function ctxRsi(s: Snaps, i: number): Side | null {
  const c = s[i];
  if (!c || c.rsi == null) return null;
  if (c.rsi < 35) return "long";
  if (c.rsi > 65) return "short";
  return null;
}
function ctxBb(s: Snaps, i: number): Side | null {
  const c = s[i];
  if (!c || c.bbPercentB == null) return null;
  if (c.bbPercentB < 0.05) return "long";   // at/below lower band
  if (c.bbPercentB > 0.95) return "short";  // at/above upper band
  return null;
}
function ctxVwap(s: Snaps, i: number): Side | null {
  const c = s[i];
  if (!c || c.vwapDevPct == null) return null;
  if (c.vwapDevPct < -0.6) return "long";
  if (c.vwapDevPct > 0.6) return "short";
  return null;
}

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
  for (let j = Math.max(0, i - 2); j <= i; j++) if (hit(j)) return true;
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
  ["RSI<35/>65     ", ctxRsi],
  ["BB%b<.05/>.95  ", ctxBb],
  ["VWAP dev>0.6%  ", ctxVwap],
];
const MODES: CandleMode[] = ["none", "bar", "win3"];

async function main() {
  const resp = await fetchCandles(SYMBOL, RANGE, "1h");
  const bars = resp.candles;
  console.log(`${SYMBOL} 1h: ${bars.length} bars, ${new Date(bars[0].t * 1000).toISOString().slice(0, 10)} -> ${new Date(bars.at(-1)!.t * 1000).toISOString().slice(0, 10)}\n`);

  const splitIdx = Math.floor(bars.length * 0.65);
  const trainBars = bars.slice(0, splitIdx), testBars = bars.slice(splitIdx);
  const trainSnaps = computeSnapshots(trainBars), testSnaps = computeSnapshots(testBars);
  console.log(`TRAIN ${trainBars.length} bars  TEST ${testBars.length} bars (OOS)  TP=${TP}xATR (mean-revert)\n`);

  console.log("zone            | candle | TRAIN trades avgR   PF   | TEST trades avgR   PF    | trustworthy?");
  console.log("-".repeat(96));
  for (const [name, ctx] of CONTEXTS) {
    for (const mode of MODES) {
      const tr = evalCombo(trainBars, trainSnaps, ctx, mode);
      const te = evalCombo(testBars, testSnaps, ctx, mode);
      const trust = te.trades < 15 ? "NO - too few OOS trades" :
        (te.avgR ?? -9) > 0 && (te.profitFactor ?? 0) > 1.0 ? "positive OOS" : "negative OOS";
      console.log(
        `${name} | ${mode.padEnd(6)} | ${String(tr.trades).padStart(5)} ${(tr.avgR ?? 0).toFixed(3).padStart(6)} ${(tr.profitFactor ?? 0).toFixed(2).padStart(5)} | ` +
        `${String(te.trades).padStart(5)} ${(te.avgR ?? 0).toFixed(3).padStart(6)} ${(te.profitFactor ?? 0).toFixed(2).padStart(5)}  | ${trust}`,
      );
    }
  }
  console.log("\nDoes a reversal-candle confirm lift the mean-reversion zone's edge while");
  console.log("keeping TEST trades >= ~15? Compare each 'bar'/'win3' row to its 'none' row.");
}

main();
