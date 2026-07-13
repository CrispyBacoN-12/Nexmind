// Liquidity Sweep v6: shorter lookback. Branches from v1 (research-59,
// PF 0.93, 20-bar lookback). Tries a 10-bar lookback instead - a shorter,
// more locally-relevant level, testing whether the 20-bar window was too
// wide to reflect levels that are actually being defended in the moment.
// Usage: npx tsx scripts/dispatch-liquidity-sweep-gold-v6-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Sixth version of Liquidity Sweep (gold), branching from v1 (research-59, PF 0.93, 20-bar lookback). Same unfiltered logic, shortened lookback to 10 bars - testing whether a more locally-relevant level (vs. one that may be stale after 20 bars) changes the result.";

const candidates = [
  {
    label: "Liquidity Sweep (10-bar, gold)",
    rationale:
      "Same sweep-and-reclaim logic as research-59, shortening the lookback from 20 bars to 10. A shorter window reflects a level that's more likely still 'live' in the market's attention, vs. a 20-bar high/low that may be stale and irrelevant by the time price reaches it.",
    code: `
var i = bars.length - 1;
var lookback = 10;
if (i < lookback + 1) return null;
var c = bars[i];

var hi = -Infinity, lo = Infinity;
for (var k = i - lookback; k < i; k++) {
  if (bars[k].h > hi) hi = bars[k].h;
  if (bars[k].l < lo) lo = bars[k].l;
}

if (c.l < lo && c.c > lo) {
  return { side: "long", note: "liquidity sweep below " + lookback + "-bar low, closed back above" };
}
if (c.h > hi && c.c < hi) {
  return { side: "short", note: "liquidity sweep above " + lookback + "-bar high, closed back below" };
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
