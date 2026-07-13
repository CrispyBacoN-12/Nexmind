// Ports the Bollinger %B + Stoch %K/%D crossover fade (research-76 logic,
// failed blind test on GC=F 1h) to SI=F (silver) 1h - a new market not yet
// tried with any range mechanism this session. Silver is more volatile than
// gold and known for sharper mean-reversion swings within ranges.
// Usage: npx tsx scripts/dispatch-bb-stoch-crossover-silver-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Bollinger %B + Stochastic %K/%D crossover fade (research-76 logic, failed blind test on GC=F 1h) ported to SI=F (silver) 1h, ADX<25 gate. Silver hasn't been tried with any range mechanism this session - it's more volatile than gold and known for sharper mean-reversion swings within consolidation ranges.";

const candidates = [
  {
    label: "Bollinger %B + Stoch %K/%D Crossover Fade (silver)",
    rationale:
      "Identical logic to research-76 (band breach + stochastic %K/%D exhaustion crossover, ADX<25), which failed blind test on gold. Silver's higher volatility and sharper intra-range swings may suit a band-breach mean-reversion signal better than gold's smoother trends did.",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.bbPercentB == null || p.bbPercentB == null) return null;
if (s.stochK == null || s.stochD == null || p.stochK == null || p.stochD == null) return null;
if (s.adx > 25) return null;
var crossDown = p.stochK >= p.stochD && s.stochK < s.stochD && p.stochK > 80;
var crossUp = p.stochK <= p.stochD && s.stochK > s.stochD && p.stochK < 20;
if (p.bbPercentB > 1 && crossDown) return { side: "short", note: "band breach + stoch %K/%D bear cross from " + p.stochK.toFixed(1) + ", ADX " + s.adx.toFixed(1) };
if (p.bbPercentB < 0 && crossUp) return { side: "long", note: "band breach + stoch %K/%D bull cross from " + p.stochK.toFixed(1) + ", ADX " + s.adx.toFixed(1) };
return null;
`,
  },
];

async function main() {
  const { runId } = await runResearch(brief, "SI=F", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
