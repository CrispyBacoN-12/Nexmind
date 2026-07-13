// Ports the Bollinger %B + Stoch %K/%D crossover fade (research-76, failed
// blind test on GC=F 1h: win 44.7%, -$920/47 trades) to EURUSD=X, unchanged.
// Forex majors spend more time range-bound than gold - testing whether the
// same double-confirmation range fade behaves differently there, same as the
// earlier Liquidity Sweep market-port experiments this session.
// Usage: npx tsx scripts/dispatch-bb-stoch-crossover-eurusd-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Bollinger %B + Stochastic %K/%D crossover fade (research-76 logic, failed blind test on GC=F 1h) ported unchanged to EURUSD=X, ADX<25 gate. Forex majors spend more time range-bound/consolidating than gold - testing whether the same double-confirmation mechanism finds a real edge in a more naturally range-prone market.";

const candidates = [
  {
    label: "Bollinger %B + Stoch %K/%D Crossover Fade (EURUSD)",
    rationale:
      "Identical logic to research-76 (band breach + stochastic %K/%D exhaustion crossover, ADX<25), which failed blind test on gold. EURUSD is known for extended consolidation ranges - testing the same mechanism there to see if the underlying idea is sound but gold specifically is a poor fit (gold trends more persistently and chops less cleanly than forex majors).",
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
  const { runId } = await runResearch(brief, "EURUSD=X", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
