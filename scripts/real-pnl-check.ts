// User pushed back: "$100-124/year profit on a $10k account seems way too
// low." They're right to be suspicious — but the number is an artifact, not
// the real answer. sweep-frequent.ts / sweep-rr-frequent.ts call
// backtestCandles(..., lot=0.1) with a FIXED 0.1 lot so different strategies
// can be compared apples-to-apples; that fixed lot has nothing to do with the
// account's real 1%-risk position sizing.
//
// The engine's rMultiple per trade IS lot-independent (pnl and risk both
// scale linearly with lot, see backtest/engine.ts:128), so the honest real-$
// figure is: realPnl_i = rMultiple_i * riskUsd, where riskUsd = 1% of the
// account's starting balance ($100 on Gold Desk's $10k) — this exactly
// matches how engine.ts:155 sizes live trades (fixed % of starting balance,
// non-compounding). Summing that per trade gives the real expected annual
// profit instead of the toy fixed-lot comparison number.
// Usage: npx tsx scripts/real-pnl-check.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const RISK_USD = 100; // 1% of Gold Desk's $10,000 starting balance
const RUNS: Array<{ range: "3mo" | "1y"; interval: "1h" }> = [
  { range: "3mo", interval: "1h" },
  { range: "1y", interval: "1h" },
];
const TP_MULTS = [1.2, 1.5];

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
    const yearFactor = 365 / days;
    console.log(`\n===== ${SYMBOL} ${interval}/${range} (~${days.toFixed(0)} days, annualize x${yearFactor.toFixed(2)}) =====`);
    for (const c of CANDIDATES) {
      const compiled = compileStrategy(c.code);
      const entryFn = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
      for (const tpMult of TP_MULTS) {
        const result = backtestCandles(SYMBOL, bars, 0.1, undefined, entryFn, true, tpMult);
        const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
        const wins = result.trades.filter((t) => t.outcome === "win").length;
        const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
        const realPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);
        const realPnlAnnualized = realPnl * yearFactor;
        console.log(
          `${c.label.padEnd(30)} tp=${tpMult.toFixed(1)} trades=${String(result.trades.length).padStart(4)} win%=${winRate.toFixed(0).padStart(3)} ` +
          `REAL P/L (period)=$${realPnl.toFixed(2).padStart(9)}  REAL P/L (annualized)=$${realPnlAnnualized.toFixed(2).padStart(9)} ` +
          `(${((realPnlAnnualized / 10000) * 100).toFixed(1)}%/yr on $10k)`
        );
      }
    }
  }
}

main();
