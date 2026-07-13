// Same RSI Extreme Fade mechanism (ADX<25 gate, RSI reclaim from <30/>70)
// that failed blind test on GC=F 1h (research-67/68) - only variable changed
// is timeframe, down to 15m. Faster mean-reversion may behave differently
// on noisier/faster bars than on 1h.
// Usage: npx tsx scripts/dispatch-rsi-fade-gold-15m-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "RSI Extreme Fade (ADX<25 gate, RSI reclaim from <30/>70) - same exact logic that failed blind test on GC=F 1h (research-67/68) - ported to GC=F 15m. Only the timeframe changed, testing whether faster/noisier bars behave differently for range mean-reversion.";

const candidates = [
  {
    label: "RSI Extreme Fade (low-ADX range, gold 15m)",
    rationale:
      "Identical logic to research-67/68 (ADX<25 gate, RSI reclaim from <30/>70), which failed blind test on 1h gold. Testing the same mechanism on 15m bars - faster mean-reversion cycles may behave differently than the 1h timeframe where this idea has now failed twice.",
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
  const { runId } = await runResearch(brief, "GC=F", "15m", "1mo", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
