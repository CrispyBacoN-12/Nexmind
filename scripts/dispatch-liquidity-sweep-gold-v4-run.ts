// Liquidity Sweep v4: SMA50 trend alignment. v1 (research-59, unfiltered):
// PF 0.93. v2 (depth filter) and v3 (ADX<25) both degraded to ~0.83 - two
// different axes converged on the same worse subset, so this branches from
// v1 with a different idea entirely: only take the long sweep when price is
// above SMA50, only the short sweep when below - trading the reversal WITH
// the broader trend instead of taking every sweep regardless of context.
// This is the same filter that made Engulfing the best-performing pattern in
// the whole project (research-48, 61% blind-test win rate on gold).
// Usage: npx tsx scripts/dispatch-liquidity-sweep-gold-v4-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Fourth version of Liquidity Sweep (gold), branching from v1 (research-59, PF 0.93). This time: gate by SMA50 trend alignment - only take the bullish sweep-and-reclaim when price is above SMA50, only the bearish one when below. Same trend filter that made Engulfing the best-performing pattern in this project (research-48, 61% blind-test win rate).";

const candidates = [
  {
    label: "Liquidity Sweep (20-bar, gold, SMA50-aligned)",
    rationale:
      "Branches from research-59 (unfiltered, PF 0.93), adding an SMA50 trend-alignment gate: long sweep only fires above SMA50, short sweep only below. v2 (depth) and v3 (ADX) both filtered by 'how the sweep bar looked' and converged on the same worse result - this filters by broader market context instead, on the theory that a sweep-and-reclaim with the trend is a real continuation-pullback while one against the trend is more likely to fail.",
    code: `
var i = bars.length - 1;
var lookback = 20;
if (i < lookback + 1) return null;
var c = bars[i];
var s = snaps[i];
if (s.sma50 == null) return null;

var hi = -Infinity, lo = Infinity;
for (var k = i - lookback; k < i; k++) {
  if (bars[k].h > hi) hi = bars[k].h;
  if (bars[k].l < lo) lo = bars[k].l;
}

if (c.l < lo && c.c > lo && c.c > s.sma50) {
  return { side: "long", note: "liquidity sweep below " + lookback + "-bar low, above SMA50, closed back above" };
}
if (c.h > hi && c.c < hi && c.c < s.sma50) {
  return { side: "short", note: "liquidity sweep above " + lookback + "-bar high, below SMA50, closed back below" };
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
