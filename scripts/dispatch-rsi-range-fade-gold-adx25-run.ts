// RSI Extreme Fade v3: same as v1 (research-65, ADX<20) but loosens the
// ADX gate to <25 - only variable changed is the trend-strength ceiling, to
// get more signal frequency while still restricting to non-trending regimes.
// Usage: npx tsx scripts/dispatch-rsi-range-fade-gold-adx25-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Third version of RSI Extreme Fade (gold), branching from v1 (research-65, PF 1.77 but only 11 trades in 1y, ADX<20). Same RSI reclaim-from-extreme entry, loosened the ADX ceiling from <20 to <25 - still restricted to non-trending regimes, but should fire more often.";

const candidates = [
  {
    label: "RSI Extreme Fade (low-ADX range, ADX<25)",
    rationale:
      "Branches from research-65 (ADX<20 gate, RSI reclaim from <30/>70, PF 1.77 on only 11 trades). Loosens the ADX ceiling to <25 - one variable changed, same RSI logic - to see if a wider non-trending band produces enough signals to judge the edge reliably, while still excluding genuinely trending conditions.",
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
  const { runId } = await runResearch(brief, "GC=F", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
