// Ports the ORIGINAL unfiltered Liquidity Sweep (research-59, gold, PF 0.93
// near-breakeven) to EURUSD=X - forex majors are known for range-bound
// consolidation stretches, which may suit this trend-agnostic structural
// pattern better than gold did.
// Usage: npx tsx scripts/dispatch-liquidity-sweep-eurusd-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Ports the original unfiltered Liquidity Sweep pattern (research-59, gold, PF 0.93 near-breakeven) to EURUSD=X, unchanged. Forex majors are known for extended range-bound stretches - testing whether this trend-agnostic structural pattern finds a real edge there.";

const candidates = [
  {
    label: "Liquidity Sweep (20-bar, EURUSD)",
    rationale:
      "Same sweep-and-reclaim logic as research-59 (gold, PF 0.93), ported unchanged to EURUSD=X. No trend-direction requirement - a pure structural range-reversion bet - and forex majors spend more time in consolidation than gold, which may reveal a clearer edge.",
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
  const { runId } = await runResearch(brief, "EURUSD=X", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
