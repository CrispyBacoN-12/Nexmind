// New gap-filling pattern: genuine range/mean-reversion fade. Every currently
// approved strategy (DI-Dominance, Strong-Trend Rider, ADX-Ignition, MACD
// flip, RSI-50 cross, Liquidity Sweep) requires a trend context to fire
// (ADX floor and/or SMA alignment) - none of them trade in a ranging market,
// and none fade an extreme against the trend. This is the deliberate inverse:
// gated by LOW ADX (no trend), fades RSI back from an extreme toward 50,
// with no SMA/trend-direction requirement at all.
// Usage: npx tsx scripts/dispatch-rsi-range-fade-gold-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Range/mean-reversion fade for gold (GC=F, 1h) - fills a coverage gap in the currently-approved strategy set, all of which require a trend context (ADX floor and/or SMA alignment) to fire. This candidate does the opposite: gated by ADX<20 (explicitly non-trending/ranging conditions), fades RSI reclaiming from an oversold/overbought extreme back toward 50, with no trend-direction filter at all.";

const candidates = [
  {
    label: "RSI Extreme Fade (low-ADX range)",
    rationale:
      "Every approved strategy today requires ADX above a floor and/or SMA trend alignment before it will trade - meaning in a ranging/choppy market (low ADX), the whole portfolio goes quiet. This candidate is the deliberate complement: fires only when ADX<20 (no trend present), and fades RSI reclaiming from <30 or >70 back toward the midline - a pure mean-reversion bet with no directional trend requirement, targeting exactly the market mood nothing else in the portfolio covers.",
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
  const { runId } = await runResearch(brief, "GC=F", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
