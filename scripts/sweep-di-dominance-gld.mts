// Parameter sweep + out-of-sample validation for the DI-Dominance family --
// the mechanism behind most of NEXMIND's 15 approved strategies (research-22,
// 25, 26, 30 and relatives). Those were validated on Yahoo's shallow 2y GC=F
// 1h feed. This re-tests the whole param neighborhood on Alpaca's deep 5y GLD
// 1h history to see whether the approved edge is real and broad, or -- like the
// Donchian family -- a small-sample fluke.
//
// DI-Dominance mechanism (from research-30/22): ADX gate, direction set by
// whichever DI dominates, trigger when the |+DI - -DI| gap widens vs the prior
// bar. Swept: ADX gate (incl. "off"), require-widening on/off, minimum gap,
// TP multiple. Same eval contract as the research pipeline (singleTarget,
// DEFAULT_COST_MODEL, lot 0.1, SL fixed 1.5xATR).
//
// Usage: npx tsx scripts/sweep-di-dominance-gld.mts

import "dotenv/config";
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { backtestCandles, summarizeBacktest, DEFAULT_COST_MODEL } from "../src/lib/backtest/engine";
import type { Candle } from "../src/lib/indicators";

// Symbol + range come from argv so the same sweep can validate the approved
// family on its own instrument (GC=F 2y via Yahoo, ~24h bars) as well as on
// Alpaca's deep GLD history. Usage: ... [symbol] [range]
const SYMBOL = process.argv[2] ?? "GLD";
const RANGE = (process.argv[3] ?? "5y") as "2y" | "5y" | "max";

interface Params {
  adxGate: number; // 0 = no ADX filter (research-25 style)
  requireWidening: boolean;
  minGap: number; // minimum |+DI - -DI| to act on
  tp1Mult: number;
}

function diSignal(
  _bars: Candle[],
  snaps: ReturnType<typeof computeSnapshots>,
  i: number,
  p: Params,
): "long" | "short" | null {
  if (i < 1) return null;
  const s = snaps[i], prev = snaps[i - 1];
  if (!s || !prev) return null;
  if (s.plusDI == null || s.minusDI == null || prev.plusDI == null || prev.minusDI == null || s.adx == null) return null;
  if (p.adxGate > 0 && s.adx < p.adxGate) return null;

  const gap = Math.abs(s.plusDI - s.minusDI);
  const pGap = Math.abs(prev.plusDI - prev.minusDI);
  if (gap < p.minGap) return null;
  if (p.requireWidening && gap <= pGap) return null;

  if (s.plusDI > s.minusDI) return "long";
  if (s.minusDI > s.plusDI) return "short";
  return null;
}

function evalWindow(bars: Candle[], snaps: ReturnType<typeof computeSnapshots>, p: Params) {
  const entry = (i: number) => diSignal(bars, snaps, i, p);
  const res = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, p.tp1Mult, DEFAULT_COST_MODEL);
  return summarizeBacktest(res.trades);
}

function paramLabel(p: Params): string {
  return `adx${p.adxGate === 0 ? ">off" : ">=" + p.adxGate} ${p.requireWidening ? "widen" : "any  "} gap>=${p.minGap} tp=${p.tp1Mult.toFixed(1)}`;
}

async function main() {
  const resp = await fetchCandles(SYMBOL, RANGE, "1h");
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
  for (const adxGate of [0, 15, 20, 25, 30])
    for (const requireWidening of [true, false])
      for (const minGap of [0, 2, 5])
        for (const tp1Mult of [1.0, 1.2, 1.5, 2.0])
          grid.push({ adxGate, requireWidening, minGap, tp1Mult });

  const passTrain = (m: ReturnType<typeof summarizeBacktest>) =>
    m.trades >= 20 && (m.avgR ?? 0) > 0 && (m.profitFactor ?? 0) > 1.05;
  const passTest = (m: ReturnType<typeof summarizeBacktest>) =>
    m.trades >= 15 && (m.avgR ?? 0) > 0 && (m.profitFactor ?? 0) > 1.0;

  const all = grid.map((p) => ({ p, train: evalWindow(trainBars, trainSnaps, p), test: evalWindow(testBars, testSnaps, p) }));

  const trainEnough = all.filter((a) => a.train.trades >= 20);
  const trainProfitable = trainEnough.filter((a) => (a.train.avgR ?? 0) > 0);
  const bestTrainAvgR = Math.max(...all.map((a) => a.train.avgR ?? -99));
  const testEnough = all.filter((a) => a.test.trades >= 15);
  const bestTestAvgR = testEnough.length ? Math.max(...testEnough.map((a) => a.test.avgR ?? -99)) : NaN;
  console.log("Diagnostic (why combos fail):");
  console.log(`  combos with TRAIN trades>=20:        ${trainEnough.length}/${grid.length}`);
  console.log(`  of those, avgR>0 (any edge at all):  ${trainProfitable.length}`);
  console.log(`  best TRAIN avgR across all combos:   ${bestTrainAvgR.toFixed(3)}`);
  console.log(`  best TEST  avgR (combos, test>=15):  ${Number.isFinite(bestTestAvgR) ? bestTestAvgR.toFixed(3) : "n/a"}\n`);

  const survivors = all.filter((a) => passTrain(a.train));
  console.log(`Swept ${grid.length} param combos.`);
  console.log(`${survivors.length} passed the TRAIN bar (trades>=20, avgR>0, PF>1.05).`);
  const robust = survivors.filter((s) => passTest(s.test));
  console.log(`${robust.length} of those ALSO passed the TEST bar (trades>=15, avgR>0, PF>1.0).\n`);

  survivors.sort((a, b) => (b.test.avgR ?? -99) - (a.test.avgR ?? -99));
  console.log("params                              | TRAIN  trades  avgR    PF   win% | TEST   trades  avgR    PF   win%  | robust");
  console.log("-".repeat(116));
  for (const s of survivors) {
    const tr = s.train, te = s.test;
    console.log(
      `${paramLabel(s.p)} | ` +
      `${String(tr.trades).padStart(6)} ${(tr.avgR ?? 0).toFixed(3).padStart(6)} ${(tr.profitFactor ?? 0).toFixed(2).padStart(5)} ${tr.winRate.toFixed(0).padStart(4)} | ` +
      `${String(te.trades).padStart(6)} ${(te.avgR ?? 0).toFixed(3).padStart(6)} ${(te.profitFactor ?? 0).toFixed(2).padStart(5)} ${te.winRate.toFixed(0).padStart(4)}  | ` +
      `${passTest(te) ? "YES" : ""}`,
    );
  }
}

main();
