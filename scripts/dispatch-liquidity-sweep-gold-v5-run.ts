// Liquidity Sweep v5: RSI-extreme context. Branches from v1 (research-59,
// PF 0.93). Requires RSI to have touched an extreme (<35 for the long setup,
// >65 for the short setup) within the prior 8 bars before the sweep - a
// reversal off a genuine oversold/overbought stretch is more plausible than
// a sweep with no momentum exhaustion behind it at all.
// Usage: npx tsx scripts/dispatch-liquidity-sweep-gold-v5-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Fifth version of Liquidity Sweep (gold), branching from v1 (research-59, PF 0.93). Requires RSI to have touched an extreme (<35 within the prior 8 bars for a long sweep, >65 for a short sweep) before the sweep fires - filtering for sweeps that follow genuine momentum exhaustion rather than firing on any wick-and-reclaim regardless of prior momentum.";

const candidates = [
  {
    label: "Liquidity Sweep (20-bar, gold, RSI-extreme)",
    rationale:
      "Branches from research-59 (unfiltered, PF 0.93), requiring a recent RSI extreme (<35 in the prior 8 bars for longs, >65 for shorts) before the sweep. Neither the depth filter (v2) nor the ADX filter (v3) improved on the baseline - this tries momentum context instead: a sweep after genuine oversold/overbought exhaustion should be a more credible reversal than one with no momentum extreme behind it.",
    code: `
var i = bars.length - 1;
var lookback = 20;
if (i < lookback + 1) return null;
var c = bars[i];

var hi = -Infinity, lo = Infinity;
for (var k = i - lookback; k < i; k++) {
  if (bars[k].h > hi) hi = bars[k].h;
  if (bars[k].l < lo) lo = bars[k].l;
}

var recentOversold = false, recentOverbought = false;
for (var j = 1; j <= 8; j++) {
  var s2 = snaps[i - j];
  if (!s2 || s2.rsi == null) break;
  if (s2.rsi < 35) recentOversold = true;
  if (s2.rsi > 65) recentOverbought = true;
}

if (c.l < lo && c.c > lo && recentOversold) {
  return { side: "long", note: "liquidity sweep below " + lookback + "-bar low after RSI oversold, closed back above" };
}
if (c.h > hi && c.c < hi && recentOverbought) {
  return { side: "short", note: "liquidity sweep above " + lookback + "-bar high after RSI overbought, closed back below" };
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
