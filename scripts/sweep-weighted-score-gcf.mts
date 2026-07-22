// Weighted-indicator score model vs the retuned DI-only baseline, on GC=F 1h.
//
// Idea (user's): instead of hard AND-gates (ADX>x AND +DI>-DI AND gap widening),
// give each indicator a WEIGHT, sum them into a signed directional score, and
// enter long/short when the score crosses a threshold. More expressive -- can
// fire on "strong on 3 of 4 signals" instead of demanding all.
//
// The honest risk: weights are extra free parameters, so a weighted model will
// ALWAYS look better in-sample. The only meaningful question is whether the best
// weighted combo BEATS the simple retuned DI-only model OUT-OF-SAMPLE. This
// script prints that comparison directly: the baseline's train/test numbers are
// the bar every weighted combo must clear on the untouched test window.
//
// Score = wDI*diContrib + wRSI*rsiContrib + wMACD*macdContrib + wTrend*trendContrib
// where each contrib is a signed value in ~[-1,1]. Enter long if score>=thr,
// short if score<=-thr. TP fixed at 2.0xATR (the retuned winner) so the sweep
// isolates the weighting question rather than re-sweeping the exit.
//
// Usage: npx tsx scripts/sweep-weighted-score-gcf.mts

import "dotenv/config";
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { backtestCandles, summarizeBacktest, DEFAULT_COST_MODEL } from "../src/lib/backtest/engine";
import type { Candle } from "../src/lib/indicators";

const SYMBOL = "GC=F";
const RANGE = "2y" as const;
const TP = 2.0;

type Snaps = ReturnType<typeof computeSnapshots>;

interface WParams {
  wDI: number; wRSI: number; wMACD: number; wTrend: number;
  adxFloor: number; requireWidening: boolean; thr: number;
}

const tanh = (x: number) => Math.tanh(x);

function weightedSignal(snaps: Snaps, i: number, p: WParams): "long" | "short" | null {
  if (i < 1) return null;
  const s = snaps[i], prev = snaps[i - 1];
  if (!s || !prev) return null;
  if (s.plusDI == null || s.minusDI == null || prev.plusDI == null || prev.minusDI == null) return null;
  if (s.adx == null || s.rsi == null || s.macdHist == null || s.sma20 == null || s.sma50 == null) return null;
  if (p.adxFloor > 0 && s.adx < p.adxFloor) return null;
  if (p.requireWidening) {
    const gap = Math.abs(s.plusDI - s.minusDI);
    const pGap = Math.abs(prev.plusDI - prev.minusDI);
    if (gap <= pGap) return null;
  }

  const diContrib = tanh((s.plusDI - s.minusDI) / 10);
  const rsiContrib = tanh((s.rsi - 50) / 15);
  const macdContrib = s.macdHist > 0 ? 1 : s.macdHist < 0 ? -1 : 0;
  const trendContrib = s.sma20 > s.sma50 ? 1 : s.sma20 < s.sma50 ? -1 : 0;

  const score = p.wDI * diContrib + p.wRSI * rsiContrib + p.wMACD * macdContrib + p.wTrend * trendContrib;
  if (score >= p.thr) return "long";
  if (score <= -p.thr) return "short";
  return null;
}

// Retuned DI-only baseline (from the proposal): adx-off, gap widening, gap>=2, tp=2.0.
function baselineSignal(snaps: Snaps, i: number): "long" | "short" | null {
  if (i < 1) return null;
  const s = snaps[i], prev = snaps[i - 1];
  if (!s || !prev) return null;
  if (s.plusDI == null || s.minusDI == null || prev.plusDI == null || prev.minusDI == null) return null;
  const gap = Math.abs(s.plusDI - s.minusDI);
  const pGap = Math.abs(prev.plusDI - prev.minusDI);
  if (gap < 2) return null;
  if (gap <= pGap) return null;
  if (s.plusDI > s.minusDI) return "long";
  if (s.minusDI > s.plusDI) return "short";
  return null;
}

function evalWindow(bars: Candle[], snaps: Snaps, sig: (i: number) => "long" | "short" | null) {
  const res = backtestCandles(SYMBOL, bars, 0.1, undefined, sig, true, TP, DEFAULT_COST_MODEL);
  return summarizeBacktest(res.trades);
}

function wLabel(p: WParams): string {
  return `DI${p.wDI} RSI${p.wRSI} MACD${p.wMACD} TR${p.wTrend} adx${p.adxFloor === 0 ? "off" : ">=" + p.adxFloor} ${p.requireWidening ? "widen" : "any  "} thr${p.thr.toFixed(1)}`;
}

