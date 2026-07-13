// Same DI-Cross idea validated on GC=F (research-25/26, run #9) - testing
// whether it holds up on BTC-USD before touching anything live. Uses the
// exact production ladder (SL=1.5xATR, TP=1.2xATR, singleTarget=true) and the
// correct real-$ formula (rMultiple * riskUsd, see real-pnl-check.ts) so
// results are directly comparable to what was reported for Gold Desk.
// Usage: npx tsx scripts/btc-di-cross-check.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "BTC-USD";
const RISK_USD = 100; // 1% of a $10,000 account, matching Gold Desk convention
const RUNS: Array<{ range: "3mo" | "1y"; interval: "1h" }> = [
  { range: "3mo", interval: "1h" },
  { range: "1y", interval: "1h" },
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
      const result = backtestCandles(SYMBOL, bars, 0.1, undefined, entryFn, true, 1.2);
      const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
      const wins = result.trades.filter((t) => t.outcome === "win").length;
      const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
      const realPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);
      const realPnlAnnualized = realPnl * yearFactor;
      console.log(
        `${c.label.padEnd(30)} trades=${String(result.trades.length).padStart(4)} win%=${winRate.toFixed(1).padStart(5)} ` +
        `REAL P/L (period)=$${realPnl.toFixed(2).padStart(9)}  REAL P/L (annualized)=$${realPnlAnnualized.toFixed(2).padStart(10)} ` +
        `(${((realPnlAnnualized / 10000) * 100).toFixed(1)}%/yr on $10k)`
      );
    }
  }
}

main();
