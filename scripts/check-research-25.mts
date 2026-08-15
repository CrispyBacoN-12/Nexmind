// Direct validation of research-25 ("DI-Cross, no ADX filter") EXACTLY as specified
// in obsidian-vault/Strategies/DI-Cross (no ADX filter) (25).md:
//   entry only on the DI CROSS bar itself (not "DI dominance held"), no ADX gate,
//   no gap/widening filter, SL=1.5xATR, TP=1.2xATR.
// The existing sweep-di-dominance-gld.mts models continuous dominance (optionally
// gap-widening-gated) which is a DIFFERENT, more frequent signal than a true cross
// event -- this script implements the literal cross-only rule for an honest verdict.
//
// Usage: npx tsx scripts/check-research-25.mts [symbol] [range]

import "dotenv/config";
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { backtestCandles, summarizeBacktest, DEFAULT_COST_MODEL } from "../src/lib/backtest/engine";
import type { Candle } from "../src/lib/indicators";

const SYMBOL = process.argv[2] ?? "GC=F";
const RANGE = (process.argv[3] ?? "2y") as "2y" | "5y" | "max";
const TP_MULT = 1.2; // research-25's stated TP=1.2xATR (SL fixed at 1.5xATR by the engine)

function crossSignal(
  _bars: Candle[],
  snaps: ReturnType<typeof computeSnapshots>,
  i: number,
): "long" | "short" | null {
  if (i < 1) return null;
  const s = snaps[i], p = snaps[i - 1];
  if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null) return null;
  if (p.plusDI <= p.minusDI && s.plusDI > s.minusDI) return "long";
  if (p.plusDI >= p.minusDI && s.plusDI < s.minusDI) return "short";
  return null;
}

function evalWindow(bars: Candle[], snaps: ReturnType<typeof computeSnapshots>) {
  const entry = (i: number) => crossSignal(bars, snaps, i);
  const res = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, TP_MULT, DEFAULT_COST_MODEL);
  return summarizeBacktest(res.trades);
}

async function main() {
  const resp = await fetchCandles(SYMBOL, RANGE, "1h");
  const bars = resp.candles;
  const first = new Date(bars[0].t * 1000).toISOString().slice(0, 10);
  const last = new Date(bars[bars.length - 1].t * 1000).toISOString().slice(0, 10);
  console.log(`research-25 literal cross-only check on ${SYMBOL} 1h: ${bars.length} bars, ${first} -> ${last}\n`);

  const splitIdx = Math.floor(bars.length * 0.65);
  const trainBars = bars.slice(0, splitIdx);
  const testBars = bars.slice(splitIdx);
  const trainSnaps = computeSnapshots(trainBars);
  const testSnaps = computeSnapshots(testBars);

  const train = evalWindow(trainBars, trainSnaps);
  const test = evalWindow(testBars, testSnaps);
  const full = evalWindow(bars, computeSnapshots(bars));

  console.log(`TRAIN (${trainBars.length} bars, first 65%): trades=${train.trades} avgR=${(train.avgR ?? 0).toFixed(3)} PF=${(train.profitFactor ?? 0).toFixed(2)} win%=${train.winRate.toFixed(1)}`);
  console.log(`TEST  (${testBars.length} bars, last 35%, OOS): trades=${test.trades} avgR=${(test.avgR ?? 0).toFixed(3)} PF=${(test.profitFactor ?? 0).toFixed(2)} win%=${test.winRate.toFixed(1)}`);
  console.log(`FULL  (${bars.length} bars): trades=${full.trades} avgR=${(full.avgR ?? 0).toFixed(3)} PF=${(full.profitFactor ?? 0).toFixed(2)} win%=${full.winRate.toFixed(1)}`);

  const passTrain = train.trades >= 20 && (train.avgR ?? 0) > 0 && (train.profitFactor ?? 0) > 1.05;
  const passTest = test.trades >= 15 && (test.avgR ?? 0) > 0 && (test.profitFactor ?? 0) > 1.0;
  console.log(`\nVerdict: TRAIN ${passTrain ? "PASS" : "FAIL"} (need trades>=20, avgR>0, PF>1.05), TEST ${passTest ? "PASS" : "FAIL"} (need trades>=15, avgR>0, PF>1.0) -> ${passTrain && passTest ? "ROBUST" : "NOT ROBUST"}`);
}

main();
