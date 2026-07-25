// "Market flow" mechanisms vs the MACD+trend baseline, on GC=F 1h.
//
// Two families the user asked to compare:
//   MARKET STRUCTURE (price-only): break-of-structure off swing pivots. A swing
//     high/low is a fractal pivot confirmed k bars later (no lookahead). BOS =
//     close breaks the last confirmed swing high (long) / low (short). Tested raw
//     and trend-filtered.
//   MONEY / VOLUME FLOW: CMF (Chaikin Money Flow) sign and OBV (On-Balance
//     Volume) slope, each combined with the price trend. Computed inline from raw
//     bars. Uses GC=F futures volume (24h, more complete than IEX/ETF feeds).
//
// True order flow (bid/ask delta, CVD, footprint) is NOT here — it needs tick /
// L2 data we don't have; deriving it from candles would be fiction.
//
// Same discipline as the rest of the pass: train/test split, trade counts shown
// (watch for the small-sample + inverted-split traps), TP=2.0xATR, SL 1.5xATR,
// DEFAULT_COST_MODEL, singleTarget.
//
// Usage: npx tsx scripts/flow-structure-money-gcf.mts [symbol] [range]

import "dotenv/config";
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { backtestCandles, summarizeBacktest, DEFAULT_COST_MODEL } from "../src/lib/backtest/engine";
import type { Candle } from "../src/lib/indicators";

const SYMBOL = process.argv[2] ?? "GC=F";
const RANGE = (process.argv[3] ?? "2y") as "2y" | "5y" | "max";
const TP = 2.0;
const SWING_K = 5;   // fractal half-width
const CMF_N = 20;
const OBV_SLOPE_N = 20;
type Snaps = ReturnType<typeof computeSnapshots>;
type Side = "long" | "short";

interface Flow {
  lastSH: (number | null)[];
  lastSL: (number | null)[];
  obv: number[];
  cmf: (number | null)[];
}

function computeFlow(bars: Candle[]): Flow {
  const n = bars.length;
  const lastSH: (number | null)[] = new Array(n).fill(null);
  const lastSL: (number | null)[] = new Array(n).fill(null);
  let curSH: number | null = null, curSL: number | null = null;
  for (let i = 0; i < n; i++) {
    const j = i - SWING_K; // confirm a pivot at j (needs SWING_K bars on each side)
    if (j >= SWING_K) {
      let isHigh = true, isLow = true;
      for (let m = j - SWING_K; m <= j + SWING_K; m++) {
        if (m === j) continue;
        if (bars[m].h >= bars[j].h) isHigh = false;
        if (bars[m].l <= bars[j].l) isLow = false;
      }
      if (isHigh) curSH = bars[j].h;
      if (isLow) curSL = bars[j].l;
    }
    lastSH[i] = curSH;
    lastSL[i] = curSL;
  }

  const obv: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const d = bars[i].c > bars[i - 1].c ? bars[i].v : bars[i].c < bars[i - 1].c ? -bars[i].v : 0;
    obv[i] = obv[i - 1] + d;
  }

  const cmf: (number | null)[] = new Array(n).fill(null);
  for (let i = CMF_N - 1; i < n; i++) {
    let mfv = 0, vol = 0;
    for (let m = i - CMF_N + 1; m <= i; m++) {
      const b = bars[m];
      const range = b.h - b.l;
      if (range > 0) mfv += (((b.c - b.l) - (b.h - b.c)) / range) * b.v;
      vol += b.v;
    }
    cmf[i] = vol > 0 ? mfv / vol : null;
  }
  return { lastSH, lastSL, obv, cmf };
}

const up = (s: Snaps, i: number) => s[i]?.sma20 != null && s[i]!.sma20! > s[i]!.sma50!;
const down = (s: Snaps, i: number) => s[i]?.sma20 != null && s[i]!.sma20! < s[i]!.sma50!;

type Rule = (bars: Candle[], s: Snaps, f: Flow, i: number) => Side | null;

