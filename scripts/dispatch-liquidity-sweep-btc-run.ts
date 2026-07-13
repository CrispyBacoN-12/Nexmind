// Ports the ORIGINAL unfiltered Liquidity Sweep (research-59, gold, PF 0.93
// near-breakeven) to BTC-USD - a structural range-reversion pattern (no
// trend gate at all), which may fit a market that chops/consolidates more
// than gold does.
// Usage: npx tsx scripts/dispatch-liquidity-sweep-btc-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Ports the original unfiltered Liquidity Sweep pattern (research-59, gold, PF 0.93 near-breakeven) to BTC-USD, unchanged. It's a structural range-reversion pattern with no trend gate - testing whether a more consolidation-prone market gives it a real edge where gold only broke even.";

const candidates = [
  {
    label: "Liquidity Sweep (20-bar, BTC-USD)",
    rationale:
      "Same sweep-and-reclaim logic as research-59 (gold, PF 0.93), ported unchanged to BTC-USD. This pattern has no trend-direction requirement at all - a pure structural range-reversion bet - so a market that spends more time consolidating/ranging than gold may show a clearer edge.",
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
  const { runId } = await runResearch(brief, "BTC-USD", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
