// Brand-new pattern, never coded before: Liquidity Sweep. "liquidity sweep"
// is in export.ts's PATTERN_TAGS dictionary but had 0 strategies and (unlike
// Doji) was never even blind-tested - this is its first real attempt.
// Definition used here: price wicks beyond the prior N-bar high/low (sweeping
// resting stop-loss/breakout liquidity) but the candle CLOSES back inside the
// prior range - a classic stop-hunt-then-reversal signature, distinct from a
// genuine breakout (which closes beyond the level, like the Donchian
// strategies). Tested on gold first, same as every other new pattern
// (Engulfing, Hammer/Shooting Star) got its first test on GC=F before being
// ported elsewhere. Manual candidate -> no API cost.
// Usage: npx tsx scripts/dispatch-liquidity-sweep-gold-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Liquidity Sweep pattern for gold (GC=F), tested for the first time ever in this project: price wicks beyond the prior 20-bar high/low (sweeping resting liquidity) but closes back inside that range on the same bar - a stop-hunt-then-reversal signature, the opposite read of a genuine breakout. Long on a sweep below the prior low that closes back above it; short on a sweep above the prior high that closes back below it.";

const candidates = [
  {
    label: "Liquidity Sweep (20-bar, gold)",
    rationale:
      "First-ever test of the Liquidity Sweep pattern - it was in the tag dictionary but had zero strategies and zero blind tests before this. Distinguishes itself from Donchian breakout (which requires the close to break past the level) by requiring the exact opposite: a wick beyond the level followed by a close back inside it, on the theory that a failed breakout attempt reveals the level was defended and the initial move was just stop-hunting resting orders.",
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
  const { runId } = await runResearch(brief, "GC=F", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