const RULES: [string, Rule][] = [
  ["MACD+trend+widen (baseline)", (b, s, f, i) => {
    if (i < 1) return null;
    const c = s[i], p = s[i - 1];
    if (!c || !p || c.plusDI == null || c.minusDI == null || p.plusDI == null || p.minusDI == null) return null;
    if (c.macdHist == null || c.sma20 == null || c.sma50 == null) return null;
    if (Math.abs(c.plusDI - c.minusDI) <= Math.abs(p.plusDI - p.minusDI)) return null;
    if (c.macdHist > 0 && c.sma20 > c.sma50) return "long";
    if (c.macdHist < 0 && c.sma20 < c.sma50) return "short";
    return null;
  }],
  ["BOS raw (break of structure) ", (b, _s, f, i) => {
    if (i < 1) return null;
    const sh = f.lastSH[i], sl = f.lastSL[i];
    if (sh != null && b[i].c > sh && b[i - 1].c <= sh) return "long";
    if (sl != null && b[i].c < sl && b[i - 1].c >= sl) return "short";
    return null;
  }],
  ["BOS + trend filter          ", (b, s, f, i) => {
    if (i < 1) return null;
    const sh = f.lastSH[i], sl = f.lastSL[i];
    if (sh != null && b[i].c > sh && b[i - 1].c <= sh && up(s, i)) return "long";
    if (sl != null && b[i].c < sl && b[i - 1].c >= sl && down(s, i)) return "short";
    return null;
  }],
  ["CMF sign + trend            ", (_b, s, f, i) => {
    const c = f.cmf[i];
    if (c == null) return null;
    if (c > 0 && up(s, i)) return "long";
    if (c < 0 && down(s, i)) return "short";
    return null;
  }],
  ["OBV slope + trend           ", (_b, s, f, i) => {
    if (i < OBV_SLOPE_N) return null;
    const rising = f.obv[i] > f.obv[i - OBV_SLOPE_N];
    const falling = f.obv[i] < f.obv[i - OBV_SLOPE_N];
    if (rising && up(s, i)) return "long";
    if (falling && down(s, i)) return "short";
    return null;
  }],
];

function evalRule(bars: Candle[], snaps: Snaps, flow: Flow, rule: Rule) {
  const entry = (i: number) => rule(bars, snaps, flow, i);
  const res = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, TP, DEFAULT_COST_MODEL);
  return summarizeBacktest(res.trades);
}

async function main() {
  const resp = await fetchCandles(SYMBOL, RANGE, "1h");
  const bars = resp.candles;
  console.log(`${SYMBOL} 1h: ${bars.length} bars, ${new Date(bars[0].t * 1000).toISOString().slice(0, 10)} -> ${new Date(bars.at(-1)!.t * 1000).toISOString().slice(0, 10)}\n`);

  const splitIdx = Math.floor(bars.length * 0.65);
  const trainBars = bars.slice(0, splitIdx), testBars = bars.slice(splitIdx);
  const trainSnaps = computeSnapshots(trainBars), testSnaps = computeSnapshots(testBars);
  const trainFlow = computeFlow(trainBars), testFlow = computeFlow(testBars);
  console.log(`TRAIN ${trainBars.length} bars  TEST ${testBars.length} bars (OOS)\n`);

  console.log("rule                          | TRAIN trades avgR   PF   | TEST trades avgR   PF    | verdict");
  console.log("-".repeat(100));
  for (const [name, rule] of RULES) {
    const tr = evalRule(trainBars, trainSnaps, trainFlow, rule);
    const te = evalRule(testBars, testSnaps, testFlow, rule);
    const bothPos = (tr.avgR ?? -9) > 0 && (te.avgR ?? -9) > 0;
    const verdict = te.trades < 15 ? "too few OOS trades" :
      bothPos && (te.profitFactor ?? 0) > 1.0 ? "POSITIVE both halves" :
      (te.avgR ?? -9) > 0 ? "OOS+ but train- (inverted/fluke)" : "negative";
    console.log(
      `${name} | ${String(tr.trades).padStart(5)} ${(tr.avgR ?? 0).toFixed(3).padStart(6)} ${(tr.profitFactor ?? 0).toFixed(2).padStart(5)} | ` +
      `${String(te.trades).padStart(5)} ${(te.avgR ?? 0).toFixed(3).padStart(6)} ${(te.profitFactor ?? 0).toFixed(2).padStart(5)}  | ${verdict}`,
    );
  }
  console.log("\nTrustworthy = POSITIVE both halves with TEST trades >= ~15 (matches the MACD+trend bar).");
}

main();
