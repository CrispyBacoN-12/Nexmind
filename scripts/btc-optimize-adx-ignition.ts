// ADX-Ignition Breakout was the one BTC-USD candidate that cleared >60% win
// rate consistently on BOTH the 3mo and 1y windows (see
// btc-sweep-candidates.ts). Fine-tunes TP mult (SL fixed 1.5xATR, production
// convention) the same way optimize-real-return.ts did for gold's DI-Cross.
// Usage: npx tsx scripts/btc-optimize-adx-ignition.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "BTC-USD";
const RISK_USD = 100;
const TP_MULTS = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5];
const RANGES: Array<{ range: "3mo" | "1y"; interval: "1h" }> = [
  { range: "3mo", interval: "1h" },
  { range: "1y", interval: "1h" },
];

const CODE = `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.plusDI == null || s.minusDI == null || s.sma50 == null || s.price == null) return null;
if (p.adx >= 25 || s.adx < 25) return null;
if (s.plusDI > s.minusDI && s.price > s.sma50) return { side: "long", note: "fresh ADX ignition, +DI dominant, above sma50" };
if (s.minusDI > s.plusDI && s.price < s.sma50) return { side: "short", note: "fresh ADX ignition, -DI dominant, below sma50" };
return null;
`;

async function main() {
  for (const { range, interval } of RANGES) {
    const resp = await fetchCandles(SYMBOL, range, interval);
    const bars = resp.candles;
    const snaps = computeSnapshots(bars);
    const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
    const yearFactor = 365 / days;
    console.log(`\n===== ${SYMBOL} ${interval}/${range} (~${days.toFixed(0)}d, annualize x${yearFactor.toFixed(2)}) =====`);
    const compiled = compileStrategy(CODE);
    const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
    for (const tpMult of TP_MULTS) {
      const result = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, tpMult);
      const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
      const wins = result.trades.filter((t) => t.outcome === "win").length;
      const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
      const realPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);
      const realPnlAnnualized = realPnl * yearFactor;
      console.log(
        `tp=${tpMult.toFixed(1)} trades=${String(result.trades.length).padStart(3)} win%=${winRate.toFixed(1).padStart(5)} ` +
        `REAL P/L(period)=$${realPnl.toFixed(2).padStart(8)} annualized=$${realPnlAnnualized.toFixed(2).padStart(9)} (${((realPnlAnnualized / 10000) * 100).toFixed(1)}%/yr)`
      );
    }
  }
}

main();
