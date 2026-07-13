// Replacement search for research-27 (RSI-50 Momentum Cross) on Bitcoin Desk
// #9 - Monte Carlo stress test showed its median bootstrap return is actually
// NEGATIVE (-3.6%/yr) at the desk's real 2% risk sizing, i.e. genuinely thin
// edge, not just a sizing problem. Same rigor as the gold-replacement sweep:
// TUNE = most recent 365d, BLIND = older 365d (never touched during
// selection), pooled across BTC-USD + BNB-USD (the desk's actual watchlist).
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOLS = ["BTC-USD", "BNB-USD"];
const RISK_USD = 100;
const TP1_MULT = 1.2;

const CANDIDATES: Array<{ label: string; code: string }> = [
  {
    label: "DI-Dominance Widening (ADX>20)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 20) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short" };
return null;
`,
  },
  {
    label: "MACD Hist Flip + Trend Filter",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.macdHist == null || p.macdHist == null || s.sma20 == null || s.sma50 == null) return null;
if (p.macdHist <= 0 && s.macdHist > 0 && s.sma20 > s.sma50) return { side: "long" };
if (p.macdHist >= 0 && s.macdHist < 0 && s.sma20 < s.sma50) return { side: "short" };
return null;
`,
  },
  {
    label: "10-Bar Donchian Continuation (ADX>20)",
    code: `
var i = bars.length - 1;
if (i < 11) return null;
var s = snaps[i];
if (s.adx == null || s.plusDI == null || s.minusDI == null || s.price == null) return null;
if (s.adx < 20) return null;
var hi = -Infinity, lo = Infinity;
for (var k = i - 10; k < i; k++) {
  var pr = snaps[k].price;
  if (pr == null) continue;
  if (pr > hi) hi = pr;
  if (pr < lo) lo = pr;
}
if (s.price > hi && s.plusDI > s.minusDI) return { side: "long" };
if (s.price < lo && s.minusDI > s.plusDI) return { side: "short" };
return null;
`,
  },
  {
    label: "RSI Extreme Reversal + Trend Filter",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.rsi == null || p.rsi == null || s.sma50 == null || s.price == null) return null;
if (p.rsi < 25 && s.rsi >= p.rsi && s.rsi < 35) return { side: "long" };
if (p.rsi > 75 && s.rsi <= p.rsi && s.rsi > 65) return { side: "short" };
return null;
`,
  },
  {
    label: "ATR-Band Reversal-Confirmed (chop only, ADX<20)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.sma20 == null || p.sma20 == null || s.atr == null || p.atr == null || s.rsi == null || p.rsi == null || s.price == null || p.price == null) return null;
if (s.adx > 20) return null;
var pUpper = p.sma20 + p.atr * 1.3;
var pLower = p.sma20 - p.atr * 1.3;
if (p.price > pUpper && p.rsi > 65 && s.price < p.price && s.rsi < p.rsi) return { side: "short" };
if (p.price < pLower && p.rsi < 35 && s.price > p.price && s.rsi > p.rsi) return { side: "long" };
return null;
`,
  },
  {
    label: "DI-Cross + RSI Confluence",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.rsi == null) return null;
