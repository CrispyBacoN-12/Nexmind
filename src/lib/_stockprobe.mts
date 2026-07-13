import { fetchCandles } from "@/lib/marketData";
import { backtestCandles, summarizeBacktest } from "@/lib/backtest/engine";
import { getStrategy } from "@/lib/trading/strategies";
import type { Range, Interval } from "@/lib/yahoo";

const symbols = ["AAPL", "NVDA", "MSFT", "AMD"];
const tfs: { i: Interval; r: Range }[] = [
  { i: "15m", r: "1mo" },
  { i: "1h", r: "1y" },
  { i: "1d", r: "2y" },
];
const strats = ["trend-pullback", "mean-rev", "orb", "combo-vote"];

for (const sym of symbols) {
  for (const tf of tfs) {
    let line = `${sym.padEnd(5)} ${tf.i}/${tf.r.padEnd(3)} | `;
    try {
      const resp = await fetchCandles(sym, tf.r, tf.i);
      for (const key of strats) {
        const ev = getStrategy(key)!.build(resp.candles);
        const bt = backtestCandles(resp.symbol, resp.candles, 0.1, undefined, (i) => ev(i)?.side ?? null);
        const s = summarizeBacktest(bt.trades);
        line += `${key.split("-")[0].padEnd(5)} R=${(s.avgR ?? 0).toFixed(2).padStart(5)}(n${String(s.trades).padStart(3)}) `;
      }
    } catch (e) { line += `ERR ${String(e).slice(0, 40)}`; }
    console.log(line);
  }
}
