// research-100 blind test via "max" range returned coarsened (~monthly)
// bars for GC=F daily data that old - unusable as a real holdout. Fallback:
// split the same 5y daily series in half chronologically and check the
// strategy holds up in each half independently (weaker than a true holdout,
// but still catches "only worked because of one lucky stretch").
// Usage: npx tsx scripts/split-test-gold-donchian-daily.mts

import "dotenv/config";
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const RISK_USD = 100;

const CODE = `
const n = bars.length - 1;
const lookback = 20;
if (n < lookback) return null;
let highestHigh = -Infinity;
let lowestLow = Infinity;
let volSum = 0;
for (let i = n - lookback; i < n; i++) {
  if (bars[i].h > highestHigh) highestHigh = bars[i].h;
  if (bars[i].l < lowestLow) lowestLow = bars[i].l;
  volSum += bars[i].v;
}
const avgVol = volSum / lookback;
const cur = bars[n];
const prevBar = bars[n - 1];
const snap = snaps[n];
const prevSnap = snaps[n - 1];
const prevPrevSnap = snaps[n - 2];
if (!snap || !prevSnap || !prevPrevSnap) return null;
if (snap.adx == null || snap.atr == null || snap.plusDI == null || snap.minusDI == null || snap.sma20 == null || snap.sma50 == null) return null;
if (prevSnap.adx == null || prevPrevSnap.adx == null) return null;

if (snap.adx < 22) return null;
if (snap.adx <= prevSnap.adx || prevSnap.adx <= prevPrevSnap.adx) return null;

const buffer = 0.15 * snap.atr;
const maxExtension = 1.75 * snap.atr;
const volConfirmed = cur.v > avgVol;

const longSignal = cur.c > highestHigh + buffer
  && prevBar.c <= highestHigh
  && snap.plusDI > snap.minusDI
  && snap.sma20 > snap.sma50
  && (cur.c - highestHigh) < maxExtension
  && volConfirmed;

const shortSignal = cur.c < lowestLow - buffer
  && prevBar.c >= lowestLow
  && snap.minusDI > snap.plusDI
  && snap.sma20 < snap.sma50
  && (lowestLow - cur.c) < maxExtension
  && volConfirmed;

if (longSignal) return { side: "long", note: "breakout long" };
if (shortSignal) return { side: "short", note: "breakout short" };
return null;
`;

function runOn(label: string, bars: any[]) {
  const snaps = computeSnapshots(bars);
  const compiled = compileStrategy(CODE);
  const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
  const result = backtestCandles(SYMBOL, bars, 0.1, undefined, entry, true, 1.2);
  const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const wins = result.trades.filter((t) => t.outcome === "win").length;
  const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
  const totalPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);
  console.log(
    `${label}  trades=${String(result.trades.length).padStart(3)} win%=${winRate.toFixed(1).padStart(5)} ` +
    `pnl=$${totalPnl.toFixed(0).padStart(6)} ` +
    `${result.trades.length < 8 ? "TOO FEW - inconclusive" : winRate > 50 && totalPnl > 0 ? "positive" : "negative"}`
  );
}

async function main() {
  const resp = await fetchCandles(SYMBOL, "5y", "1d");
  const bars = resp.candles;
  console.log(`${SYMBOL} 1d/5y: ${bars.length} bars\n`);
  const mid = Math.floor(bars.length / 2);
  // give each half enough lookback warm-up by overlapping 60 bars from the prior half
  runOn("First half ", bars.slice(0, mid));
  runOn("Second half", bars.slice(mid - 60));
}

main();
