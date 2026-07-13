// Dispatches "Engulfing + SMA50 trend filter" as a candle-pattern candidate
// for gold (GC=F) - a genuinely different angle from the live DI-based
// strategies (research-25 DI-Cross, research-30 DI-Dominance Widening):
// price-action pattern instead of indicator crossover/momentum. Blind-tested
// on GC=F 1h bars OLDER than the most recent 365 days (scripts/blind-test-
// engulfing.mts, never used to tune this code): 351 trades, 61.0% win rate,
// +$3,420/yr pooled annualized - raw engulfing (no filter) also passed
// (499 trades, 59.1% win, +$3,200/yr) but the SMA50 filter improved both
// win rate and PnL while cutting trade count ~30%, so the filtered version
// is the one dispatched here.
// Usage: npx tsx scripts/dispatch-engulfing-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Candle-pattern entry signal for gold (GC=F): bullish/bearish engulfing pattern, gated by a SMA50 trend filter (only take longs above SMA50, shorts below) so the pattern trades with the prevailing trend instead of against it. Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade.";

const candidates = [
  {
    label: "Engulfing + SMA50 trend filter",
    rationale:
      "Classic bullish/bearish engulfing candlestick pattern, filtered to only fire with the trend (longs above SMA50, shorts below). Blind-tested on GC=F 1h bars older than the most recent 365 days (held out from any tuning): 351 trades, 61.0% win rate, +$3,420/yr pooled annualized. Raw engulfing with no filter also passed blind test (499 trades, 59.1% win, +$3,200/yr) but the SMA50 filter improved both win rate and PnL while reducing trade count ~30% - better quality per trade. Complements the existing DI-based strategies (research-25, research-30) with a pure price-action signal instead of an indicator-derived one.",
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
];

async function main() {
  const { runId } = await runResearch(brief, "GC=F", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
