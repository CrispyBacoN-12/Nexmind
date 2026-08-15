// Deep-data train/test validation for every remaining "approved" GC=F research
// strategy in the Obsidian vault (research-25 was already checked this way and
// failed — see docs/research25_validation notes). Same methodology: GC=F 1h,
// 2y window, first 65% = TRAIN, last 35% = TEST (true out-of-sample), same
// entry-signal code the vault note records, same tight-ladder exit (SL=1.5x
// ATR, TP=1.2x ATR) used by every one of these candidates so only the ENTRY
// signal varies between rows.
// Usage: node --import tsx scripts/validate-approved-gold-strategies.mts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles, summarizeBacktest } from "../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const TP1_MULT = 1.2;

const CANDIDATES: Array<{ label: string; code: string }> = [
  {
    label: "research-24 ADX-Ignition Breakout (tight target)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.plusDI == null || s.minusDI == null || s.sma50 == null || s.price == null) return null;
if (p.adx >= 25 || s.adx < 25) return null;
if (s.plusDI > s.minusDI && s.price > s.sma50) return { side: "long", note: "fresh ADX ignition, +DI dominant, above sma50" };
if (s.minusDI > s.plusDI && s.price < s.sma50) return { side: "short", note: "fresh ADX ignition, -DI dominant, below sma50" };
return null;
`,
  },
  {
    label: "research-26 DI-Cross + ADX>15 filter",
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
  {
    label: "research-19/22 DI-Dominance gap-widening (ADX>=25)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 25) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long", note: "DI gap widening, +DI dominant" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short", note: "DI gap widening, -DI dominant" };
return null;
`,
  },
  {
    label: "research-30 DI-Dominance gap-widening (ADX>=20)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 20) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long", note: "DI gap widening, +DI dominant" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short", note: "DI gap widening, -DI dominant" };
return null;
`,
  },
  {
    label: "research-48 Engulfing + SMA50 trend filter",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var c = bars[i], p = bars[i - 1];
var s = snaps[i];
if (s.sma50 == null) return null;
var bullish = c.c > c.o;
var bearish = c.c < c.o;
var pBullish = p.c > p.o;
var pBearish = p.c < p.o;
if (bullish && pBearish && c.o <= p.c && c.c >= p.o && c.c > s.sma50) {
  return { side: "long", note: "bullish engulfing above SMA50" };
}
if (bearish && pBullish && c.o >= p.c && c.c <= p.o && c.c < s.sma50) {
  return { side: "short", note: "bearish engulfing below SMA50" };
}
return null;
`,
  },
  {
    label: "research-62 Liquidity Sweep (20-bar, SMA50-aligned)",
    code: `
var i = bars.length - 1;
var lookback = 20;
if (i < lookback + 1) return null;
var c = bars[i];
var s = snaps[i];
if (s.sma50 == null) return null;
var hi = -Infinity, lo = Infinity;
for (var k = i - lookback; k < i; k++) {
  if (bars[k].h > hi) hi = bars[k].h;
  if (bars[k].l < lo) lo = bars[k].l;
}
if (c.l < lo && c.c > lo && c.c > s.sma50) {
  return { side: "long", note: "liquidity sweep below " + lookback + "-bar low, above SMA50, closed back above" };
}
if (c.h > hi && c.c < hi && c.c < s.sma50) {
  return { side: "short", note: "liquidity sweep above " + lookback + "-bar high, below SMA50, closed back below" };
}
return null;
`,
  },
  {
    label: "research-31 MACD Hist Flip + Trend Filter (sma20 vs sma50)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.macdHist == null || p.macdHist == null || s.sma20 == null || s.sma50 == null) return null;
if (p.macdHist <= 0 && s.macdHist > 0 && s.sma20 > s.sma50) return { side: "long", note: "MACD hist flips positive, uptrend" };
if (p.macdHist >= 0 && s.macdHist < 0 && s.sma20 < s.sma50) return { side: "short", note: "MACD hist flips negative, downtrend" };
return null;
`,
  },
  {
    label: "research-49 MACD Histogram Zero-Cross + SMA50",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.macdHist == null || p.macdHist == null || s.sma50 == null) return null;
var c = bars[i].c;
if (p.macdHist <= 0 && s.macdHist > 0 && c > s.sma50) return { side: "long", note: "MACD hist crossed up through zero, above SMA50" };
if (p.macdHist >= 0 && s.macdHist < 0 && c < s.sma50) return { side: "short", note: "MACD hist crossed down through zero, below SMA50" };
return null;
`,
  },
  {
    label: "research-14 MACD-DI Momentum Ignition",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.macdHist == null || p.macdHist == null || s.plusDI == null || s.minusDI == null) return null;
var crossedUp = p.macdHist <= 0 && s.macdHist > 0;
var crossedDown = p.macdHist >= 0 && s.macdHist < 0;
if (crossedUp && s.plusDI > s.minusDI) {
  return { side: "long", note: "MACD hist turned positive, +DI leading" };
}
if (crossedDown && s.minusDI > s.plusDI) {
  return { side: "short", note: "MACD hist turned negative, -DI leading" };
}
return null;
`,
  },
  {
    label: "research-20/23 Strong-Trend Rider (ADX>=28 rising, MACD accel)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.plusDI == null || s.minusDI == null || s.sma20 == null || s.sma50 == null || s.macdHist == null || p.macdHist == null || s.price == null) return null;
if (s.adx < 28 || s.adx <= p.adx) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
if (gap < 10) return null;
if (s.plusDI > s.minusDI && s.price > s.sma20 && s.sma20 > s.sma50 && s.macdHist > p.macdHist && s.macdHist > 0) {
  return { side: "long", note: "strong trend rider" };
}
if (s.minusDI > s.plusDI && s.price < s.sma20 && s.sma20 < s.sma50 && s.macdHist < p.macdHist && s.macdHist < 0) {
  return { side: "short", note: "strong trend rider" };
}
return null;
`,
  },
];

