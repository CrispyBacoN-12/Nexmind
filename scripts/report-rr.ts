// Reports the actual $ risk/reward and R:R per trade for the 3 candidates
// dispatched in research run #8, at the fixed lot=0.1 used in that backtest,
// plus the average ATR-in-dollars so the RR ratio and $ per trade are concrete
// (not just "1.5x ATR" in the abstract).
// Usage: npx tsx scripts/report-rr.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const LOT = 0.1;
const SL_MULT = 1.5;
const TP_MULT = 1.2;

const CANDIDATES: Array<{ label: string; code: string }> = [
  {
    label: "DI-Dominance Continuation",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 25) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long", note: "x" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short", note: "x" };
return null;
`,
  },
  {
    label: "Strong-Trend Rider",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.plusDI == null || s.minusDI == null || s.sma20 == null || s.sma50 == null || s.macdHist == null || p.macdHist == null || s.price == null) return null;
if (s.adx < 28 || s.adx <= p.adx) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
if (gap < 10) return null;
if (s.plusDI > s.minusDI && s.price > s.sma20 && s.sma20 > s.sma50 && s.macdHist > p.macdHist && s.macdHist > 0) return { side: "long", note: "x" };
if (s.minusDI > s.plusDI && s.price < s.sma20 && s.sma20 < s.sma50 && s.macdHist < p.macdHist && s.macdHist < 0) return { side: "short", note: "x" };
return null;
`,
  },
  {
    label: "ADX-Ignition Breakout",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.plusDI == null || s.minusDI == null || s.sma50 == null || s.price == null) return null;
if (p.adx >= 25 || s.adx < 25) return null;
if (s.plusDI > s.minusDI && s.price > s.sma50) return { side: "long", note: "x" };
if (s.minusDI > s.plusDI && s.price < s.sma50) return { side: "short", note: "x" };
return null;
`,
  },
];

async function main() {
  const resp = await fetchCandles(SYMBOL, "1y", "1h");
  const bars = resp.candles;
  const snaps = computeSnapshots(bars);

  for (const c of CANDIDATES) {
    const compiled = compileStrategy(c.code);
    const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
    const bt = backtestCandles(SYMBOL, bars, LOT, undefined, entry, true, TP_MULT);

    const atrs = bt.trades.map((t) => Math.abs(t.entry - t.sl) / SL_MULT);
    const avgAtr = atrs.reduce((s, a) => s + a, 0) / atrs.length;
    const riskUsd = avgAtr * SL_MULT * LOT;
    const rewardUsd = avgAtr * TP_MULT * LOT;

    console.log(`${c.label}`);
    console.log(`  trades=${bt.trades.length}  avg ATR=$${avgAtr.toFixed(2)}/oz`);
    console.log(`  SL dist = ${SL_MULT}x ATR = $${(avgAtr * SL_MULT).toFixed(2)}/oz  ->  risk/trade @ ${LOT} lot = $${riskUsd.toFixed(2)}`);
    console.log(`  TP dist = ${TP_MULT}x ATR = $${(avgAtr * TP_MULT).toFixed(2)}/oz  ->  reward/trade @ ${LOT} lot = $${rewardUsd.toFixed(2)}`);
    console.log(`  R:R (risk:reward) = ${SL_MULT}:${TP_MULT} = ${(SL_MULT / TP_MULT).toFixed(2)}:1  (i.e. reward:risk = ${(TP_MULT / SL_MULT).toFixed(2)}:1)`);
    console.log();
  }
}

main();
