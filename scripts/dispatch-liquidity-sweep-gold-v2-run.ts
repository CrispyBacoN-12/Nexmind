// Tuning pass on research-59 (Liquidity Sweep, gold): PF 0.93, -$39.10/394
// trades - the closest-to-break-even first attempt of any new pattern tried
// so far. Baseline fired on ANY wick beyond the 20-bar high/low that closed
// back inside, even a one-tick poke. Single change: require the sweep depth
// (how far the wick pokes beyond the level) to be at least 0.3x ATR, filtering
// trivial pokes that aren't a meaningful stop-hunt. One variable changed.
// Manual candidate -> no API cost.
// Usage: npx tsx scripts/dispatch-liquidity-sweep-gold-v2-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Tuning pass on research-59 (Liquidity Sweep, gold): baseline was near break-even (PF 0.93, -$39.10 over 394 trades) but fired on any wick beyond the 20-bar high/low, including trivial one-tick pokes. Same logic, one change: require the sweep depth beyond the level to be at least 0.3x ATR, so only meaningful stop-hunts qualify.";

const candidates = [
  {
    label: "Liquidity Sweep (20-bar, gold, depth-filtered)",
    rationale:
      "Same sweep-and-reclaim logic as research-59, adding a minimum sweep-depth requirement (wick must clear the level by >= 0.3x ATR). The baseline's near-break-even result (PF 0.93) suggests a real but diluted edge - many of its 394 trades were likely trivial pokes that aren't genuine liquidity grabs. Isolates whether filtering for depth concentrates the edge the way ATR-body filtering did for the Engulfing/BTC line.",
    code: `
var i = bars.length - 1;
var lookback = 20;
if (i < lookback + 1) return null;
var c = bars[i];
var s = snaps[i];
if (s.atr == null) return null;

var hi = -Infinity, lo = Infinity;
for (var k = i - lookback; k < i; k++) {
  if (bars[k].h > hi) hi = bars[k].h;
  if (bars[k].l < lo) lo = bars[k].l;
}

var sweepDepthLow = lo - c.l;
var sweepDepthHigh = c.h - hi;

if (c.l < lo && c.c > lo && sweepDepthLow >= s.atr * 0.3) {
  return { side: "long", note: "liquidity sweep below " + lookback + "-bar low, depth " + sweepDepthLow.toFixed(2) + ", closed back above" };
}
if (c.h > hi && c.c < hi && sweepDepthHigh >= s.atr * 0.3) {
  return { side: "short", note: "liquidity sweep above " + lookback + "-bar high, depth " + sweepDepthHigh.toFixed(2) + ", closed back below" };
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
