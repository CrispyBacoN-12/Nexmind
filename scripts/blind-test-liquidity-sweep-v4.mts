// Blind test for research-62 (Liquidity Sweep, gold, SMA50-aligned): the
// other profitable Liquidity Sweep variant (PF 1.13, +$9.24, 54 trades on the
// 1y in-sample backtest) - thinner sample than v5/research-63, which already
// failed its own blind test (win% 52.1 but pnl -$1520). Same held-out
// methodology: test on GC=F 1h bars OLDER than the most recent 365 days.
// Usage: npx tsx scripts/blind-test-liquidity-sweep-v4.mts
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const RISK_USD = 100;
const TP1_MULT = 1.2;

const CODE = `
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
    console.log(`Held-out (blind) segment: ${holdout.length} bars, ~${holdoutDays.toFixed(0)} days, never used in any prior sweep\n`);

    const compiled = compileStrategy(CODE);
    const entry = (i: number) => compiled.invoke(holdout, snaps, i)?.side ?? null;
    const result = backtestCandles(SYMBOL, holdout, 0.1, undefined, entry, true, TP1_MULT);
    const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
    const wins = result.trades.filter((t) => t.outcome === "win").length;
    const winRate = result.trades.length ? (wins / result.trades.length) * 100 : 0;
    const totalPnl = rs.reduce((s, r) => s + r * RISK_USD, 0);
    const yearFactor = 365 / holdoutDays;
    console.log(
      `Liquidity Sweep (SMA50-aligned)  trades=${String(result.trades.length).padStart(4)} win%=${winRate.toFixed(1).padStart(5)} ` +
      `pnl=$${totalPnl.toFixed(0).padStart(6)} ann=$${(totalPnl * yearFactor).toFixed(0).padStart(6)} ` +
      `${winRate > 50 && totalPnl > 0 ? "PASSED blind test" : "FAILED blind test"}`
    );
  }
}

main();
