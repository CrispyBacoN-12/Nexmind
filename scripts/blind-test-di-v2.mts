// Blind test for the user's proposed "DI-Dominance v2" candidate (ADX>=25 rising +
// recent-crossover filter added on top of the live research-30 gap-widening logic).
// Same held-out methodology as scripts/blind-test-gold.ts: test on GC=F 1h bars
// OLDER than the most recent 365 days, never used by any prior sweep/tune.
// Usage: node --import tsx scripts/blind-test-di-v2.mts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const RISK_USD = 100;
const TP1_MULT = 1.2;

const CANDIDATES: Array<{ label: string; code: string }> = [
  {
    label: "DI-Dominance Widening (live, research-30)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 20) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long", note: "DI gap widening, +DI dominant" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short", note: "DI gap widening, -DI dominant" };
return null;
`,
  },
  {
    label: "DI-Dominance v2 (ADX>=25 rising + recent cross)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;

var s = snaps[i], p = snaps[i - 1];

var ADX_THRESHOLD = 25;
var CROSSOVER_LOOKBACK = 3;

if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null || p.adx == null) {
  return null;
}

if (s.adx < ADX_THRESHOLD || s.adx <= p.adx) {
    return null;
}

var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);

var recentBullishCross = false;
var recentBearishCross = false;

var maxLookback = Math.min(i, CROSSOVER_LOOKBACK);

for (var j = 0; j < maxLookback; j++) {
    var curr = snaps[i - j];
    var prev = snaps[i - j - 1];

    if (curr && prev && curr.plusDI != null && curr.minusDI != null && prev.plusDI != null && prev.minusDI != null) {
        if (prev.plusDI <= prev.minusDI && curr.plusDI > curr.minusDI) {
            recentBullishCross = true;
        }
        if (prev.minusDI <= prev.plusDI && curr.minusDI > curr.plusDI) {
            recentBearishCross = true;
        }
    }
}

if (s.plusDI > s.minusDI && gap > pGap && recentBullishCross) {
  return { side: "long", note: "+DI dominant, gap widening, ADX rising, recent cross" };
}

if (s.minusDI > s.plusDI && gap > pGap && recentBearishCross) {
  return { side: "short", note: "-DI dominant, gap widening, ADX rising, recent cross" };
}

return null;
`,
  },
];

async function main() {
  for (const range of ["2y", "5y"] as const) {
    let resp;
    try {
      resp = await fetchCandles(SYMBOL, range, "1h");
    } catch (e) {
      console.log(`\n${SYMBOL} 1h/${range}: FETCH FAILED: ${e}`);
      continue;
    }
    const bars = resp.candles;
    const totalDays = (bars[bars.length - 1].t - bars[0].t) / 86400;
    console.log(`\n${SYMBOL} 1h/${range}: got ${bars.length} bars spanning ~${totalDays.toFixed(0)} days`);
    if (totalDays < 400) {
      console.log(`(not meaningfully more than the 1y window already tested - skipping)`);
      continue;
    }

    const cutoffTs = bars[bars.length - 1].t - 365 * 86400;
    const holdout = bars.filter((b) => b.t < cutoffTs);
    if (holdout.length < 100) {
      console.log(`Held-out segment too small (${holdout.length} bars) - skipping`);
      continue;
    }
    const holdoutDays = (holdout[holdout.length - 1].t - holdout[0].t) / 86400;
    const snaps = computeSnapshots(holdout);
    console.log(`Held-out (blind) segment: ${holdout.length} bars, ~${holdoutDays.toFixed(0)} days, never used in any prior sweep\n`);

    for (const c of CANDIDATES) {
      const compiled = compileStrategy(c.code);
      const entry = (i: number) => compiled.invoke(holdout, snaps, i)?.side ?? null;
      const result = backtestCandles(SYMBOL, holdout, 0.1, undefined, entry, true, TP1_MULT);
      const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
      const wins = result.trades.filter((t) => t.outcome === "win").length;
      const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
      const totalPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);
      const yearFactor = 365 / holdoutDays;
      console.log(
        `${c.label.padEnd(48)} trades=${String(result.trades.length).padStart(4)} win%=${winRate.toFixed(1).padStart(5)} ` +
        `pnl=$${totalPnl.toFixed(0).padStart(6)} ann=$${(totalPnl * yearFactor).toFixed(0).padStart(6)} ` +
        `${winRate > 50 && totalPnl > 0 ? "PASSED blind test" : "FAILED blind test"}`
      );
    }
  }
}

main();
