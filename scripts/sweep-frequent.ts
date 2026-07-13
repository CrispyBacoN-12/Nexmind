// Goal (user-specified): win% > 60, trades roughly daily (not just a handful
// per year), risk 1% per trade (already true via the engine fix — sizing is
// dynamic per portfolio risk%, not something a strategy itself controls).
// Existing run #8 candidates only fire every 3-14 days. This sweeps
// higher-frequency entry signals (looser filters, momentum/cross triggers)
// against the SAME tight ladder (SL=1.5xATR) across several TP multiples, on
// both 1h and 15m GC=F data, looking for something that clears >60% win rate
// AND trades close to daily.
// Usage: npx tsx scripts/sweep-frequent.ts

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles, summarizeBacktest } from "../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const RUNS: Array<{ range: "3mo" | "1y" | "1mo"; interval: "1h" | "15m" }> = [
  { range: "3mo", interval: "1h" },
  { range: "1y", interval: "1h" },
  { range: "1mo", interval: "15m" },
];
const TP_MULTS = [0.8, 1.0, 1.2];

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
  {
    label: "RSI-50 Momentum Cross",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.rsi == null || p.rsi == null) return null;
if (p.rsi <= 50 && s.rsi > 50) return { side: "long", note: "RSI cross above 50" };
if (p.rsi >= 50 && s.rsi < 50) return { side: "short", note: "RSI cross below 50" };
return null;
`,
  },
  {
    label: "MACD Histogram Flip",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.macdHist == null || p.macdHist == null) return null;
if (p.macdHist <= 0 && s.macdHist > 0) return { side: "long", note: "MACD hist flips positive" };
if (p.macdHist >= 0 && s.macdHist < 0) return { side: "short", note: "MACD hist flips negative" };
return null;
`,
  },
  {
    label: "Price vs SMA20 Cross",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.sma20 == null || p.sma20 == null || s.price == null || p.price == null) return null;
if (p.price <= p.sma20 && s.price > s.sma20) return { side: "long", note: "price crosses above sma20" };
if (p.price >= p.sma20 && s.price < s.sma20) return { side: "short", note: "price crosses below sma20" };
return null;
`,
  },
  {
    label: "DI-Cross + ADX>15 filter",
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
    label: "RSI-50 Cross + trend filter (SMA20 vs SMA50)",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.rsi == null || p.rsi == null || s.sma20 == null || s.sma50 == null) return null;
if (p.rsi <= 50 && s.rsi > 50 && s.sma20 > s.sma50) return { side: "long", note: "RSI cross above 50, uptrend" };
if (p.rsi >= 50 && s.rsi < 50 && s.sma20 < s.sma50) return { side: "short", note: "RSI cross below 50, downtrend" };
return null;
`,
  },
];

async function main() {
  for (const { range, interval } of RUNS) {
    const resp = await fetchCandles(SYMBOL, range, interval);
    const bars = resp.candles;
    const snaps = computeSnapshots(bars);
    const days = (bars[bars.length - 1].t - bars[0].t) / 86400;
    console.log(`\n===== ${SYMBOL} ${interval}/${range} (${bars.length} bars, ~${days.toFixed(0)} days) =====`);
    for (const c of CANDIDATES) {
      let compiled;
      try {
        compiled = compileStrategy(c.code);
      } catch (e) {
        console.log(`${c.label.padEnd(45)} SAFETY REJECTED: ${e}`);
        continue;
      }
      const entryFn = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
      for (const tpMult of TP_MULTS) {
        const result = backtestCandles(SYMBOL, bars, 0.1, undefined, entryFn, true, tpMult);
        const s = summarizeBacktest(result.trades);
        const perDay = s.trades / days;
        console.log(
          `${c.label.padEnd(45)} tp=${tpMult.toFixed(1)} trades=${String(s.trades).padStart(4)} ` +
          `win%=${s.winRate.toFixed(0).padStart(3)} trades/day=${perDay.toFixed(2).padStart(5)} ` +
          `avgR=${(s.avgR ?? 0).toFixed(2).padStart(6)} totalPnl=${s.totalPnl.toFixed(2).padStart(8)}`
        );
      }
    }
  }
}

main();
