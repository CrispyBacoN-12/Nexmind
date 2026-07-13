// Dispatches "Engulfing + SMA50 trend filter" for BTC-USD - the same logic
// already validated on gold (research-48/dispatch-engulfing-run.ts, blind-test
// 61.0% win rate) has never been tested on crypto. Vault tag coverage showed
// candle patterns only ever ran on GC=F while Donchian breakout only ever ran
// on BTC-USD - this fills that gap by porting the pattern across markets
// instead of designing something new. Manual candidate -> no Anthropic API
// call, no cost.
// Usage: npx tsx scripts/dispatch-engulfing-btc-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Candle-pattern entry signal for BTC-USD: bullish/bearish engulfing pattern, gated by a SMA50 trend filter (only take longs above SMA50, shorts below). Same logic already validated on gold (research-48, blind-tested 61.0% win rate) - ported here to test whether the edge holds on crypto, which has never had a candle-pattern strategy tried on it.";

const candidates = [
  {
    label: "Engulfing + SMA50 trend filter (BTC)",
    rationale:
      "Identical logic to research-48 (Engulfing + SMA50 trend filter, gold), applied to BTC-USD instead. Gold version blind-tested at 61.0% win rate / +$3,420/yr annualized on held-out data. Every candle-pattern strategy tried so far (engulfing, hammer/shooting star) ran on GC=F only; every Donchian breakout attempt ran on BTC-USD only - this is the first cross of pattern-type x market that hasn't been tried, testing whether a gold-validated price-action edge transfers to a structurally different asset.",
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
  const { runId } = await runResearch(brief, "BTC-USD", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