if (p.plusDI <= p.minusDI && s.plusDI > s.minusDI && s.rsi > 50) return { side: "long" };
if (p.plusDI >= p.minusDI && s.plusDI < s.minusDI && s.rsi < 50) return { side: "short" };
return null;
`,
  },
  {
    label: "Shallow Pullback in Trend (RSI 45/55 + SMA50)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.rsi == null || p.rsi == null || s.sma50 == null || s.price == null) return null;
if (p.rsi <= 45 && s.rsi > 45 && s.price > s.sma50) return { side: "long" };
if (p.rsi >= 55 && s.rsi < 55 && s.price < s.sma50) return { side: "short" };
return null;
`,
  },
  {
    label: "Strong-Trend DI Cross (ADX>25)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 25) return null;
if (p.plusDI <= p.minusDI && s.plusDI > s.minusDI) return { side: "long" };
if (p.plusDI >= p.minusDI && s.plusDI < s.minusDI) return { side: "short" };
return null;
`,
  },
  {
    label: "MACD 2-Bar Confirmed Flip + Trend",
    code: `
var i = bars.length - 1;
if (i < 2) return null;
var s = snaps[i], p = snaps[i - 1], pp = snaps[i - 2];
if (s.macdHist == null || p.macdHist == null || pp.macdHist == null || s.sma20 == null || s.sma50 == null) return null;
if (pp.macdHist <= 0 && p.macdHist > 0 && s.macdHist > p.macdHist && s.sma20 > s.sma50) return { side: "long" };
if (pp.macdHist >= 0 && p.macdHist < 0 && s.macdHist < p.macdHist && s.sma20 < s.sma50) return { side: "short" };
return null;
`,
  },
];

function runOne(bars: any[], snaps: any[], code: string, days: number) {
  const compiled = compileStrategy(code);
  const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
  const result = backtestCandles("MULTI", bars, 0.1, undefined, entry, true, TP1_MULT);
  const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const wins = result.trades.filter((t) => t.outcome === "win").length;
  const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
  const totalPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);
  const annPnl = totalPnl * (365 / days);
  return { trades: result.trades.length, winRate, totalPnl, annPnl };
}

async function main() {
  const perSymbol: Record<string, { bars: any[]; snaps: any[] }> = {};
  for (const symbol of SYMBOLS) {
    const resp = await fetchCandles(symbol, "2y", "1h");
    perSymbol[symbol] = { bars: resp.candles, snaps: [] };
  }

  // Split each symbol's series into TUNE (recent 365d) / BLIND (older 365d), then pool across symbols.
  const TUNE: any[] = [], TUNE_SNAPS: any[] = [], BLIND: any[] = [], BLIND_SNAPS: any[] = [];
  let tuneDaysMax = 0, blindDaysMax = 0;
  for (const symbol of SYMBOLS) {
    const bars = perSymbol[symbol].bars;
    const snaps = computeSnapshots(bars);
    const cutoffTs = bars[bars.length - 1].t - 365 * 86400;
    const tuneIdx = bars.findIndex((b) => b.t >= cutoffTs);
    const tuneBars = bars.slice(tuneIdx), tuneSnaps = snaps.slice(tuneIdx);
    const blindBars = bars.slice(0, tuneIdx), blindSnaps = snaps.slice(0, tuneIdx);
    TUNE.push(...tuneBars); TUNE_SNAPS.push(...tuneSnaps);
    BLIND.push(...blindBars); BLIND_SNAPS.push(...blindSnaps);
    tuneDaysMax = Math.max(tuneDaysMax, (tuneBars[tuneBars.length - 1].t - tuneBars[0].t) / 86400);
    blindDaysMax = Math.max(blindDaysMax, (blindBars[blindBars.length - 1].t - blindBars[0].t) / 86400);
  }
  console.log(`TUNE: ${TUNE.length} bars (~${tuneDaysMax.toFixed(0)}d)   BLIND: ${BLIND.length} bars (~${blindDaysMax.toFixed(0)}d, never touched until now)\n`);

  for (const c of CANDIDATES) {
    // Split-half stability on TUNE (still pooled per-symbol, so slice each symbol's TUNE half separately to avoid mixing series).
    let h1Pnl = 0, h2Pnl = 0;
    for (const symbol of SYMBOLS) {
      const bars = perSymbol[symbol].bars;
      const snaps = computeSnapshots(bars);
      const cutoffTs = bars[bars.length - 1].t - 365 * 86400;
      const tuneIdx = bars.findIndex((b) => b.t >= cutoffTs);
      const tuneBars = bars.slice(tuneIdx), tuneSnaps = snaps.slice(tuneIdx);
      const mid = Math.floor(tuneBars.length / 2);
      const halfDays = tuneDaysMax / 2;
      h1Pnl += runOne(tuneBars.slice(0, mid), tuneSnaps.slice(0, mid), c.code, halfDays).annPnl;
      h2Pnl += runOne(tuneBars.slice(mid), tuneSnaps.slice(mid), c.code, halfDays).annPnl;
    }
    const tuneStable = h1Pnl > 0 && h2Pnl > 0;
    const tuneFull = runOne(TUNE, TUNE_SNAPS, c.code, tuneDaysMax);
    const blind = runOne(BLIND, BLIND_SNAPS, c.code, blindDaysMax);
    const blindPassed = blind.winRate > 50 && blind.totalPnl > 0;

    console.log(
      `${c.label.padEnd(45)}\n` +
      `  TUNE:  trades=${tuneFull.trades} win%=${tuneFull.winRate.toFixed(1)} ann=$${tuneFull.annPnl.toFixed(0)} H1=$${h1Pnl.toFixed(0)} H2=$${h2Pnl.toFixed(0)} ${tuneStable ? "STABLE+" : "unstable"}\n` +
      `  BLIND: trades=${blind.trades} win%=${blind.winRate.toFixed(1)} ann=$${blind.annPnl.toFixed(0)} ${blindPassed ? "PASSED" : "FAILED"}\n` +
      `  => ${tuneStable && blindPassed ? "*** QUALIFIES ***" : "reject"}\n`
    );
  }
}

main();