function verdictTrain(trades: number, avgR: number | null, pf: number | null): boolean {
  return trades >= 20 && avgR != null && avgR > 0 && pf != null && pf > 1.05;
}
function verdictTest(trades: number, avgR: number | null, pf: number | null): boolean {
  return trades >= 15 && avgR != null && avgR > 0 && pf != null && pf > 1.0;
}

async function main() {
  const resp = await fetchCandles(SYMBOL, "2y", "1h");
  const bars = resp.candles;
  const splitIdx = Math.floor(bars.length * 0.65);
  const train = bars.slice(0, splitIdx);
  const test = bars.slice(splitIdx);
  const fmtDate = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

  console.log(`${SYMBOL} 1h: ${bars.length} bars, ${fmtDate(bars[0].t)} -> ${fmtDate(bars[bars.length - 1].t)}`);
  console.log(`TRAIN: ${train.length} bars (${fmtDate(train[0].t)} -> ${fmtDate(train[train.length - 1].t)})`);
  console.log(`TEST:  ${test.length} bars (${fmtDate(test[0].t)} -> ${fmtDate(test[test.length - 1].t)}) [out-of-sample]\n`);

  const trainSnaps = computeSnapshots(train);
  const testSnaps = computeSnapshots(test);
  const fullSnaps = computeSnapshots(bars);

  for (const c of CANDIDATES) {
    const compiled = compileStrategy(c.code);

    const runOn = (segment: typeof bars, snaps: typeof trainSnaps) => {
      const entry = (i: number) => compiled.invoke(segment, snaps, i)?.side ?? null;
      const result = backtestCandles(SYMBOL, segment, 0.1, undefined, entry, true, TP1_MULT);
      return summarizeBacktest(result.trades);
    };

    const trainSum = runOn(train, trainSnaps);
    const testSum = runOn(test, testSnaps);
    const fullSum = runOn(bars, fullSnaps);

    const trainPass = verdictTrain(trainSum.trades, trainSum.avgR, trainSum.profitFactor);
    const testPass = verdictTest(testSum.trades, testSum.avgR, testSum.profitFactor);

    console.log(c.label);
    console.log(
      `  TRAIN trades=${trainSum.trades} avgR=${trainSum.avgR?.toFixed(3) ?? "n/a"} PF=${trainSum.profitFactor?.toFixed(2) ?? "n/a"} win%=${trainSum.winRate.toFixed(1)}`,
    );
    console.log(
      `  TEST  trades=${testSum.trades} avgR=${testSum.avgR?.toFixed(3) ?? "n/a"} PF=${testSum.profitFactor?.toFixed(2) ?? "n/a"} win%=${testSum.winRate.toFixed(1)}`,
    );
    console.log(
      `  FULL  trades=${fullSum.trades} avgR=${fullSum.avgR?.toFixed(3) ?? "n/a"} PF=${fullSum.profitFactor?.toFixed(2) ?? "n/a"} win%=${fullSum.winRate.toFixed(1)}`,
    );
    console.log(`  Verdict: TRAIN ${trainPass ? "PASS" : "FAIL"}, TEST ${testPass ? "PASS" : "FAIL"} -> ${trainPass && testPass ? "ROBUST" : "NOT ROBUST"}\n`);
  }
}

main();
