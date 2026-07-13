// Different entry timing than research-75/76 (which fired on a momentum
// confirmation - stoch tick/crossover - while price was still outside the
// band). This fires on the classic Bollinger reclaim: price was outside the
// band last bar, closes back inside this bar. Mirrors the RSI-reclaim timing
// used by the earlier RSI Extreme Fade (research-67/68), just applied to
// Bollinger %B instead of RSI, and with no Stochastic filter at all. ADX<25
// gate unchanged.
// Usage: npx tsx scripts/dispatch-bb-reclaim-fade-gold-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Bollinger Band reclaim fade for gold (GC=F, 1h), ADX<25 gate, no Stochastic filter. Every BB+Stoch attempt this session (research-75/76) fired on a momentum confirmation while price was still outside the band. This fires on the classic reclaim: price closes back inside the band after being outside it last bar - the same entry timing as the RSI Extreme Fade (research-67/68), just using Bollinger %B instead of RSI as the extremity measure.";

const candidates = [
  {
    label: "Bollinger Band Reclaim Fade (gold)",
    rationale:
      "Different entry timing than research-75/76 - fires on the bar price closes back INSIDE the band after breaching it, not on a stochastic momentum tick while still outside. This is the same reclaim-pattern timing that gave the RSI Extreme Fade its best (though still ultimately failing) in-sample results, applied to Bollinger %B as a cleaner statistical measure of extremity than RSI.",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.bbPercentB == null || p.bbPercentB == null) return null;
if (s.adx > 25) return null;
if (p.bbPercentB > 1 && s.bbPercentB <= 1) return { side: "short", note: "reclaimed inside upper band from " + p.bbPercentB.toFixed(2) + ", ADX " + s.adx.toFixed(1) };
if (p.bbPercentB < 0 && s.bbPercentB >= 0) return { side: "long", note: "reclaimed inside lower band from " + p.bbPercentB.toFixed(2) + ", ADX " + s.adx.toFixed(1) };
return null;
`,
  },
];

async function main() {
  const { runId } = await runResearch(brief, "GC=F", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
