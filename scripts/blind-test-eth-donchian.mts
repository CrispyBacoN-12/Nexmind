// Blind test for research-85 (ETH Breakout: 20-Bar Donchian Break with Volume
// Expansion Filter, ETH-USD 1h/1y in-sample): PF 1.02, +$3.19/81 trades - a
// razor-thin in-sample edge. Same held-out methodology as
// scripts/blind-test-engulfing.mts: test on bars OLDER than the most recent
// 365 days, never touched by the in-sample run.
// Usage: npx tsx scripts/blind-test-eth-donchian.mts

import "dotenv/config";
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "ETH-USD";
const RISK_USD = 100;
const TP1_MULT = 1.2;

const CODE = `
var n = bars.length;
var lookback = 20;
if (n < 2 * lookback + 2) return null;
var i = n - 1;
var s = snaps[i];
var sPrev = snaps[i - 1];
if (!s || s.adx == null || !sPrev || sPrev.adx == null) return null;
if (s.sma20 == null || s.sma50 == null || s.macdHist == null) return null;
var bar = bars[i];
var prevBar = bars[i - 1];

var hh = -Infinity, ll = Infinity, volSum = 0;
for (var k = i - lookback; k < i; k++) {
  var b = bars[k];
  if (b.h > hh) hh = b.h;
  if (b.l < ll) ll = b.l;
  volSum += b.v;
}
var avgVol = volSum / lookback;

var hhPrev = -Infinity, llPrev = Infinity;
for (var j = i - 1 - lookback; j < i - 1; j++) {
  var pb = bars[j];
  if (pb.h > hhPrev) hhPrev = pb.h;
  if (pb.l < llPrev) llPrev = pb.l;
}

var volExpansion = avgVol > 0 && bar.v > avgVol * 1.8;
var adxRising = (s.adx - sPrev.adx) >= 0.3;
var strongAdx = s.adx > 22;
var range = bar.h - bar.l;
var closeStrengthLong = range > 0 ? (bar.c - bar.l) / range : 0;
var closeStrengthShort = range > 0 ? (bar.h - bar.c) / range : 0;

var breakoutMarginLong = hh > 0 && bar.c > hh * 1.0015;
var breakoutMarginShort = ll > 0 && bar.c < ll * 0.9985;

var freshLongBreakout = breakoutMarginLong && prevBar.c <= hhPrev;
var freshShortBreakout = breakoutMarginShort && prevBar.c >= llPrev;

var trendUp = s.sma20 > s.sma50;
var trendDown = s.sma20 < s.sma50;
var momentumUp = s.macdHist > 0;
var momentumDown = s.macdHist < 0;

if (freshLongBreakout && volExpansion && strongAdx && adxRising && closeStrengthLong >= 0.65 && trendUp && momentumUp) {
  return { side: "long", note: "breakout long" };
}
if (freshShortBreakout && volExpansion && strongAdx && adxRising && closeStrengthShort >= 0.65 && trendDown && momentumDown) {
  return { side: "short", note: "breakout short" };
}
return null;
`;

async function main() {
  let resp;
  try {
    resp = await fetchCandles(SYMBOL, "2y", "1h");
  } catch (e) {
    console.log(`${SYMBOL} 1h/2y: FETCH FAILED: ${e}`);
    return;
  }
  const bars = resp.candles;
  const totalDays = (bars[bars.length - 1].t - bars[0].t) / 86400;
  console.log(`${SYMBOL} 1h/2y: got ${bars.length} bars spanning ~${totalDays.toFixed(0)} days`);

  const cutoffTs = bars[bars.length - 1].t - 365 * 86400;
  const holdout = bars.filter((b) => b.t < cutoffTs);
  if (holdout.length < 100) {
    console.log(`Held-out segment too small (${holdout.length} bars) - skipping`);
    return;
  }
  const holdoutDays = (holdout[holdout.length - 1].t - holdout[0].t) / 86400;
  const snaps = computeSnapshots(holdout);
  console.log(`Held-out (blind) segment: ${holdout.length} bars, ~${holdoutDays.toFixed(0)} days, never used in the in-sample run\n`);

  const compiled = compileStrategy(CODE);
  const entry = (i: number) => compiled.invoke(holdout, snaps, i)?.side ?? null;
  const result = backtestCandles(SYMBOL, holdout, 0.1, undefined, entry, true, TP1_MULT);
  const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const wins = result.trades.filter((t) => t.outcome === "win").length;
  const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
  const totalPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);
  const yearFactor = 365 / holdoutDays;
  console.log(
    `ETH Donchian+Vol+ADX breakout  trades=${String(result.trades.length).padStart(4)} win%=${winRate.toFixed(1).padStart(5)} ` +
    `pnl=$${totalPnl.toFixed(0).padStart(6)} ann=$${(totalPnl * yearFactor).toFixed(0).padStart(6)} ` +
    `${result.trades.length < 15 ? "TOO FEW TRADES - inconclusive" : winRate > 50 && totalPnl > 0 ? "PASSED blind test" : "FAILED blind test"}`
  );
}

main();
