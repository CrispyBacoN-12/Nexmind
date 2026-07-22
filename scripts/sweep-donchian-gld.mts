// Parameter sweep + out-of-sample validation for the Donchian+ADX breakout
// mechanism (the one candidate from the 8-round research loop with any real
// in-sample edge on gold). Runs on Alpaca's deep GLD 1h history instead of
// Yahoo's shallow 2y GC=F feed, so the sample is big enough to tell a genuine
// broad edge from a lucky single point.
//
// Method:
//   1. Load ~5y of GLD 1h bars.
//   2. Split chronologically: TRAIN = first 65%, TEST = last 35% (never touched
//      while ranking). Snapshots are computed once per window (they don't depend
//      on the swept params) and reused across every combo.
//   3. Sweep lookback / ADX gate / ADX-rising / volume-confirm / TP multiple.
//   4. Keep combos that clear a real bar on TRAIN (trades>=20, avgR>0, PF>1.05),
//      then print their TEST metrics beside the train ones.
//   5. The overfit signal is the drop-off: how many combos pass train, how many
//      of THOSE also pass test, and whether the train leaders survive.
//
// Uses the same evaluation contract the research pipeline uses: singleTarget,
// DEFAULT_COST_MODEL (0.5bp slippage + 1bp commission), lot 0.1, SL fixed at
// 1.5xATR by the engine.
//
// Usage: npx tsx scripts/sweep-donchian-gld.mts

import "dotenv/config";
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { backtestCandles, summarizeBacktest, DEFAULT_COST_MODEL } from "../src/lib/backtest/engine";
import type { Candle } from "../src/lib/indicators";

const SYMBOL = "GLD"; // gold ETF, Alpaca-served (GC=F futures aren't on Alpaca's stock feed)

interface Params {
  lookback: number;
  adxGate: number;
  requireAdxRising: boolean;
  requireVol: boolean;
  tp1Mult: number;
}

// Donchian channel breakout + ADX trend gate + DI/SMA direction agreement.
// Same shape as research-100; lookback/adxGate/requireAdxRising/requireVol are
// the swept knobs. buffer (0.15xATR) and maxExtension (1.75xATR) stay fixed —
// they define the mechanism rather than tune it.
function donchianSignal(
  bars: Candle[],
  snaps: ReturnType<typeof computeSnapshots>,
  i: number,
  p: Params,
): "long" | "short" | null {
  if (i < p.lookback + 2) return null;
  let hh = -Infinity, ll = Infinity, volSum = 0;
  for (let k = i - p.lookback; k < i; k++) {
    if (bars[k].h > hh) hh = bars[k].h;
    if (bars[k].l < ll) ll = bars[k].l;
    volSum += bars[k].v;
  }
  const avgVol = volSum / p.lookback;
  const cur = bars[i], prevBar = bars[i - 1];
  const s = snaps[i], sPrev = snaps[i - 1], sPrev2 = snaps[i - 2];
  if (!s || !sPrev || !sPrev2) return null;
  if (s.adx == null || s.atr == null || s.plusDI == null || s.minusDI == null || s.sma20 == null || s.sma50 == null) return null;
  if (sPrev.adx == null || sPrev2.adx == null) return null;

  if (s.adx < p.adxGate) return null;
  if (p.requireAdxRising && (s.adx <= sPrev.adx || sPrev.adx <= sPrev2.adx)) return null;

  const buffer = 0.15 * s.atr;
  const maxExt = 1.75 * s.atr;
  const volOk = !p.requireVol || (avgVol > 0 && cur.v > avgVol);

  const longSig = cur.c > hh + buffer && prevBar.c <= hh
    && s.plusDI > s.minusDI && s.sma20 > s.sma50
    && (cur.c - hh) < maxExt && volOk;
  const shortSig = cur.c < ll - buffer && prevBar.c >= ll
    && s.minusDI > s.plusDI && s.sma20 < s.sma50
    && (ll - cur.c) < maxExt && volOk;

  if (longSig) return "long";
  if (shortSig) return "short";
  return null;
}

function evalWindow(bars: Candle[], snaps: ReturnType<typeof computeSnapshots>, p: Params) {
  const entry = (i: number) => donchianSignal(bars, snaps, i, p);
  const res = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, p.tp1Mult, DEFAULT_COST_MODEL);
  return summarizeBacktest(res.trades);
}

function paramLabel(p: Params): string {
  return `lb=${String(p.lookback).padStart(2)} adx>=${p.adxGate} ${p.requireAdxRising ? "rising" : "any   "} ${p.requireVol ? "vol " : "novol"} tp=${p.tp1Mult.toFixed(1)}`;
}