async function main() {
  const resp = await fetchCandles(SYMBOL, RANGE, "1h");
  const bars = resp.candles;
  console.log(`${SYMBOL} 1h: ${bars.length} bars, ${new Date(bars[0].t * 1000).toISOString().slice(0, 10)} -> ${new Date(bars.at(-1)!.t * 1000).toISOString().slice(0, 10)}\n`);

  const splitIdx = Math.floor(bars.length * 0.65);
  const trainBars = bars.slice(0, splitIdx), testBars = bars.slice(splitIdx);
  const trainSnaps = computeSnapshots(trainBars), testSnaps = computeSnapshots(testBars);
  console.log(`TRAIN ${trainBars.length} bars  TEST ${testBars.length} bars (OOS)\n`);

  // Baseline: the bar to beat.
  const bTrain = evalWindow(trainBars, trainSnaps, (i) => baselineSignal(trainSnaps, i));
  const bTest = evalWindow(testBars, testSnaps, (i) => baselineSignal(testSnaps, i));
  console.log("BASELINE  retuned DI-only (adx-off widen gap>=2 tp=2.0):");
  console.log(`  TRAIN trades=${bTrain.trades} avgR=${(bTrain.avgR ?? 0).toFixed(3)} PF=${(bTrain.profitFactor ?? 0).toFixed(2)} win=${bTrain.winRate.toFixed(0)}%`);
  console.log(`  TEST  trades=${bTest.trades} avgR=${(bTest.avgR ?? 0).toFixed(3)} PF=${(bTest.profitFactor ?? 0).toFixed(2)} win=${bTest.winRate.toFixed(0)}%\n`);

  const grid: WParams[] = [];
  const weights = [0, 1, 2];
  for (const wDI of weights) for (const wRSI of weights) for (const wMACD of weights) for (const wTrend of weights) {
    if (wDI + wRSI + wMACD + wTrend === 0) continue;
    for (const adxFloor of [0, 15]) for (const requireWidening of [false, true]) for (const thr of [0.5, 1.0, 2.0])
      grid.push({ wDI, wRSI, wMACD, wTrend, adxFloor, requireWidening, thr });
  }

  const all = grid.map((p) => ({
    p,
    train: evalWindow(trainBars, trainSnaps, (i) => weightedSignal(trainSnaps, i, p)),
    test: evalWindow(testBars, testSnaps, (i) => weightedSignal(testSnaps, i, p)),
  }));

  // A weighted combo is interesting only if it clears a real bar in-sample AND
  // beats the baseline's TEST avgR out-of-sample with an adequate sample.
  const beatsBaseline = all.filter((a) =>
    a.train.trades >= 20 && (a.train.avgR ?? 0) > 0 && (a.train.profitFactor ?? 0) > 1.05 &&
    a.test.trades >= 15 && (a.test.avgR ?? -9) > (bTest.avgR ?? 0) && (a.test.profitFactor ?? 0) > 1.0,
  );

  const trainPass = all.filter((a) => a.train.trades >= 20 && (a.train.avgR ?? 0) > 0 && (a.train.profitFactor ?? 0) > 1.05);
  console.log(`Swept ${grid.length} weighted combos.`);
  console.log(`${trainPass.length} passed the TRAIN bar.`);
  console.log(`${beatsBaseline.length} of those ALSO beat the baseline's TEST avgR (${(bTest.avgR ?? 0).toFixed(3)}) out-of-sample.\n`);

  // Show the top 15 train-passers ranked by TEST avgR, baseline marked inline.
  trainPass.sort((a, b) => (b.test.avgR ?? -99) - (a.test.avgR ?? -99));
  console.log("weighted params                                            | TRAIN avgR  PF  | TEST trades avgR   PF   | beats base");
  console.log("-".repeat(112));
  for (const a of trainPass.slice(0, 15)) {
    const beat = (a.test.avgR ?? -9) > (bTest.avgR ?? 0) && a.test.trades >= 15 && (a.test.profitFactor ?? 0) > 1.0;
    console.log(
      `${wLabel(a.p)} | ${(a.train.avgR ?? 0).toFixed(3).padStart(6)} ${(a.train.profitFactor ?? 0).toFixed(2).padStart(4)} | ` +
      `${String(a.test.trades).padStart(5)} ${(a.test.avgR ?? 0).toFixed(3).padStart(6)} ${(a.test.profitFactor ?? 0).toFixed(2).padStart(4)}  | ${beat ? "YES" : ""}`,
    );
  }
  console.log(`\n(baseline TEST avgR to beat: ${(bTest.avgR ?? 0).toFixed(3)}, PF ${(bTest.profitFactor ?? 0).toFixed(2)})`);
}

main();
