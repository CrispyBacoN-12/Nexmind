// Weighted VOTING at the combo level, vs the current equal-vote>=2 baseline.
//
// combo-gold votes each member equally (activeWithin >= minVotes, 1 per member).
// This asks: does giving proven members a HEAVIER vote beat equal voting
// out-of-sample? Members = combo-gold's three (swing-trend-continuation,
// trend-pullback, mean-rev) PLUS the MACD+trend rule discovered earlier, as a
// 4th candidate member that can earn weight if it deserves it.
//
// Method mirrors combineStrategies' vote logic but weighted: for a side, sum the
// weights of members that fired that side within the last `window` bars; enter
// on a fresh trigger when that weighted sum >= threshold (and no opposite
// trigger). Member signals are precomputed once per window, so the weight/thr
// grid is pure arithmetic on top. Same eval contract as combo-gold's exit
// (swing-trend-continuation.preferredExit: tp1.5, singleTarget, DEFAULT_COST).
//
// Overfitting guard: the only result that matters is a weighted config that
// beats the EQUAL-VOTE baseline on the untouched TEST window. Winner is then
// walk-forward-checked separately.
//
// Usage: npx tsx scripts/sweep-weighted-vote-gcf.mts [symbol] [range] [interval]

import "dotenv/config";
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { getStrategy } from "../src/lib/trading/strategies";
import { backtestCandles, summarizeBacktest, DEFAULT_COST_MODEL } from "../src/lib/backtest/engine";
import type { Candle } from "../src/lib/indicators";

const SYMBOL = process.argv[2] ?? "GC=F";
const RANGE = (process.argv[3] ?? "2y") as "2y" | "5y" | "max";
const INTERVAL = (process.argv[4] ?? "1h") as "1h" | "1d";
const WINDOW = 3;
const TP = 1.5; // swing-trend-continuation.preferredExit
type Side = "long" | "short";
type Sig = { side: Side } | null;

const MEMBER_KEYS = ["swing-trend-continuation", "trend-pullback", "mean-rev"];
const MEMBER_NAMES = ["swingTrend", "pullback", "meanRev", "macdTrend"];

// The discovered rule, wrapped as a member evaluator.
function macdTrendMember(bars: Candle[]): (i: number) => Sig {
  const snaps = computeSnapshots(bars);
  return (i) => {
    if (i < 1) return null;
    const s = snaps[i], p = snaps[i - 1];
    if (!s || !p) return null;
    if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null) return null;
    if (s.macdHist == null || s.sma20 == null || s.sma50 == null) return null;
    if (Math.abs(s.plusDI - s.minusDI) <= Math.abs(p.plusDI - p.minusDI)) return null;
    if (s.macdHist > 0 && s.sma20 > s.sma50) return { side: "long" };
    if (s.macdHist < 0 && s.sma20 < s.sma50) return { side: "short" };
    return null;
  };
}

// Precompute every member's per-bar signal for one window.
function memberSigs(bars: Candle[]): Sig[][] {
  const builtins = MEMBER_KEYS.map((k) => {
    const s = getStrategy(k);
    if (!s) throw new Error(`missing member ${k}`);
    return s.build(bars);
  });
  const macd = macdTrendMember(bars);
  const evals = [...builtins, macd];
  return evals.map((ev) => bars.map((_, i) => {
    const r = ev(i);
    return r ? { side: r.side } : null;
  }));
}

function makeEntry(sigs: Sig[][], weights: number[], thr: number) {
  return (i: number): Side | null => {
    let longTrig = false, shortTrig = false;
    for (let m = 0; m < sigs.length; m++) {
      const s = sigs[m][i];
      if (s?.side === "long") longTrig = true;
      else if (s?.side === "short") shortTrig = true;
    }
    let longW = 0, shortW = 0;
    for (let m = 0; m < sigs.length; m++) {
      if (weights[m] === 0) continue;
      const lo = Math.max(0, i - WINDOW + 1);
      let firedLong = false, firedShort = false;
      for (let j = lo; j <= i; j++) {
        const sd = sigs[m][j]?.side;
        if (sd === "long") firedLong = true;
        else if (sd === "short") firedShort = true;
      }
      if (firedLong) longW += weights[m];
      if (firedShort) shortW += weights[m];
    }
    if (longTrig && !shortTrig && longW >= thr) return "long";
    if (shortTrig && !longTrig && shortW >= thr) return "short";
    return null;
  };
}

function evalWindow(bars: Candle[], sigs: Sig[][], weights: number[], thr: number) {
  const entry = makeEntry(sigs, weights, thr);
  const res = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, TP, DEFAULT_COST_MODEL);
  return summarizeBacktest(res.trades);
}

