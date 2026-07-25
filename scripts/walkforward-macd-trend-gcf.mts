// Walk-forward of the rule the weighted-score sweep actually discovered, vs the
// retuned DI-only baseline, on GC=F 1h 2y across 6 sequential blocks.
//
// The weighted sweep's top combos all collapsed to ONE effective rule (weights
// were degenerate given MACD/trend are +/-1 signs): enter in the direction where
// MACD-histogram sign and SMA20-vs-SMA50 trend AGREE, gated by DI-gap widening,
// TP=2.0xATR. It beat the DI-only baseline on the single OOS split (TEST avgR
// 0.124 vs 0.047). This checks whether that edge is temporally stable or -- like
// the DI-dominance edge before it -- concentrated in one lucky window.
//
// Usage: npx tsx scripts/walkforward-macd-trend-gcf.mts

import "dotenv/config";
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { backtestCandles, summarizeBacktest, DEFAULT_COST_MODEL } from "../src/lib/backtest/engine";
import type { Candle } from "../src/lib/indicators";

const SYMBOL = process.argv[2] ?? "GC=F";
const RANGE = (process.argv[3] ?? "2y") as "2y" | "5y" | "max";
const N_BLOCKS = 6;
const TP = 2.0;
type Snaps = ReturnType<typeof computeSnapshots>;

// Discovered rule: MACD sign + SMA trend agree, DI gap widening.
function macdTrendSignal(snaps: Snaps, i: number): "long" | "short" | null {
  if (i < 1) return null;
  const s = snaps[i], prev = snaps[i - 1];
  if (!s || !prev) return null;
  if (s.plusDI == null || s.minusDI == null || prev.plusDI == null || prev.minusDI == null) return null;
  if (s.macdHist == null || s.sma20 == null || s.sma50 == null) return null;
  const gap = Math.abs(s.plusDI - s.minusDI);
  const pGap = Math.abs(prev.plusDI - prev.minusDI);
  if (gap <= pGap) return null; // DI-gap widening gate
  const macdUp = s.macdHist > 0, macdDown = s.macdHist < 0;
  const trendUp = s.sma20 > s.sma50, trendDown = s.sma20 < s.sma50;
  if (macdUp && trendUp) return "long";
  if (macdDown && trendDown) return "short";
  return null;
}

// Baseline: retuned DI-only (adx-off, widen, gap>=2, tp=2.0).
function diBaselineSignal(snaps: Snaps, i: number): "long" | "short" | null {
  if (i < 1) return null;
  const s = snaps[i], prev = snaps[i - 1];
  if (!s || !prev) return null;
  if (s.plusDI == null || s.minusDI == null || prev.plusDI == null || prev.minusDI == null) return null;
  const gap = Math.abs(s.plusDI - s.minusDI);
  const pGap = Math.abs(prev.plusDI - prev.minusDI);
  if (gap < 2 || gap <= pGap) return null;
  if (s.plusDI > s.minusDI) return "long";
  if (s.minusDI > s.plusDI) return "short";
  return null;
}

function evalBlock(bars: Candle[], sig: (snaps: Snaps, i: number) => "long" | "short" | null) {
  const snaps = computeSnapshots(bars);
  const res = backtestCandles(SYMBOL, bars, 0.1, undefined, (i) => sig(snaps, i), true, TP, DEFAULT_COST_MODEL);
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

  for (const [name, sig] of [
    ["DISCOVERED  MACD+trend agree, DI widening ", macdTrendSignal],
    ["BASELINE    retuned DI-only               ", diBaselineSignal],
  ] as const) {
    const per = blocks.map((bl) => evalBlock(bl, sig));
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
