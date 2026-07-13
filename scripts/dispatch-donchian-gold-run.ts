// Dispatches a clean 20-bar Donchian breakout candidate for gold (GC=F).
// Donchian breakout has only ever been tried on BTC-USD before (research-6,
// research-38), and both of those were internally contradictory/over-filtered
// AI drafts (research-6's brief calls itself "mean-reversion... low-ADX chop"
// while its code requires ADX>25; research-38 was a throwaway "test cost/
// slippage modeling" dispatch) - neither is a fair test of the pattern itself.
// This is a minimal, non-contradictory version: breakout of the prior 20-bar
// high/low, gated only by a basic ADX trend-strength floor. Manual candidate
// -> no Anthropic API call, no cost.
// Usage: npx tsx scripts/dispatch-donchian-gold-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "20-bar Donchian channel breakout for gold (GC=F): long when close breaks above the highest high of the prior 20 bars, short when it breaks below the lowest low, gated by ADX >= 22 for basic trend-strength confirmation. Donchian breakout has only ever been tested on BTC-USD before, with two contradictory/over-filtered drafts that never got a fair read on the pattern itself - this is a minimal, clean version to test on gold.";

const candidates = [
  {
    label: "20-Bar Donchian Breakout (gold, clean)",
    rationale:
      "Minimal Donchian breakout: no volume filter, no RSI/MACD/SMA stacking - just the channel break plus an ADX floor so the pattern isn't tested in dead/rangebound conditions. Every prior Donchian attempt (research-6, research-38) ran on BTC-USD and was internally inconsistent (mismatched brief/code, or a throwaway test dispatch), so neither is a real prior result for this pattern. This gives Donchian breakout its first honest test, and its first test on gold.",
    code: `
var i = bars.length - 1;
var lookback = 20;
if (i < lookback + 1) return null;
var s = snaps[i];
if (s.adx == null) return null;
if (s.adx < 22) return null;

var hi = -Infinity, lo = Infinity;
for (var k = i - lookback; k < i; k++) {
  if (bars[k].h > hi) hi = bars[k].h;
  if (bars[k].l < lo) lo = bars[k].l;
}
var c = bars[i].c;
var pc = bars[i - 1].c;

if (pc <= hi && c > hi) {
  return { side: "long", note: "20-bar Donchian breakout long, ADX " + Math.round(s.adx) };
}
if (pc >= lo && c < lo) {
  return { side: "short", note: "20-bar Donchian breakout short, ADX " + Math.round(s.adx) };
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
