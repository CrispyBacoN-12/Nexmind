// Ports the Bollinger %B + Stoch %K/%D crossover fade (research-76 logic,
// failed blind test on GC=F 1h: win 44.7%, -$920/47 trades) to GC=F 1d.
// Every range mechanism this session has been tested on 1h (and once on 15m)
// - daily bars have far less noise and may behave differently for a mean-
// reversion signal. ADX<25 gate unchanged.
// Usage: npx tsx scripts/dispatch-bb-stoch-crossover-gold-1d-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Bollinger %B + Stochastic %K/%D crossover fade (research-76 logic, failed blind test on GC=F 1h) ported to GC=F 1d, ADX<25 gate. Every range mechanism this session has been tested on 1h/15m bars - daily bars have far less noise, which may change whether this double-confirmation fade holds up.";

const candidates = [
  {
    label: "Bollinger %B + Stoch %K/%D Crossover Fade (gold 1d)",
    rationale:
      "Identical logic to research-76 (band breach + stochastic %K/%D exhaustion crossover, ADX<25), which failed blind test on 1h gold. Testing on daily bars, where trend/range regimes are cleaner and mean-reversion signals may have a real edge that 1h noise obscured.",
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
  const { runId } = await runResearch(brief, "GC=F", "1d", "5y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
