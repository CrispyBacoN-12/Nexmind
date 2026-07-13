// RSI Extreme Fade v2: same exact logic as v1 (research-65, PF 1.77, ADX<20),
// just a longer 2y window instead of 1y - only variable changed is sample
// size, to see if the edge holds with more observations.
// Usage: npx tsx scripts/dispatch-rsi-range-fade-gold-2y-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Second version of RSI Extreme Fade (gold), same logic as v1 (research-65, PF 1.77 but only 11 trades in 1y). Same ADX<20 gate and RSI reclaim-from-extreme entry, unchanged - only the data window widened to 2y to get a larger sample.";

const candidates = [
  {
    label: "RSI Extreme Fade (low-ADX range, 2y sample)",
    rationale:
      "Identical logic to research-65 (ADX<20 gate, RSI reclaim from <30/>70). research-65's 1y result (PF 1.77, 72.7% win) had only 11 trades - too thin to trust. This widens the window to 2y, same everything else, purely to see if the edge survives with more observations.",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.rsi == null || p.rsi == null || s.adx == null) return null;
if (s.adx > 20) return null;
if (p.rsi < 30 && s.rsi >= 30) return { side: "long", note: "RSI reclaiming from oversold, ADX " + s.adx.toFixed(1) + " (ranging)" };
if (p.rsi > 70 && s.rsi <= 70) return { side: "short", note: "RSI reclaiming from overbought, ADX " + s.adx.toFixed(1) + " (ranging)" };
return null;
`,
  },
];

async function main() {
  const { runId } = await runResearch(brief, "GC=F", "1h", "2y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
