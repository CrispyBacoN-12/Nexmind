// Tuning pass on research-52 (20-Bar Donchian Breakout, gold, clean): PF 0.99,
// -$4.76/277 trades - essentially break-even, win rate fine (57.8%) but losers
// slightly outweigh winners on average. Single change: require ADX rising
// (not just >=22 static) so breakouts only fire while the trend is actively
// strengthening, not just already-elevated-but-flattening. One variable
// changed, nothing else stacked, so the result is attributable. Manual
// candidate -> no API cost.
// Usage: npx tsx scripts/dispatch-donchian-gold-v2-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Tuning pass on research-52 (20-Bar Donchian Breakout, gold): baseline was break-even (PF 0.99, -$4.76 over 277 trades). Same logic, one change: require ADX rising vs. the prior bar (not just a static >=22 floor) so breakouts only fire while trend strength is actively building, filtering breakouts that occur as a trend is already flattening out.";

const candidates = [
  {
    label: "20-Bar Donchian Breakout (gold, ADX-rising)",
    rationale:
      "Same channel-break logic as research-52, adding one condition: ADX must be rising vs. the prior bar, not just above the 22 floor. Isolates whether the break-even result was caused by firing on breakouts where trend strength had already peaked and was rolling over - a common cause of Donchian whipsaw.",
    code: `
var i = bars.length - 1;
var lookback = 20;
if (i < lookback + 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null) return null;
if (s.adx < 22) return null;
if (s.adx <= p.adx) return null;

var hi = -Infinity, lo = Infinity;
for (var k = i - lookback; k < i; k++) {
  if (bars[k].h > hi) hi = bars[k].h;
  if (bars[k].l < lo) lo = bars[k].l;
}
var c = bars[i].c;
var pc = bars[i - 1].c;

if (pc <= hi && c > hi) {
  return { side: "long", note: "20-bar Donchian breakout long, ADX rising to " + Math.round(s.adx) };
}
if (pc >= lo && c < lo) {
  return { side: "short", note: "20-bar Donchian breakout short, ADX rising to " + Math.round(s.adx) };
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
