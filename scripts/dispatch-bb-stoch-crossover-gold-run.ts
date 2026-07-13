// Variant of research-75 (rejected, PF 0.997/breakeven): that version used a
// single-bar stochK "tick down" as confirmation, which is noisy. This uses a
// proper %K/%D crossover (the classic Stochastic signal) instead - %K
// crossing below %D from above 80 (or above %D from below 20) - a stricter,
// less noisy confirmation of exhaustion at a Bollinger band breach. Same
// ADX<25 range gate as every other attempt this session.
// Usage: npx tsx scripts/dispatch-bb-stoch-crossover-gold-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Bollinger %B + Stochastic %K/%D crossover fade for gold (GC=F, 1h), ADX<25 gate. Refines research-75 (rejected, breakeven PF 0.997) which used a noisy single-bar stochK downtick as its exhaustion confirmation. This version requires an actual %K/%D crossover (K crossing below D from above 80, or above D from below 20) at a Bollinger band breach - the standard, less noisy Stochastic signal.";

const candidates = [
  {
    label: "Bollinger %B + Stoch %K/%D Crossover Fade (gold)",
    rationale:
      "Same band-breach + stochastic-exhaustion idea as research-75, but replaces the noisy single-bar stochK downtick with a real %K/%D crossover (the standard Stochastic reversal signal), which should filter out more false confirmations at the cost of fewer trades.",
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
  const { runId } = await runResearch(brief, "GC=F", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
