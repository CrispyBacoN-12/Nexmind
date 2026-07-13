// RSI Extreme Fade v4: same exact logic as v3 (research-67, ADX<25, PF 1.47
// on 28 trades in 1y) - only variable changed is the data window, widened to
// 2y, mirroring the same sample-size check that killed v1 (research-65's
// PF 1.77 on 11 trades collapsed to PF 1.02 on 2y). Checking whether v3's
// edge survives the same test.
// Usage: npx tsx scripts/dispatch-rsi-range-fade-gold-adx25-2y-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Fourth version of RSI Extreme Fade (gold), same logic as v3 (research-67, ADX<25, PF 1.47 on 28 trades in 1y) - unchanged, just widened the data window to 2y to check whether the edge survives with a larger sample, the same check that revealed v1's edge was noise.";

const candidates = [
  {
    label: "RSI Extreme Fade (low-ADX range, ADX<25, 2y sample)",
    rationale:
      "Identical logic to research-67 (ADX<25 gate, RSI reclaim from <30/>70, PF 1.47 on 28 trades in 1y). Widening to 2y, nothing else changed, to see if this edge holds up the way v1's didn't.",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.rsi == null || p.rsi == null || s.adx == null) return null;
if (s.adx > 25) return null;
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
