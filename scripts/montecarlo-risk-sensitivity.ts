// For each desk where the stress test showed P(breach halt) near 100%, sweep
// riskPctPerTrade downward to find what sizing brings breach probability to a
// sane tail-risk level (~5-10%), so the recommendation to the user is a
// concrete number, not just "lower it".
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";
import { monteCarloBootstrap } from "../src/lib/backtest/montecarlo";

const TP1_MULT = 1.2;
const MC_ITERATIONS = 2000;

interface Spec { label: string; code: string; symbols: string[]; interval: "1h"; range: "2y"; haltPct: number; }

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
    symbols: ["GC=F"], interval: "1h", range: "2y", haltPct: 10,
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
    symbols: ["GC=F"], interval: "1h", range: "2y", haltPct: 10,
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
    symbols: ["BTC-USD", "BNB-USD"], interval: "1h", range: "2y", haltPct: 25,
  },
];

const RISK_LEVELS = [1, 0.75, 0.5, 0.35, 0.25, 0.15, 0.1];

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
    console.log(`\n=== ${spec.label} - halt=${spec.haltPct}% - ${allR.length} historical trades ===`);
    for (const risk of RISK_LEVELS) {
      const summary = monteCarloBootstrap(allR, { startingBalance: 10000, riskPctPerTrade: risk, iterations: MC_ITERATIONS });
      const breach = summary.probBreach(spec.haltPct) * 100;
      console.log(
        `  risk=${risk}%  P(breach ${spec.haltPct}% halt)=${breach.toFixed(1).padStart(5)}%  ` +
        `medianDD=${summary.maxDrawdownPct.p50.toFixed(1)}%  p95DD=${summary.maxDrawdownPct.p95.toFixed(1)}%  ` +
        `medianReturn=${summary.finalReturnPct.p50.toFixed(1)}%`
      );
    }
  }
}

main();
