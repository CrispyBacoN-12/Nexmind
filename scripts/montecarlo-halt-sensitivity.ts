// User chose to keep riskPctPerTrade unchanged and instead widen
// drawdownHaltPct so it reflects a genuine tail event (~5% breach
// probability) instead of the near-certainty the current halt showed.
// For each desk, find the halt level where P(breach) ~= 5% under bootstrap.
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";
import { monteCarloBootstrap } from "../src/lib/backtest/montecarlo";

const TP1_MULT = 1.2;
const MC_ITERATIONS = 4000;

interface Spec { label: string; code: string; symbols: string[]; interval: "1h"; range: "2y"; riskPct: number; currentHalt: number; }

const SPECS: Spec[] = [
  {
    label: "#8 Gold Desk (research-31)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.macdHist == null || p.macdHist == null || s.sma20 == null || s.sma50 == null) return null;
if (p.macdHist <= 0 && s.macdHist > 0 && s.sma20 > s.sma50) return { side: "long" };
if (p.macdHist >= 0 && s.macdHist < 0 && s.sma20 < s.sma50) return { side: "short" };
return null;
`,
    symbols: ["GC=F"], interval: "1h", range: "2y", riskPct: 1, currentHalt: 10,
  },
  {
    label: "#13 Gold Trend Desk (research-30)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 20) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short" };
return null;
`,
    symbols: ["GC=F"], interval: "1h", range: "2y", riskPct: 1, currentHalt: 10,
  },
  {
    label: "#9 Bitcoin Desk (research-27)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.rsi == null || p.rsi == null || s.sma50 == null || s.price == null) return null;
if (s.adx < 20) return null;
if (p.rsi <= 50 && s.rsi > 50 && s.price > s.sma50) return { side: "long" };
if (p.rsi >= 50 && s.rsi < 50 && s.price < s.sma50) return { side: "short" };
return null;
`,
    symbols: ["BTC-USD", "BNB-USD"], interval: "1h", range: "2y", riskPct: 2, currentHalt: 25,
  },
];

function findHaltForTargetBreach(dds: number[], targetBreachFrac: number): number {
  // dds should be an ascending-sorted array already (percentile-style lookup).
  const idx = Math.min(dds.length - 1, Math.max(0, Math.round((1 - targetBreachFrac) * (dds.length - 1))));
  return dds[idx];
}

async function main() {
  for (const spec of SPECS) {
    const compiled = compileStrategy(spec.code);
    const allR: number[] = [];
    for (const symbol of spec.symbols) {
      const resp = await fetchCandles(symbol, spec.range, spec.interval);
      const bars = resp.candles;
      const snaps = computeSnapshots(bars);
      const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
      const result = backtestCandles(symbol, bars, 0.1, undefined, entry, true, TP1_MULT);
      allR.push(...result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null));
    }
    const summary = monteCarloBootstrap(allR, { startingBalance: 10000, riskPctPerTrade: spec.riskPct, iterations: MC_ITERATIONS });

    console.log(`\n=== ${spec.label} - risk kept at ${spec.riskPct}% - current halt=${spec.currentHalt}% ===`);
    console.log(`  Current halt breach prob: ${(summary.probBreach(spec.currentHalt) * 100).toFixed(1)}%`);
    for (const target of [0.1, 0.05, 0.02]) {
      // Reconstruct sorted dds from percentile lookups isn't exposed directly;
      // binary-search probBreach instead since it's monotonic in the threshold.
      let lo = 0, hi = 100;
      for (let iter = 0; iter < 40; iter++) {
        const mid = (lo + hi) / 2;
        if (summary.probBreach(mid) > target) lo = mid; else hi = mid;
      }
      console.log(`  Halt for ~${(target * 100).toFixed(0)}% breach prob: ${hi.toFixed(1)}%`);
    }
    console.log(`  For reference: median DD=${summary.maxDrawdownPct.p50.toFixed(1)}%  p95 DD=${summary.maxDrawdownPct.p95.toFixed(1)}%  worst DD=${summary.maxDrawdownPct.worst.toFixed(1)}%`);
    console.log(`  Median return/yr at this risk: ${summary.finalReturnPct.p50.toFixed(1)}%  (p5=${summary.finalReturnPct.p5.toFixed(1)}%, worst=${summary.finalReturnPct.worst.toFixed(1)}%)`);
  }
}

main();
