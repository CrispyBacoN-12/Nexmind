// Blind test for research-100 (20-Bar Donchian Breakout with ADX Confirmation,
// GC=F DAILY bars, 5y in-sample): 19 trades, win% 68.4, PF 1.24, +$9.75 total.
// The in-sample run already used the full 5y range, so the untouched holdout
// here is the OLDER portion beyond that 5y window (fetch "max" history, cut
// off the most recent 5 years, test only on what's left before that).
// Usage: npx tsx scripts/blind-test-gold-donchian-daily.mts

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

if (longSignal) {
  return { side: "long", note: "breakout long" };
}
if (shortSignal) {
  return { side: "short", note: "breakout short" };
}
return null;
`;

async function main() {
  let resp;
  try {
    resp = await fetchCandles(SYMBOL, "max", "1d");
  } catch (e) {
    console.log(`${SYMBOL} 1d/max: FETCH FAILED: ${e}`);
    return;
  }
  const bars = resp.candles;
  const totalDays = (bars[bars.length - 1].t - bars[0].t) / 86400;
  console.log(`${SYMBOL} 1d/max: got ${bars.length} bars spanning ~${totalDays.toFixed(0)} days`);

  const cutoffTs = bars[bars.length - 1].t - 5 * 365 * 86400;
  const holdout = bars.filter((b) => b.t < cutoffTs);
  if (holdout.length < 100) {
    console.log(`Held-out segment too small (${holdout.length} bars) - skipping`);
    return;
  }
  const holdoutDays = (holdout[holdout.length - 1].t - holdout[0].t) / 86400;
  const snaps = computeSnapshots(holdout);
  console.log(`Held-out (blind) segment: ${holdout.length} bars, ~${holdoutDays.toFixed(0)} days, never used in the in-sample 5y run\n`);

  const compiled = compileStrategy(CODE);
  const entry = (i: number) => compiled.invoke(holdout, snaps, i)?.side ?? null;
  const result = backtestCandles(SYMBOL, holdout, 0.1, undefined, entry, true, 1.2);
  const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const wins = result.trades.filter((t) => t.outcome === "win").length;
  const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
  const totalPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);
  const yearFactor = 365 / holdoutDays;
  console.log(
    `Gold 20-Bar Donchian+ADX breakout (daily)  trades=${String(result.trades.length).padStart(4)} win%=${winRate.toFixed(1).padStart(5)} ` +
    `pnl=$${totalPnl.toFixed(0).padStart(6)} ann=$${(totalPnl * yearFactor).toFixed(0).padStart(6)} ` +
    `${result.trades.length < 15 ? "TOO FEW TRADES - inconclusive" : winRate > 50 && totalPnl > 0 ? "PASSED blind test" : "FAILED blind test"}`
  );
}

main();
