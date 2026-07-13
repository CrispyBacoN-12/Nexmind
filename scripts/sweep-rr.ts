// Second-order experiment: singleTarget mode raised win% but tanked total P/L on
// high-sample concepts (capping upside on trades that used to run to the far
// target). Hypothesis: 2.5xATR-target vs 1.5xATR-stop is itself a tough bar to
// clear >50% of the time regardless of ladder mode — a tighter reward:risk (TP
// closer to SL distance) should push win% higher. This bypasses engine.ts
// entirely (own minimal single-target SL/TP race) so multiple R:R ratios can be
// swept fast without further touching the shared engine until one is validated.
// Usage: npx tsx scripts/sweep-rr.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import type { Candle } from "@/lib/indicators";

const SYMBOL = "GC=F";
const RANGES: Array<{ range: "3mo" | "1y"; interval: "1h" }> = [
  { range: "3mo", interval: "1h" },
  { range: "1y", interval: "1h" },
];
const SL_MULT = 1.5; // keep SL distance same as the live desk
const TP_MULTS = [1.0, 1.2, 1.5, 2.0, 2.5]; // sweep TP distance relative to ATR

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
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long", note: "DI gap widening" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short", note: "DI gap widening" };
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
if (s.plusDI > s.minusDI && s.price > s.sma20 && s.sma20 > s.sma50 && s.macdHist > p.macdHist && s.macdHist > 0) {
  return { side: "long", note: "strong trend rider" };
}
if (s.minusDI > s.plusDI && s.price < s.sma20 && s.sma20 < s.sma50 && s.macdHist < p.macdHist && s.macdHist < 0) {
  return { side: "short", note: "strong trend rider" };
}
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
if (s.plusDI > s.minusDI && s.price > s.sma50) return { side: "long", note: "fresh ADX ignition" };
if (s.minusDI > s.plusDI && s.price < s.sma50) return { side: "short", note: "fresh ADX ignition" };
return null;
`,
  },
  {
    label: "RSI-Cross-Back Range Fade",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.rsi == null || p.rsi == null) return null;
if (s.adx > 20) return null;
if (p.rsi < 30 && s.rsi >= 30) return { side: "long", note: "RSI crossed back above 30" };
if (p.rsi > 70 && s.rsi <= 70) return { side: "short", note: "RSI crossed back below 70" };
return null;
`,
  },
];

function race(bars: Candle[], startIdx: number, side: "long" | "short", entry: number, atrVal: number, tpMult: number) {
  const dir = side === "long" ? 1 : -1;
  const sl = entry - dir * SL_MULT * atrVal;
  const tp = entry + dir * tpMult * atrVal;
  for (let j = startIdx + 1; j < bars.length; j++) {
    const bar = bars[j];
    const adverse = side === "long" ? bar.l : bar.h;
    const favorable = side === "long" ? bar.h : bar.l;
    const hitSl = side === "long" ? adverse <= sl : adverse >= sl;
    const hitTp = side === "long" ? favorable >= tp : favorable <= tp;
    if (hitSl) return { outcome: "loss" as const, pnl: -SL_MULT, closedAt: j };
    if (hitTp) return { outcome: "win" as const, pnl: tpMult, closedAt: j };
  }
  return null; // still open at series end — excluded
}

async function main() {
  for (const { range, interval } of RANGES) {
    const resp = await fetchCandles(SYMBOL, range, interval);
    const bars = resp.candles;
    const snaps = computeSnapshots(bars);
    console.log(`\n===== ${SYMBOL} ${interval}/${range} (${bars.length} bars) =====`);
    for (const c of CANDIDATES) {
      const compiled = compileStrategy(c.code);
      for (const tpMult of TP_MULTS) {
        let wins = 0, losses = 0, totalR = 0;
        let i = 60;
        while (i < bars.length) {
          const sig = compiled.invoke(bars, snaps, i)?.side ?? null;
          if (!sig) { i++; continue; }
          const a = snaps[i].atr ?? bars[i].c * 0.005;
          const res = race(bars, i, sig, bars[i].c, a, tpMult);
          if (!res) break; // ran off the end, stop
          if (res.outcome === "win") wins++; else losses++;
          totalR += res.pnl;
          i = res.closedAt + 1; // one position at a time, mirrors backtestCandles
        }
        const n = wins + losses;
        const winRate = n ? (wins / n) * 100 : 0;
        const expR = n ? totalR / n : 0;
        console.log(
          `${c.label.padEnd(28)} R:R=1.5:${tpMult.toFixed(1)}  trades=${String(n).padStart(4)}  win%=${winRate.toFixed(0).padStart(3)}  expR=${expR.toFixed(3).padStart(7)}  totalR=${totalR.toFixed(1).padStart(7)}`
        );
      }
    }
  }
}

main();
