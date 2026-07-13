// Second tuning pass on Liquidity Sweep (gold), different axis than v2.
// v1 (research-59, unfiltered): PF 0.93, -$39.10/394 trades - still the best
// version. v2 (research-60, depth>=0.3x ATR) made it worse (PF 0.84):
// filtering by wick size wasn't the right lever. This tries a market-regime
// filter instead: require ADX < 25, on the theory that a sweep-and-reclaim
// is fundamentally a ranging/reversal signature, and firing during strong
// trends (where a "reclaim" is often just a pause before continuation, not a
// real reversal) is what's diluting the edge. One variable changed from the
// v1 baseline. Manual candidate -> no API cost.
// Usage: npx tsx scripts/dispatch-liquidity-sweep-gold-v3-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Third version of Liquidity Sweep (gold), branching from v1 (research-59, PF 0.93, -$39.10/394 trades) rather than v2 (depth filter, which made things worse). This time: require ADX < 25, restricting the pattern to ranging/low-trend conditions - a sweep-and-reclaim is a reversal signature, and firing during strong trends may just be catching pauses before continuation rather than genuine reversals.";

const candidates = [
  {
    label: "Liquidity Sweep (20-bar, gold, ADX<25)",
    rationale:
      "Branches from research-59 (unfiltered baseline, PF 0.93) rather than research-60 (depth filter, which underperformed) - testing a market-regime filter instead of a candle-shape filter. Restricting to ADX < 25 isolates sweeps that occur in genuinely ranging conditions, where a failed breakout is more likely a real stop-hunt-and-reverse than a brief pause inside an ongoing trend.",
    code: `
var i = bars.length - 1;
var lookback = 20;
if (i < lookback + 1) return null;
var c = bars[i];
var s = snaps[i];
if (s.adx == null) return null;
if (s.adx >= 25) return null;

var hi = -Infinity, lo = Infinity;
for (var k = i - lookback; k < i; k++) {
  if (bars[k].h > hi) hi = bars[k].h;
  if (bars[k].l < lo) lo = bars[k].l;
}

if (c.l < lo && c.c > lo) {
  return { side: "long", note: "liquidity sweep below " + lookback + "-bar low, ADX " + Math.round(s.adx) + ", closed back above" };
}
if (c.h > hi && c.c < hi) {
  return { side: "short", note: "liquidity sweep above " + lookback + "-bar high, ADX " + Math.round(s.adx) + ", closed back below" };
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
