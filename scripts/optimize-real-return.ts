// User wants REAL annual return > 30% on the $10k account (1% risk/trade).
// Best so far (DI-Cross, SL=1.5xATR, TP=1.2xATR) is 29.2% on the full 1y
// window. This does a finer 2D sweep over TP mult AND SL mult (both entry
// signals) computing the REAL $ figure directly (rMultiple * $100/trade,
// summed - see real-pnl-check.ts for why this is the correct metric, not the
// fixed lot=0.1 comparison number) to find the true local optimum.
// Usage: npx tsx scripts/optimize-real-return.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const RISK_USD = 100;
const TP_MULTS = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5];
// backtestCandles hardcodes ATR_SL_MULT=1.5 internally when no override is
// passed; to test other SL mults we'd need a code change, so first pass keeps
// SL=1.5 fixed (matches production) and only varies TP + entry signal.

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
];

async function main() {
  const resp = await fetchCandles(SYMBOL, "1y", "1h");
  const bars = resp.candles;
  const snaps = computeSnapshots(bars);
  const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
  console.log(`GC=F 1h/1y (~${days.toFixed(0)} days)\n`);

  for (const c of CANDIDATES) {
    const compiled = compileStrategy(c.code);
    const entryFn = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
    for (const tpMult of TP_MULTS) {
      const result = backtestCandles(SYMBOL, bars, 0.1, undefined, entryFn, true, tpMult);
      const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
      const wins = result.trades.filter((t) => t.outcome === "win").length;
      const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
      const realPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);
      console.log(
        `${c.label.padEnd(28)} tp=${tpMult.toFixed(1)} trades=${String(result.trades.length).padStart(4)} ` +
        `win%=${winRate.toFixed(0).padStart(3)} REAL P/L=$${realPnl.toFixed(2).padStart(9)} (${((realPnl / 10000) * 100).toFixed(1)}%/yr)`
      );
    }
  }
}

main();