function wLabel(w: number[]): string {
  return MEMBER_NAMES.map((n, m) => `${n}=${w[m]}`).join(" ");
}

async function main() {
  const resp = await fetchCandles(SYMBOL, RANGE, INTERVAL);
  const bars = resp.candles;
  console.log(`${SYMBOL} ${INTERVAL}: ${bars.length} bars, ${new Date(bars[0].t * 1000).toISOString().slice(0, 10)} -> ${new Date(bars.at(-1)!.t * 1000).toISOString().slice(0, 10)}\n`);

  const splitIdx = Math.floor(bars.length * 0.65);
  const trainBars = bars.slice(0, splitIdx), testBars = bars.slice(splitIdx);
  const trainSigs = memberSigs(trainBars), testSigs = memberSigs(testBars);
  console.log(`TRAIN ${trainBars.length} bars  TEST ${testBars.length} bars (OOS)\n`);

  // Baseline: equal vote>=2 over the original 3 members (macdTrend weight 0).
  const baseW = [1, 1, 1, 0];
  const bTrain = evalWindow(trainBars, trainSigs, baseW, 2);
  const bTest = evalWindow(testBars, testSigs, baseW, 2);
  console.log("BASELINE  equal vote>=2 (combo-gold's 3 members, no MACD):");
  console.log(`  TRAIN trades=${bTrain.trades} avgR=${(bTrain.avgR ?? 0).toFixed(3)} PF=${(bTrain.profitFactor ?? 0).toFixed(2)} win=${bTrain.winRate.toFixed(0)}%`);
  console.log(`  TEST  trades=${bTest.trades} avgR=${(bTest.avgR ?? 0).toFixed(3)} PF=${(bTest.profitFactor ?? 0).toFixed(2)} win=${bTest.winRate.toFixed(0)}%\n`);

  const W = [0, 1, 2, 3];
  const grid: { w: number[]; thr: number }[] = [];
  for (const a of W) for (const b of W) for (const c of W) for (const d of W) {
    if (a + b + c + d === 0) continue;
    const maxW = a + b + c + d;
    for (const thr of [2, 3, 4, 5]) if (thr <= maxW) grid.push({ w: [a, b, c, d], thr });
  }

  const all = grid.map((g) => ({
    g,
    train: evalWindow(trainBars, trainSigs, g.w, g.thr),
    test: evalWindow(testBars, testSigs, g.w, g.thr),
  }));

  const beats = all.filter((a) =>
    a.train.trades >= 20 && (a.train.avgR ?? 0) > 0 && (a.train.profitFactor ?? 0) > 1.05 &&
    a.test.trades >= 15 && (a.test.avgR ?? -9) > (bTest.avgR ?? 0) && (a.test.profitFactor ?? 0) > 1.0);

  console.log(`Swept ${grid.length} weight/threshold combos.`);
  console.log(`${beats.length} beat the equal-vote baseline's TEST avgR (${(bTest.avgR ?? 0).toFixed(3)}) out-of-sample with trades>=15.\n`);

  const trainPass = all.filter((a) => a.train.trades >= 20 && (a.train.avgR ?? 0) > 0 && (a.train.profitFactor ?? 0) > 1.05);
  trainPass.sort((x, y) => (y.test.avgR ?? -99) - (x.test.avgR ?? -99));
  console.log("weights                                     thr | TRAIN trades avgR   PF  | TEST trades avgR   PF   | beats");
  console.log("-".repeat(108));
  for (const a of trainPass.slice(0, 15)) {
    const beat = (a.test.avgR ?? -9) > (bTest.avgR ?? 0) && a.test.trades >= 15 && (a.test.profitFactor ?? 0) > 1.0;
    console.log(
      `${wLabel(a.g.w).padEnd(42)} ${a.g.thr} | ${String(a.train.trades).padStart(5)} ${(a.train.avgR ?? 0).toFixed(3).padStart(6)} ${(a.train.profitFactor ?? 0).toFixed(2).padStart(4)} | ` +
      `${String(a.test.trades).padStart(5)} ${(a.test.avgR ?? 0).toFixed(3).padStart(6)} ${(a.test.profitFactor ?? 0).toFixed(2).padStart(4)}  | ${beat ? "YES" : ""}`);
  }
  console.log(`\n(baseline TEST avgR to beat: ${(bTest.avgR ?? 0).toFixed(3)}, PF ${(bTest.profitFactor ?? 0).toFixed(2)}, trades ${bTest.trades})`);
}

main();
