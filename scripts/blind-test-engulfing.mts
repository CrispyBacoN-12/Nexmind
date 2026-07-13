// Blind test for a classic candle-pattern strategy (bullish/bearish engulfing)
// on GC=F, run raw and with a simple SMA50 trend filter. Same held-out
// methodology as scripts/blind-test-gold.ts: test on bars OLDER than the most
// recent 365 days, never used by any prior sweep/tune.
// Usage: node --import tsx scripts/blind-test-engulfing.mts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const RISK_USD = 100;
const TP1_MULT = 1.2;

const CANDIDATES: Array<{ label: string; code: string }> = [
  {
    label: "Engulfing (raw, no filter)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var c = bars[i], p = bars[i - 1];

var bullish = c.c > c.o;
var bearish = c.c < c.o;
var pBullish = p.c > p.o;
var pBearish = p.c < p.o;

if (bullish && pBearish && c.o <= p.c && c.c >= p.o) {
  return { side: "long", note: "bullish engulfing" };
}
if (bearish && pBullish && c.o >= p.c && c.c <= p.o) {
  return { side: "short", note: "bearish engulfing" };
}
return null;
`,
  },
  {
    label: "Engulfing + SMA50 trend filter",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var c = bars[i], p = bars[i - 1];
var s = snaps[i];
if (s.sma50 == null) return null;

var bullish = c.c > c.o;
var bearish = c.c < c.o;
var pBullish = p.c > p.o;
var pBearish = p.c < p.o;

// Only take longs above the trend filter, shorts below it - pattern with the wind, not against it.
if (bullish && pBearish && c.o <= p.c && c.c >= p.o && c.c > s.sma50) {
  return { side: "long", note: "bullish engulfing above SMA50" };
}
if (bearish && pBullish && c.o >= p.c && c.c <= p.o && c.c < s.sma50) {
  return { side: "short", note: "bearish engulfing below SMA50" };
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
        `${c.label.padEnd(40)} trades=${String(result.trades.length).padStart(4)} win%=${winRate.toFixed(1).padStart(5)} ` +
        `pnl=$${totalPnl.toFixed(0).padStart(6)} ann=$${(totalPnl * yearFactor).toFixed(0).padStart(6)} ` +
        `${winRate > 50 && totalPnl > 0 ? "PASSED blind test" : "FAILED blind test"}`
      );
    }
  }
}

main();
