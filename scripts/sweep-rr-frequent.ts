// Follow-up to sweep-frequent.ts / dispatch-frequent-run.ts (run #9). User asked:
// can we push R:R higher, and how would we adjust the strategy to do it?
//
// R:R is currently fixed by the shared research ladder (SL=1.5xATR, TP=1.2xATR
// -> R:R=0.8, hardcoded in runResearch.ts:74 and mirrored as
// RESEARCH_ATR_TP_MULT in engine.ts for live execution). That constant is
// shared across ALL research strategies, not per-candidate. This sweeps the
// TWO already-approved entry signals (DI-Cross, DI-Cross+ADX>15) across
// higher TP multiples (holding SL=1.5xATR fixed) to see whether R:R can rise
// while win rate stays above the new (lower) breakeven line:
//   breakeven% = risk / (risk + reward) = 1.5 / (1.5 + tpMult)
// tp=1.2 -> 55.6% | tp=1.5 -> 50% | tp=2.0 -> 42.9% | tp=2.5 -> 37.5% | tp=3.0 -> 33.3%
// Usage: npx tsx scripts/sweep-rr-frequent.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles, summarizeBacktest } from "../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const RUNS: Array<{ range: "3mo" | "1y"; interval: "1h" }> = [
  { range: "3mo", interval: "1h" },
  { range: "1y", interval: "1h" },
];
const TP_MULTS = [1.2, 1.5, 2.0, 2.5, 3.0];
const SL_MULT = 1.5;

const CANDIDATES: Array<{ label: string; code: string }> = [
  {
    label: "DI-Cross (no ADX filter)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null) return null;
if (p.plusDI <= p.minusDI && s.plusDI > s.minusDI) return { side: "long", note: "DI cross up" };
if (p.plusDI >= p.minusDI && s.plusDI < s.minusDI) return { side: "short", note: "DI cross down" };
return null;
`,
  },
  {
    label: "DI-Cross + ADX>15 filter",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 15) return null;
if (p.plusDI <= p.minusDI && s.plusDI > s.minusDI) return { side: "long", note: "DI cross up, ADX>15" };
if (p.plusDI >= p.minusDI && s.plusDI < s.minusDI) return { side: "short", note: "DI cross down, ADX>15" };
return null;
`,
  },
];

async function main() {
  for (const { range, interval } of RUNS) {
    const resp = await fetchCandles(SYMBOL, range, interval);
    const bars = resp.candles;
    const snaps = computeSnapshots(bars);
    const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
    console.log(`\n===== ${SYMBOL} ${interval}/${range} (${bars.length} bars, ~${days.toFixed(0)} days) =====`);
    for (const c of CANDIDATES) {
      const compiled = compileStrategy(c.code);
      const entryFn = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
      for (const tpMult of TP_MULTS) {
        const rr = tpMult / SL_MULT;
        const breakeven = (SL_MULT / (SL_MULT + tpMult)) * 100;
        const result = backtestCandles(SYMBOL, bars, 0.1, undefined, entryFn, true, tpMult);
        const s = summarizeBacktest(result.trades);
        const perDay = s.trades / days;
        const margin = s.winRate - breakeven;
        console.log(
          `${c.label.padEnd(30)} tp=${tpMult.toFixed(1)} R:R=${rr.toFixed(2)} breakeven=${breakeven.toFixed(1)}% ` +
          `trades=${String(s.trades).padStart(4)} win%=${s.winRate.toFixed(0).padStart(3)} ` +
          `margin=${margin >= 0 ? "+" : ""}${margin.toFixed(1)} trades/day=${perDay.toFixed(2)} ` +
          `avgR=${(s.avgR ?? 0).toFixed(2).padStart(6)} totalPnl=${s.totalPnl.toFixed(2).padStart(8)}`
        );
      }
    }
  }
}

main();
