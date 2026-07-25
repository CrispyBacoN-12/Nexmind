// Regime filters on top of the MACD+trend base, walk-forward on GC=F 1h.
//
// Both trend mechanisms found this session (MACD+trend, BOS+trend) lose the SAME
// 2024-11 block -> the weak point is a regime, not the entry. A regime filter
// stands aside when conditions are unfavorable. Tested filters are principled a
// priori (not sweep-picked), to avoid overfitting a filter that merely "doesn't
// trade Nov 2024":
//   - ADX>=X          : trend strength
//   - Kaufman ER>=X   : trend cleanliness (net move / path length) vs chop
//   - sma50 rising    : higher-timeframe trend alignment
//   - ATR band        : avoid dead-calm and blow-off vol
//
// Honest bar: a filter earns its keep only if it helps CONSISTENTLY across the
// walk-forward (more positive blocks and/or a better worst block) while keeping
// trades adequate — not if it only patches the one adverse block. TP=2.0xATR,
// DEFAULT_COST_MODEL, singleTarget.
//
// Usage: npx tsx scripts/regime-filter-macd-trend-gcf.mts [symbol] [range]

import "dotenv/config";
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { backtestCandles, summarizeBacktest, DEFAULT_COST_MODEL } from "../src/lib/backtest/engine";
import type { Candle } from "../src/lib/indicators";

const SYMBOL = process.argv[2] ?? "GC=F";
const RANGE = (process.argv[3] ?? "2y") as "2y" | "5y" | "max";
const N_BLOCKS = 6;
const TP = 2.0;
const ER_N = 20;
type Snaps = ReturnType<typeof computeSnapshots>;
type Side = "long" | "short";

// Base entry: MACD sign + SMA trend agree, DI-gap widening.
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

// Kaufman efficiency ratio over ER_N bars: |net| / sum|step|. ~1 = clean trend, ~0 = chop.
function efficiencyRatio(bars: Candle[], i: number): number | null {
  if (i < ER_N) return null;
  const net = Math.abs(bars[i].c - bars[i - ER_N].c);
  let path = 0;
  for (let k = i - ER_N + 1; k <= i; k++) path += Math.abs(bars[k].c - bars[k - 1].c);
  return path > 0 ? net / path : null;
}

interface Regime { name: string; ok: (bars: Candle[], s: Snaps, i: number, side: Side) => boolean }
const REGIMES: Regime[] = [
  { name: "none (base)      ", ok: () => true },
  { name: "ADX>=20          ", ok: (_b, s, i) => (s[i]?.adx ?? 0) >= 20 },
  { name: "ADX>=25          ", ok: (_b, s, i) => (s[i]?.adx ?? 0) >= 25 },
  { name: "ER>=0.30         ", ok: (b, _s, i) => (efficiencyRatio(b, i) ?? 0) >= 0.30 },
  { name: "ER>=0.40         ", ok: (b, _s, i) => (efficiencyRatio(b, i) ?? 0) >= 0.40 },
  { name: "sma50 rising/fall", ok: (_b, s, i, side) => {
    if (i < 10 || s[i]?.sma50 == null || s[i - 10]?.sma50 == null) return false;
    const slopeUp = s[i]!.sma50! > s[i - 10]!.sma50!;
    return side === "long" ? slopeUp : !slopeUp;
  } },
  { name: "ATR band (0.5-2x) ", ok: (_b, s, i) => {
    const atr = s[i]?.atr, price = s[i]?.sma20;
    if (atr == null || price == null || price === 0) return false;
    const pct = atr / price; // avoid dead-calm (<0.15%) and blow-off (>0.6%)
    return pct >= 0.0015 && pct <= 0.006;
  } },
];

function evalBlock(bars: Candle[], s: Snaps, regime: Regime) {
  const entry = (i: number): Side | null => {
    const side = macdTrend(s, i);
    if (!side) return null;
    return regime.ok(bars, s, i, side) ? side : null;
  };
  const res = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, TP, DEFAULT_COST_MODEL);
  return summarizeBacktest(res.trades);
}

async function main() {
  const resp = await fetchCandles(SYMBOL, RANGE, "1h");
  const bars = resp.candles;
  console.log(`${SYMBOL} 1h: ${bars.length} bars, ${new Date(bars[0].t * 1000).toISOString().slice(0, 10)} -> ${new Date(bars.at(-1)!.t * 1000).toISOString().slice(0, 10)}`);
  console.log(`Walk-forward: ${N_BLOCKS} blocks\n`);

  const blockSize = Math.floor(bars.length / N_BLOCKS);
  const blocks: Candle[][] = [];
  for (let b = 0; b < N_BLOCKS; b++) {
    const start = b * blockSize;
    blocks.push(bars.slice(start, b === N_BLOCKS - 1 ? bars.length : start + blockSize));
  }
  const dates = blocks.map((bl) => new Date(bl[0].t * 1000).toISOString().slice(0, 7));
  const snapsPerBlock = blocks.map((bl) => computeSnapshots(bl));

  console.log("regime            | " + dates.map((d) => d.padEnd(11)).join("| ") + "|  pos  totR");
  console.log("-".repeat(120));
  for (const regime of REGIMES) {
    const per = blocks.map((bl, idx) => evalBlock(bl, snapsPerBlock[idx], regime));
    const usable = per.filter((m) => m.trades >= 8);
    const pos = usable.filter((m) => (m.avgR ?? -1) > 0).length;
    const totR = per.reduce((s, m) => s + (m.avgR ?? 0) * m.trades, 0);
    const cells = per.map((m) => {
      const tag = m.trades < 8 ? "?" : (m.avgR ?? -1) > 0 ? "+" : "-";
      return `${String(m.trades).padStart(3)}t ${(m.avgR ?? 0).toFixed(2).padStart(5)}${tag}`;
    });
    console.log(`${regime.name} | ${cells.map((c) => c.padEnd(11)).join("| ")}| ${pos}/${usable.length}  ${totR.toFixed(1).padStart(6)}`);
  }
  console.log("\ntotR = sum of avgR*trades across blocks (total R captured). A good regime filter");
  console.log("lifts pos-blocks AND totR vs 'none', not just patches one block. Watch trade counts.");
}

main();
