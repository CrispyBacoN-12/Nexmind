// Blind test for two more candle-pattern candidates: Hammer/Shooting Star and
// Doji, both gated by a SMA50 trend-context filter (a pattern alone says
// nothing about direction without knowing what trend it's reversing). Same
// held-out methodology as scripts/blind-test-engulfing.mts.
// Usage: node --import tsx scripts/blind-test-hammer-doji.mts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const RISK_USD = 100;
const TP1_MULT = 1.2;

const CANDIDATES: Array<{ label: string; code: string }> = [
  {
    label: "Hammer / Shooting Star + SMA50",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var c = bars[i], s = snaps[i];
if (s.sma50 == null) return null;

var body = Math.abs(c.c - c.o);
var range = c.h - c.l;
if (range <= 0 || body <= range * 0.01) return null;

var upperWick = c.h - Math.max(c.o, c.c);
var lowerWick = Math.min(c.o, c.c) - c.l;

var isHammer = lowerWick >= body * 2 && upperWick <= body * 0.5 && body <= range * 0.35;
var isShootingStar = upperWick >= body * 2 && lowerWick <= body * 0.5 && body <= range * 0.35;

if (isHammer && c.c < s.sma50) return { side: "long", note: "hammer below SMA50 (bullish reversal)" };
if (isShootingStar && c.c > s.sma50) return { side: "short", note: "shooting star above SMA50 (bearish reversal)" };
return null;
`,
  },
  {
    label: "Doji + SMA50",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var c = bars[i], s = snaps[i];
if (s.sma50 == null) return null;

var body = Math.abs(c.c - c.o);
var range = c.h - c.l;
if (range <= 0) return null;

var isDoji = body <= range * 0.1;
if (!isDoji) return null;

if (c.c < s.sma50) return { side: "long", note: "doji below SMA50 (indecision after downtrend)" };
if (c.c > s.sma50) return { side: "short", note: "doji above SMA50 (indecision after uptrend)" };
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
