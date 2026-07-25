// Walk-forward of BOS+trend (break-of-structure off swing pivots, trend-filtered)
// vs the MACD+trend baseline, on GC=F 1h 2y across 6 sequential blocks.
//
// BOS+trend was the one "market flow" rule that passed the single train/test
// split positive in both halves (TEST PF 1.24 on 106 trades, beating MACD+trend
// 1.11). This checks it's stable across time, not one lucky test window -- the
// same bar MACD+trend had to clear. Also shows whether the two are additive
// (win in different blocks) or redundant (same blocks).
//
// Usage: npx tsx scripts/walkforward-bos-trend-gcf.mts [symbol] [range]

import "dotenv/config";
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { backtestCandles, summarizeBacktest, DEFAULT_COST_MODEL } from "../src/lib/backtest/engine";
import type { Candle } from "../src/lib/indicators";

const SYMBOL = process.argv[2] ?? "GC=F";
const RANGE = (process.argv[3] ?? "2y") as "2y" | "5y" | "max";
const N_BLOCKS = 6;
const TP = 2.0;
const SWING_K = 5;
type Snaps = ReturnType<typeof computeSnapshots>;
type Side = "long" | "short";

function swings(bars: Candle[]) {
  const n = bars.length;
  const lastSH: (number | null)[] = new Array(n).fill(null);
  const lastSL: (number | null)[] = new Array(n).fill(null);
  let curSH: number | null = null, curSL: number | null = null;
  for (let i = 0; i < n; i++) {
    const j = i - SWING_K;
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
    lastSH[i] = curSH; lastSL[i] = curSL;
  }
  return { lastSH, lastSL };
}

function bosTrend(bars: Candle[], s: Snaps, sw: ReturnType<typeof swings>, i: number): Side | null {
  if (i < 1) return null;
  const c = s[i];
  if (!c || c.sma20 == null || c.sma50 == null) return null;
  const sh = sw.lastSH[i], sl = sw.lastSL[i];
  if (sh != null && bars[i].c > sh && bars[i - 1].c <= sh && c.sma20 > c.sma50) return "long";
  if (sl != null && bars[i].c < sl && bars[i - 1].c >= sl && c.sma20 < c.sma50) return "short";
  return null;
}

function macdTrend(s: Snaps, i: number): Side | null {
  if (i < 1) return null;
  const c = s[i], p = s[i - 1];
  if (!c || !p || c.plusDI == null || c.minusDI == null || p.plusDI == null || p.minusDI == null) return null;
  if (c.macdHist == null || c.sma20 == null || c.sma50 == null) return null;
  if (Math.abs(c.plusDI - c.minusDI) <= Math.abs(p.plusDI - p.minusDI)) return null;
  if (c.macdHist > 0 && c.sma20 > c.sma50) return "long";
  if (c.macdHist < 0 && c.sma20 < c.sma50) return "short";
  return null;
}

function evalBlock(bars: Candle[], entry: (i: number) => Side | null) {
  const res = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, TP, DEFAULT_COST_MODEL);
  return summarizeBacktest(res.trades);
}

async function main() {
  const resp = await fetchCandles(SYMBOL, RANGE, "1h");
  const bars = resp.candles;
  console.log(`${SYMBOL} 1h: ${bars.length} bars, ${new Date(bars[0].t * 1000).toISOString().slice(0, 10)} -> ${new Date(bars.at(-1)!.t * 1000).toISOString().slice(0, 10)}`);
  console.log(`Walk-forward: ${N_BLOCKS} sequential blocks\n`);

  const blockSize = Math.floor(bars.length / N_BLOCKS);
  const blocks: Candle[][] = [];
  for (let b = 0; b < N_BLOCKS; b++) {
    const start = b * blockSize;
    blocks.push(bars.slice(start, b === N_BLOCKS - 1 ? bars.length : start + blockSize));
  }
  const dates = blocks.map((bl) => new Date(bl[0].t * 1000).toISOString().slice(0, 7));

  const runners: [string, (bars: Candle[], s: Snaps, i: number) => Side | null][] = [
    ["BOS+trend (market structure)", (bl, s, i) => bosTrend(bl, s, swings(bl), i)],
    ["MACD+trend (baseline)       ", (_bl, s, i) => macdTrend(s, i)],
  ];

  for (const [name, fn] of runners) {
    const per = blocks.map((bl) => {
      const s = computeSnapshots(bl);
      return evalBlock(bl, (i) => fn(bl, s, i));
    });
    const usable = per.filter((m) => m.trades >= 8);
    const pos = usable.filter((m) => (m.avgR ?? -1) > 0).length;
    const cells = per.map((m, idx) => {
      const t = m.trades < 8 ? "thin" : (m.avgR ?? -1) > 0 ? "+" : "-";
      return `${dates[idx]} ${String(m.trades).padStart(3)}t ${(m.avgR ?? 0).toFixed(2).padStart(5)}R${t === "thin" ? "?" : t}`;
    });
    console.log(name);
    console.log(`  ${cells.join(" | ")}`);
    console.log(`  -> positive in ${pos}/${usable.length} usable blocks\n`);
  }
}

main();
