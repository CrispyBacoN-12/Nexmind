// First candidate using the two brand-new indicators (Bollinger %B/bandwidth,
// Stochastic %K/%D) just added to computeSnapshots(). Every prior range-fade
// attempt this session used RSI/ATR/MACD/volume and failed in-sample or blind
// test - this is a genuinely different mechanism: fade price outside the
// Bollinger bands (bbPercentB > 1 or < 0) ONLY when Stochastic confirms
// exhaustion (>80 turning down / <20 turning up), gated to low-ADX (ranging)
// regimes like every other range attempt this session.
// Usage: npx tsx scripts/dispatch-bb-stoch-fade-gold-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Bollinger %B + Stochastic exhaustion fade for gold (GC=F, 1h), ADX<25 gate. Every prior range-fade mechanism this session (RSI extreme, ATR-band distance, MACD histogram exhaustion, volume climax) failed in-sample or blind test. This uses two indicators added specifically for this experiment: Bollinger %B (price position vs the 20/2 bands) to detect a band breach, confirmed by Stochastic %K turning back from an extreme (>80 rolling down / <20 rolling up) before entering - a stricter double-confirmation than any single-indicator fade tried so far.";

const candidates = [
  {
    label: "Bollinger %B + Stochastic Fade (gold)",
    rationale:
      "New mechanism using bbPercentB and stochK/stochD, both just added to the snapshot pipeline. Price closing outside the Bollinger bands (%B > 1 or < 0) flags a stretched move; Stochastic %K crossing back down from >80 (or up from <20) confirms momentum exhaustion at that extreme. Double confirmation (band breach + oscillator turn) is stricter than the single-indicator RSI/ATR fades that failed earlier, and ADX<25 keeps it confined to non-trending regimes as with every other range attempt.",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.bbPercentB == null || p.bbPercentB == null) return null;
if (s.stochK == null || p.stochK == null) return null;
if (s.adx > 25) return null;
var stochTurnDown = p.stochK > 80 && s.stochK < p.stochK;
var stochTurnUp = p.stochK < 20 && s.stochK > p.stochK;
if (p.bbPercentB > 1 && stochTurnDown) return { side: "short", note: "band breach + stoch turn down from " + p.stochK.toFixed(1) + ", ADX " + s.adx.toFixed(1) };
if (p.bbPercentB < 0 && stochTurnUp) return { side: "long", note: "band breach + stoch turn up from " + p.stochK.toFixed(1) + ", ADX " + s.adx.toFixed(1) };
return null;
`,
  },
];

async function main() {
  const { runId } = await runResearch(brief, "GC=F", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
