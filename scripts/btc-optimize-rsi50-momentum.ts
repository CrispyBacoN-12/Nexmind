// RSI-50 Momentum Cross was the ONLY BTC-USD candidate profitable in BOTH
// halves of the 1y window (see btc-split-robustness.ts) - not just good on
// average like ADX-Ignition Breakout, which flipped from -17.9%/yr to
// +16.7%/yr between halves (regime-dependent, not a real edge). Fine-tunes TP
// mult and re-checks split-half stability at each value to find the most
// robust, not just highest-average, config.
// Usage: npx tsx scripts/btc-optimize-rsi50-momentum.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "BTC-USD";
const RISK_USD = 100;
const TP_MULTS = [0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0];

const CODE = `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.rsi == null || p.rsi == null || s.sma50 == null || s.price == null) return null;
if (s.adx < 20) return null;
if (p.rsi <= 50 && s.rsi > 50 && s.price > s.sma50) return { side: "long", note: "RSI cross above 50, uptrend" };
if (p.rsi >= 50 && s.rsi < 50 && s.price < s.sma50) return { side: "short", note: "RSI cross below 50, downtrend" };
return null;
`;

function runOn(bars: any[], snaps: any[], tpMult: number) {
  const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
  const yearFactor = 365 / days;
  const compiled = compileStrategy(CODE);
  const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
  const result = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, tpMult);
  const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const wins = result.trades.filter((t) => t.outcome === "win").length;
  const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
  const realPnl = rs.reduce((s, r) => s + r * RISK_USD, 0) * yearFactor;
  return { trades: result.trades.length, winRate, annualized: realPnl };
}

async function main() {
  const resp = await fetchCandles(SYMBOL, "1y", "1h");
  const bars = resp.candles;
  const snaps = computeSnapshots(bars);
  const mid = Math.floor(bars.length / 2);

  console.log(`${SYMBOL} 1h/1y, ${bars.length} bars\n`);
  for (const tpMult of TP_MULTS) {
    const full = runOn(bars, snaps, tpMult);
    const h1 = runOn(bars.slice(0, mid), snaps.slice(0, mid), tpMult);
    const h2 = runOn(bars.slice(mid), snaps.slice(mid), tpMult);
    const stable = h1.annualized > 0 && h2.annualized > 0;
    console.log(
      `tp=${tpMult.toFixed(1)}  FULL[trades=${String(full.trades).padStart(3)} win%=${full.winRate.toFixed(1).padStart(5)} ann=${full.annualized.toFixed(0).padStart(6)}]  ` +
      `H1[win%=${h1.winRate.toFixed(1).padStart(5)} ann=${h1.annualized.toFixed(0).padStart(6)}]  H2[win%=${h2.winRate.toFixed(1).padStart(5)} ann=${h2.annualized.toFixed(0).padStart(6)}]  ${stable ? "STABLE+" : "unstable"}`
    );
  }
}

main();
