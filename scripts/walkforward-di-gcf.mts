// Walk-forward validation of the RE-TUNED DI-Dominance params on GC=F 1h.
//
// The sweep (scripts/sweep-di-dominance-gld.mts on GC=F 2y) surfaced a robust
// region: low/no ADX gate + gap widening + tp=1.5. But those params were picked
// BY looking at the test set, so their single-split OOS number is optimistically
// biased. Walk-forward re-checks the SAME fixed params across N sequential
// time blocks the selection never optimized on -- if the thin edge is stable it
// stays positive in most blocks; if it came from one lucky stretch, it won't.
//
// Compares the re-tuned candidates against the params the approved strategies
// actually use (research-30: adx>=20; research-22: adx>=25) so the "re-tune
// helps" claim is measured, not assumed.
//
// Usage: npx tsx scripts/walkforward-di-gcf.mts

import "dotenv/config";
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { backtestCandles, summarizeBacktest, DEFAULT_COST_MODEL } from "../src/lib/backtest/engine";
import type { Candle } from "../src/lib/indicators";

const SYMBOL = "GC=F";
const N_BLOCKS = 6;

interface Params {
  name: string;
  adxGate: number; // 0 = off
  requireWidening: boolean;
  minGap: number;
  tp1Mult: number;
}

const CANDIDATES: Params[] = [
  // Re-tuned (robust region from the sweep)
  { name: "RETUNED  adx-off  widen gap>=0 tp=1.5", adxGate: 0, requireWidening: true, minGap: 0, tp1Mult: 1.5 },
  { name: "RETUNED  adx>=15  widen gap>=0 tp=1.5", adxGate: 15, requireWidening: true, minGap: 0, tp1Mult: 1.5 },
  { name: "RETUNED  adx-off  widen gap>=2 tp=2.0", adxGate: 0, requireWidening: true, minGap: 2, tp1Mult: 2.0 },
  // Approved-as-is (for comparison)
  { name: "APPROVED research-30 adx>=20 tp=1.2   ", adxGate: 20, requireWidening: true, minGap: 0, tp1Mult: 1.2 },
  { name: "APPROVED research-22 adx>=25 tp=1.2   ", adxGate: 25, requireWidening: true, minGap: 0, tp1Mult: 1.2 },
];

function diSignal(snaps: ReturnType<typeof computeSnapshots>, i: number, p: Params): "long" | "short" | null {
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

function evalBlock(bars: Candle[], p: Params) {
  const snaps = computeSnapshots(bars);
  const entry = (i: number) => diSignal(snaps, i, p);
  const res = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, p.tp1Mult, DEFAULT_COST_MODEL);
  return summarizeBacktest(res.trades);
}

async function main() {
  const resp = await fetchCandles(SYMBOL, "2y", "1h");
  const bars = resp.candles;
  const first = new Date(bars[0].t * 1000).toISOString().slice(0, 10);
  const last = new Date(bars[bars.length - 1].t * 1000).toISOString().slice(0, 10);
  console.log(`${SYMBOL} 1h: ${bars.length} bars, ${first} -> ${last}`);
  console.log(`Walk-forward: ${N_BLOCKS} sequential blocks (~${Math.round(bars.length / N_BLOCKS)} bars each)\n`);

  const blockSize = Math.floor(bars.length / N_BLOCKS);
  const blocks: Candle[][] = [];
  for (let b = 0; b < N_BLOCKS; b++) {
    const start = b * blockSize;
    const end = b === N_BLOCKS - 1 ? bars.length : start + blockSize;
    blocks.push(bars.slice(start, end));
  }
  const blockDates = blocks.map((bl) => new Date(bl[0].t * 1000).toISOString().slice(0, 7));

  for (const p of CANDIDATES) {
    const perBlock = blocks.map((bl) => evalBlock(bl, p));
    const posBlocks = perBlock.filter((m) => (m.avgR ?? -1) > 0 && m.trades >= 8).length;
    const usableBlocks = perBlock.filter((m) => m.trades >= 8).length;
    const cells = perBlock.map((m, idx) => {
      const tag = m.trades < 8 ? "  thin " : (m.avgR ?? -1) > 0 ? "+" : "-";
      return `${blockDates[idx]} ${String(m.trades).padStart(3)}t ${((m.avgR ?? 0)).toFixed(2).padStart(5)}R${tag === "+" || tag === "-" ? tag : ""}`;
    });
    console.log(p.name);
    console.log(`  ${cells.join(" | ")}`);
    console.log(`  -> positive in ${posBlocks}/${usableBlocks} usable blocks\n`);
  }
}

main();
