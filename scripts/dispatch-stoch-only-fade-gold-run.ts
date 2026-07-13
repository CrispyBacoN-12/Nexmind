// Stochastic-only range fade (no Bollinger requirement) - the RSI Extreme
// Fade mechanism (research-67/68) failed blind test on gold 1h using RSI's
// reclaim-from-30/70 logic. Stochastic %K/%D is a faster, more sensitive
// oscillator than RSI (shorter effective look-back due to the raw high-low
// range calc) - testing whether a %K/%D crossover in extreme zones performs
// differently as a standalone range-fade signal, same ADX<25 gate.
// Usage: npx tsx scripts/dispatch-stoch-only-fade-gold-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Stochastic %K/%D crossover fade for gold (GC=F, 1h), ADX<25 gate, no Bollinger requirement. RSI Extreme Fade (research-67/68) failed blind test using RSI reclaim-from-30/70. Stochastic is a faster/more sensitive oscillator - testing whether a %K/%D crossover in extreme zones (>80/<20) works as a standalone range-fade signal where RSI didn't.";

const candidates = [
  {
    label: "Stochastic %K/%D Crossover Fade (gold)",
    rationale:
      "Same low-ADX range-fade structure as the RSI Extreme Fade (research-67/68, failed blind test), but swaps RSI reclaim for a Stochastic %K/%D crossover in extreme zones. Stochastic reacts faster to price than RSI (raw high-low range position vs smoothed gain/loss ratio), which may catch reversals RSI missed or filter out ones RSI falsely signaled.",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.stochK == null || s.stochD == null || p.stochK == null || p.stochD == null) return null;
if (s.adx > 25) return null;
var crossDown = p.stochK >= p.stochD && s.stochK < s.stochD && p.stochK > 80;
var crossUp = p.stochK <= p.stochD && s.stochK > s.stochD && p.stochK < 20;
if (crossDown) return { side: "short", note: "stoch %K/%D bear cross from " + p.stochK.toFixed(1) + ", ADX " + s.adx.toFixed(1) };
if (crossUp) return { side: "long", note: "stoch %K/%D bull cross from " + p.stochK.toFixed(1) + ", ADX " + s.adx.toFixed(1) };
return null;
`,
  },
];

async function main() {
  const { runId } = await runResearch(brief, "GC=F", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