async function main() {
  const resp = await fetchCandles(SYMBOL, "5y", "1h");
  const bars = resp.candles;
  const first = new Date(bars[0].t * 1000).toISOString().slice(0, 10);
  const last = new Date(bars[bars.length - 1].t * 1000).toISOString().slice(0, 10);
  console.log(`${SYMBOL} 1h: ${bars.length} bars, ${first} -> ${last}\n`);

  const splitIdx = Math.floor(bars.length * 0.65);
  const trainBars = bars.slice(0, splitIdx);
  const testBars = bars.slice(splitIdx);
  const trainSnaps = computeSnapshots(trainBars);
  const testSnaps = computeSnapshots(testBars);
  console.log(`TRAIN: ${trainBars.length} bars (first 65%)   TEST: ${testBars.length} bars (last 35%, out-of-sample)\n`);

  const grid: Params[] = [];
  for (const lookback of [10, 20, 30, 40])
    for (const adxGate of [15, 20, 25])
      for (const requireAdxRising of [true, false])
        for (const requireVol of [false, true])
          for (const tp1Mult of [1.0, 1.2, 1.5, 2.0])
            grid.push({ lookback, adxGate, requireAdxRising, requireVol, tp1Mult });

  // Train bar: a real edge, not a lucky handful of trades.
  const passTrain = (m: ReturnType<typeof summarizeBacktest>) =>
    m.trades >= 20 && (m.avgR ?? 0) > 0 && (m.profitFactor ?? 0) > 1.05;
  // Test bar: survives out-of-sample with an adequate sample.
  const passTest = (m: ReturnType<typeof summarizeBacktest>) =>
    m.trades >= 15 && (m.avgR ?? 0) > 0 && (m.profitFactor ?? 0) > 1.0;

  // Evaluate every combo on both windows up front so we can separate the two
  // failure modes: "not enough signals" vs "signals but no edge".
  const all = grid.map((p) => ({ p, train: evalWindow(trainBars, trainSnaps, p), test: evalWindow(testBars, testSnaps, p) }));

  const trainEnoughTrades = all.filter((a) => a.train.trades >= 20);
  const trainProfitable = trainEnoughTrades.filter((a) => (a.train.avgR ?? 0) > 0);
  const bestTrainAvgR = Math.max(...all.map((a) => a.train.avgR ?? -99));
  const testEnough = all.filter((a) => a.test.trades >= 15);
  const bestTestAvgR = testEnough.length ? Math.max(...testEnough.map((a) => a.test.avgR ?? -99)) : NaN;
  console.log("Diagnostic (why combos fail):");
  console.log(`  combos with TRAIN trades>=20:        ${trainEnoughTrades.length}/${grid.length}`);
  console.log(`  of those, avgR>0 (any edge at all):  ${trainProfitable.length}`);
  console.log(`  best TRAIN avgR across all combos:   ${bestTrainAvgR.toFixed(3)}`);
  console.log(`  best TEST  avgR (combos, test>=15):  ${Number.isFinite(bestTestAvgR) ? bestTestAvgR.toFixed(3) : "n/a"}\n`);

  const survivors = all.filter((a) => passTrain(a.train));
  const trainPassCount = survivors.length;

  console.log(`Swept ${grid.length} param combos.`);
  console.log(`${trainPassCount} passed the TRAIN bar (trades>=20, avgR>0, PF>1.05).`);
  const robust = survivors.filter((s) => passTest(s.test));
  console.log(`${robust.length} of those ALSO passed the TEST bar (trades>=15, avgR>0, PF>1.0).\n`);

  // Show all train-passers ranked by TEST avgR, so overfit (train-only) combos
  // sink to the bottom with negative test numbers.
  survivors.sort((a, b) => (b.test.avgR ?? -99) - (a.test.avgR ?? -99));
  console.log("params                                    | TRAIN  trades  avgR    PF   win% | TEST   trades  avgR    PF   win%  | robust");
  console.log("-".repeat(122));
  for (const s of survivors) {
    const tr = s.train, te = s.test;
    const row =
      `${paramLabel(s.p)} | ` +
      `${String(tr.trades).padStart(6)} ${(tr.avgR ?? 0).toFixed(3).padStart(6)} ${(tr.profitFactor ?? 0).toFixed(2).padStart(5)} ${tr.winRate.toFixed(0).padStart(4)} | ` +
      `${String(te.trades).padStart(6)} ${(te.avgR ?? 0).toFixed(3).padStart(6)} ${(te.profitFactor ?? 0).toFixed(2).padStart(5)} ${te.winRate.toFixed(0).padStart(4)}  | ` +
      `${passTest(te) ? "YES" : ""}`;
    console.log(row);
  }
}

main();
