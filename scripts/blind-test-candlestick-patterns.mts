// Blind test for the 10 built-in candlestick pattern strategies + the curated
// candlestick-any combo, on held-out data. Same methodology as
// scripts/blind-test-engulfing.mts / blind-test-gold.ts: test on bars OLDER
// than the most recent 365 days — a window never touched by the 1h/3mo
// GC=F + BTC-USD sweep that set each pattern's preferredExit and picked the
// combo's 3 surviving members.
// Usage: node --import tsx scripts/blind-test-candlestick-patterns.mts

import "dotenv/config";
import { fetchCandles } from "../src/lib/marketData";
import { getStrategy } from "../src/lib/trading/strategies";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOLS = ["GC=F", "BTC-USD"];
const RISK_USD = 100;
const KEYS = [
  "hammer", "shooting-star", "bullish-engulfing", "bearish-engulfing",
  "piercing-line", "dark-cloud-cover", "morning-star", "evening-star",
  "three-white-soldiers", "three-black-crows", "candlestick-any",
];

async function main() {
  for (const symbol of SYMBOLS) {
    let resp;
    try {
      resp = await fetchCandles(symbol, "2y", "1h");
    } catch (e) {
      console.log(`\n${symbol} 1h/2y: FETCH FAILED: ${e}`);
      continue;
    }
    const bars = resp.candles;
    const totalDays = (bars[bars.length - 1].t - bars[0].t) / 86400;
    console.log(`\n${symbol} 1h/2y: got ${bars.length} bars spanning ~${totalDays.toFixed(0)} days`);

    const cutoffTs = bars[bars.length - 1].t - 365 * 86400;
    const holdout = bars.filter((b) => b.t < cutoffTs);
    if (holdout.length < 100) {
      console.log(`Held-out segment too small (${holdout.length} bars) - skipping`);
      continue;
    }
    const holdoutDays = (holdout[holdout.length - 1].t - holdout[0].t) / 86400;
    console.log(`Held-out (blind) segment: ${holdout.length} bars, ~${holdoutDays.toFixed(0)} days, never used in the tuning sweep\n`);

    for (const key of KEYS) {
      const strat = getStrategy(key);
      if (!strat) { console.log(`${key.padEnd(24)} NOT FOUND`); continue; }
      const evaluator = strat.build(holdout);
      const entry = (i: number) => evaluator(i)?.side ?? null;
      const exit = strat.preferredExit;
      const result = backtestCandles(symbol, holdout, 0.1, undefined, entry, exit?.singleTarget ?? false, exit?.tp1Mult, exit?.costs);
      const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
      const wins = result.trades.filter((t) => t.outcome === "win").length;
      const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
      const totalPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);
      const avgR = rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : 0;
      console.log(
        `${key.padEnd(24)} trades=${String(result.trades.length).padStart(4)} win%=${winRate.toFixed(1).padStart(5)} ` +
        `avgR=${avgR.toFixed(3).padStart(7)} pnl=$${totalPnl.toFixed(0).padStart(6)} ` +
        `${result.trades.length < 15 ? "TOO FEW TRADES - inconclusive" : winRate > 50 && totalPnl > 0 ? "PASSED blind test" : "FAILED blind test"}`
      );
    }
  }
}

main();
