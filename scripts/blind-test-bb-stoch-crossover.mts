// Blind test for research-76 (Bollinger %B + Stoch %K/%D Crossover Fade,
// gold): 61 trades, PF 1.06, win 57.4% on the 1y in-sample backtest - the
// first range-fade candidate this session using the newly-added Bollinger
// %B/bandwidth and Stochastic %K/%D indicators. Same held-out methodology as
// every other blind test this session: GC=F 1h bars OLDER than the most
// recent 365 days.
// Usage: npx tsx scripts/blind-test-bb-stoch-crossover.mts
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const RISK_USD = 100;
const TP1_MULT = 1.2;

const CODE = `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.bbPercentB == null || p.bbPercentB == null) return null;
if (s.stochK == null || s.stochD == null || p.stochK == null || p.stochD == null) return null;
if (s.adx > 25) return null;
var crossDown = p.stochK >= p.stochD && s.stochK < s.stochD && p.stochK > 80;
var crossUp = p.stochK <= p.stochD && s.stochK > s.stochD && p.stochK < 20;
if (p.bbPercentB > 1 && crossDown) return { side: "short", note: "band breach + stoch %K/%D bear cross" };
if (p.bbPercentB < 0 && crossUp) return { side: "long", note: "band breach + stoch %K/%D bull cross" };
return null;
`;

async function main() {
  for (const range of ["2y", "5y"] as const) {
    let resp;
    try {
      resp = await fetchCandles(SYMBOL, range, "1h");
    } catch (e) {
      console.log(`\n${SYMBOL} 1h/${range}: FETCH FAILED: ${e}`);
      continue;
    }
    const bars = resp.candles;
    const totalDays = (bars[bars.length - 1].t - bars[0].t) / 86400;
    console.log(`\n${SYMBOL} 1h/${range}: got ${bars.length} bars spanning ~${totalDays.toFixed(0)} days`);
    if (totalDays < 400) {
      console.log(`(not meaningfully more than the 1y window already tested - skipping)`);
      continue;
    }

    const cutoffTs = bars[bars.length - 1].t - 365 * 86400;
    const holdout = bars.filter((b) => b.t < cutoffTs);
    if (holdout.length < 100) {
      console.log(`Held-out segment too small (${holdout.length} bars) - skipping`);
      continue;
    }
    const holdoutDays = (holdout[holdout.length - 1].t - holdout[0].t) / 86400;
    const snaps = computeSnapshots(holdout);
    console.log(`Held-out (blind) segment: ${holdout.length} bars, ~${holdoutDays.toFixed(0)} days, never used in in-sample dispatch\n`);

    const compiled = compileStrategy(CODE);
    const entry = (i: number) => compiled.invoke(holdout, snaps, i)?.side ?? null;
    const result = backtestCandles(SYMBOL, holdout, 0.1, undefined, entry, true, TP1_MULT);
    const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
    const wins = result.trades.filter((t) => t.outcome === "win").length;
    const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
    const totalPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);
    const yearFactor = 365 / holdoutDays;
    console.log(
      `BB %B + Stoch Crossover Fade  trades=${String(result.trades.length).padStart(4)} win%=${winRate.toFixed(1).padStart(5)} ` +
      `pnl=$${totalPnl.toFixed(0).padStart(6)} ann=$${(totalPnl * yearFactor).toFixed(0).padStart(6)} ` +
      `${winRate > 50 && totalPnl > 0 ? "PASSED blind test" : "FAILED blind test"}`
    );
  }
}

main();
