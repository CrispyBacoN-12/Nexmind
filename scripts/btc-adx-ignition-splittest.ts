// Robustness check for "ADX-Ignition Breakout" on BTC-USD: the full 1y window
// showed a marginal/borderline result (win% swinging 55-60%, near-breakeven
// real $) while the last 3mo looked strong (61-66% win, +16%/yr). Splitting
// the 1y sample into first-half vs second-half tells us whether the edge is
// stable over time or concentrated in one recent regime (which would make the
// 3mo number misleading survivorship, not a real edge).
// Usage: npx tsx scripts/btc-adx-ignition-splittest.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "BTC-USD";
const RISK_USD = 100;
const TP_MULT = 1.0; // best all-around pick from the fine sweep

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

function runOn(label: string, bars: any[], snaps: any[]) {
  if (bars.length < 100) {
    console.log(`${label}: too few bars (${bars.length}), skipped`);
    return;
  }
  const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
  const yearFactor = 365 / days;
  const compiled = compileStrategy(CODE);
  const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
  const result = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, TP_MULT);
  const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const wins = result.trades.filter((t) => t.outcome === "win").length;
  const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
  const realPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);
  const realPnlAnnualized = realPnl * yearFactor;
  console.log(
    `${label.padEnd(24)} ~${days.toFixed(0)}d trades=${String(result.trades.length).padStart(3)} win%=${winRate.toFixed(1).padStart(5)} ` +
    `REAL P/L(period)=$${realPnl.toFixed(2).padStart(8)} annualized=$${realPnlAnnualized.toFixed(2).padStart(9)} (${((realPnlAnnualized / 10000) * 100).toFixed(1)}%/yr)`
  );
}

async function main() {
  const resp = await fetchCandles(SYMBOL, "1y", "1h");
  const bars = resp.candles;
  const snaps = computeSnapshots(bars);
  const mid = Math.floor(bars.length / 2);

  console.log(`Full 1y: ${bars.length} bars`);
  runOn("Full 1y", bars, snaps);
  runOn("First half (older)", bars.slice(0, mid), snaps.slice(0, mid));
  runOn("Second half (recent)", bars.slice(mid), snaps.slice(mid));
}

main();
