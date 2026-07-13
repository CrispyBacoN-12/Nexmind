// ADX-Ignition Breakout failed a split-half robustness check on BTC-USD (won
// big in the recent 6mo, lost big in the older 6mo - a regime-dependent
// result, not a persistent edge). Before giving up on "the same concept" for
// BTC, check whether any of the other candidates from btc-sweep-candidates.ts
// are actually stable across both halves of the 1y window, not just good on
// average.
// Usage: npx tsx scripts/btc-split-robustness.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "BTC-USD";
const RISK_USD = 100;
const TP_MULT = 1.2; // production ladder

const CANDIDATES: Array<{ label: string; code: string }> = [
  {
    label: "ATR-Band Reversal-Confirmed",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.sma20 == null || p.sma20 == null || s.atr == null || p.atr == null || s.rsi == null || p.rsi == null || s.price == null || p.price == null) return null;
if (s.adx > 20) return null;
var pUpper = p.sma20 + p.atr * 1.3;
var pLower = p.sma20 - p.atr * 1.3;
if (p.price > pUpper && p.rsi > 65 && s.price < p.price && s.rsi < p.rsi) return { side: "short", note: "reversal" };
if (p.price < pLower && p.rsi < 35 && s.price > p.price && s.rsi > p.rsi) return { side: "long", note: "reversal" };
return null;
`,
  },
  {
    label: "ADX-Ignition Breakout",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.plusDI == null || s.minusDI == null || s.sma50 == null || s.price == null) return null;
if (p.adx >= 25 || s.adx < 25) return null;
if (s.plusDI > s.minusDI && s.price > s.sma50) return { side: "long", note: "ignition" };
if (s.minusDI > s.plusDI && s.price < s.sma50) return { side: "short", note: "ignition" };
return null;
`,
  },
  {
    label: "Strong-Trend Rider",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.plusDI == null || s.minusDI == null || s.sma20 == null || s.sma50 == null || s.macdHist == null || p.macdHist == null || s.price == null) return null;
if (s.adx < 28 || s.adx <= p.adx) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
if (gap < 10) return null;
if (s.plusDI > s.minusDI && s.price > s.sma20 && s.sma20 > s.sma50 && s.macdHist > p.macdHist && s.macdHist > 0) return { side: "long", note: "rider" };
if (s.minusDI > s.plusDI && s.price < s.sma20 && s.sma20 < s.sma50 && s.macdHist < p.macdHist && s.macdHist < 0) return { side: "short", note: "rider" };
return null;
`,
  },
  {
    label: "RSI-50 Momentum Cross",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.rsi == null || p.rsi == null || s.sma50 == null || s.price == null) return null;
if (s.adx < 20) return null;
if (p.rsi <= 50 && s.rsi > 50 && s.price > s.sma50) return { side: "long", note: "momentum" };
if (p.rsi >= 50 && s.rsi < 50 && s.price < s.sma50) return { side: "short", note: "momentum" };
return null;
`,
  },
  {
    label: "Tight-Band Fade",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i];
if (s.adx == null || s.sma20 == null || s.atr == null || s.rsi == null || s.price == null) return null;
if (s.adx > 15) return null;
var upper = s.sma20 + s.atr * 1.0;
var lower = s.sma20 - s.atr * 1.0;
if (s.price > upper && s.rsi > 60) return { side: "short", note: "fade" };
if (s.price < lower && s.rsi < 40) return { side: "long", note: "fade" };
return null;
`,
  },
  {
    label: "DI-Dominance Continuation",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 25) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long", note: "continuation" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short", note: "continuation" };
return null;
`,
  },
];

function runOn(bars: any[], snaps: any[], code: string) {
  if (bars.length < 100) return null;
  const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
  const yearFactor = 365 / days;
  const compiled = compileStrategy(code);
  const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
  const result = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, TP_MULT);
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

  for (const c of CANDIDATES) {
    const first = runOn(bars.slice(0, mid), snaps.slice(0, mid), c.code);
    const second = runOn(bars.slice(mid), snaps.slice(mid), c.code);
    const fmt = (r: ReturnType<typeof runOn>) =>
      r ? `trades=${String(r.trades).padStart(3)} win%=${r.winRate.toFixed(1).padStart(5)} ann=${r.annualized >= 0 ? "+" : ""}${r.annualized.toFixed(0)}` : "n/a";
    const bothPositive = first && second && first.annualized > 0 && second.annualized > 0;
    console.log(`${c.label.padEnd(28)} H1[${fmt(first)}]  H2[${fmt(second)}]  ${bothPositive ? "STABLE+" : "unstable"}`);
  }
}

main();
