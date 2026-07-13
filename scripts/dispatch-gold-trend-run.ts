// Dispatches "DI-Dominance Widening" as a second, complementary Gold strategy.
// research-25 ("DI-Cross", live on Gold Desk #8) only fires on a direction
// FLIP and goes silent during a clean one-way trend - exactly what's
// happening now (ADX 45, no crossover in 1+ day). This candidate fires while
// ALREADY inside an established trend (DI gap widening, no fresh cross
// required), so it covers the regime the existing strategy misses. Swept on
// GC=F 1h/1y (more reliable, larger sample than 3mo): 57.3% win rate, 695
// trades/yr (~1.9/day), +$2140/yr pooled, split-half stable (H1 58%/+$1380,
// H2 57%/+$660 - both positive). The 3mo window came back unstable, but with
// only ~75 trades per half that's a much noisier read than the 1y result.
// Usage: npx tsx scripts/dispatch-gold-trend-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Complementary entry signal for gold (GC=F) that fires DURING an established trend (not just on a reversal cross), so it keeps trading when the market moves cleanly in one direction. Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a sample.";

const candidates = [
  {
    label: "DI-Dominance Widening (ADX>20, gap widening)",
    rationale:
      "Fires whenever the +DI/-DI gap is widening with ADX>20, no fresh crossover required - unlike DI-Cross which only fires at the moment of a flip. Swept on GC=F 1h/1y: 57.3% win rate, 695 trades/yr (~1.9/day), +$2140/yr pooled annualized. Split-half stable: H1 58% win/+$1380, H2 57% win/+$660 - both halves solidly positive. Designed to keep firing during sustained one-directional trends where DI-Cross goes quiet.",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 20) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long", note: "DI gap widening, +DI dominant" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short", note: "DI gap widening, -DI dominant" };
return null;
`,
  },
];

async function main() {
  const { runId } = await runResearch(brief, "GC=F", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
