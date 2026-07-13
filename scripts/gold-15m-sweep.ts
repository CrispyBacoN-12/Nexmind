// Tests whether the two live Gold strategies (DI-Cross / DI-Dominance
// Widening) still hold up if the desks are switched from 1h to 15m candles -
// user asked to try 15m bars. Resolution changes don't automatically transfer
// edge (daily->weekly for stocks flipped several candidates from
// unstable->stable and vice versa) so this re-validates both signals fresh on
// GC=F 15m data with the same production ladder and split-half stability bar.
// Usage: npx tsx scripts/gold-15m-sweep.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const RISK_USD = 100;
const TP1_MULT = 1.2;
const RUNS: Array<{ range: "1mo" | "3mo" | "6mo"; interval: "15m" }> = [
  { range: "1mo", interval: "15m" },
  { range: "3mo", interval: "15m" },
  { range: "6mo", interval: "15m" },
];

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
    label: "DI-Dominance Widening (ADX>20)",
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
];

async function main() {
  for (const { range, interval } of RUNS) {
    let resp;
    try {
      resp = await fetchCandles(SYMBOL, range, interval);
    } catch (e) {
      console.log(`\n===== ${SYMBOL} ${interval}/${range}: FETCH FAILED: ${e} =====`);
      continue;
    }
    const bars = resp.candles;
    if (bars.length < 60) {
      console.log(`\n===== ${SYMBOL} ${interval}/${range}: only ${bars.length} bars returned, skipping =====`);
      continue;
    }
    const snaps = computeSnapshots(bars);
    const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
    console.log(`\n===== ${SYMBOL} ${interval}/${range} (${bars.length} bars, ~${days.toFixed(1)} days actual coverage) =====`);

    for (const c of CANDIDATES) {
      let compiled;
      try {
        compiled = compileStrategy(c.code);
      } catch (e) {
        console.log(`${c.label.padEnd(40)} SAFETY REJECTED: ${e}`);
        continue;
      }

      const entry = (i: number) => compiled!.invoke(bars, snaps, i)?.side ?? null;
      const result = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, TP1_MULT);
      const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
      const wins = result.trades.filter((t) => t.outcome === "win").length;
      const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
      const totalPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);
      const perDay = result.trades.length / days;

      const mid = Math.floor(bars.length / 2);
      const b1 = bars.slice(0, mid), s1 = snaps.slice(0, mid);
      const b2 = bars.slice(mid), s2 = snaps.slice(mid);
      const e1 = (i: number) => compiled!.invoke(b1, s1, i)?.side ?? null;
      const e2 = (i: number) => compiled!.invoke(b2, s2, i)?.side ?? null;
      const r1 = backtestCandles(SYMBOL, b1, 0.1, undefined, e1, true, TP1_MULT);
      const r2 = backtestCandles(SYMBOL, b2, 0.1, undefined, e2, true, TP1_MULT);
      const rs1 = r1.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
      const rs2 = r2.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
      const w1 = r1.trades.filter((t) => t.outcome === "win").length;
      const w2 = r2.trades.filter((t) => t.outcome === "win").length;
      const win1 = r1.trades.length ? (w1 / r1.trades.length) * 100 : 0;
      const win2 = r2.trades.length ? (w2 / r2.trades.length) * 100 : 0;
      const pnl1 = rs1.reduce((s, r) => s + r * RISK_USD, 0);
      const pnl2 = rs2.reduce((s, r) => s + r * RISK_USD, 0);
      const stable = pnl1 > 0 && pnl2 > 0;

      console.log(
        `${c.label.padEnd(40)} trades=${String(result.trades.length).padStart(4)} win%=${winRate.toFixed(1).padStart(5)} ` +
        `trades/day=${perDay.toFixed(2)} pnl=$${totalPnl.toFixed(0).padStart(6)}  ` +
        `H1[n=${r1.trades.length} win%=${win1.toFixed(0)} pnl=$${pnl1.toFixed(0)}] H2[n=${r2.trades.length} win%=${win2.toFixed(0)} pnl=$${pnl2.toFixed(0)}]  ` +
        `${stable ? "STABLE+" : "unstable"}`
      );
    }
  }
}

main();
