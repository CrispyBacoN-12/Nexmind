// New range-market mechanism: ATR-band mean reversion. Distinct from RSI
// Extreme Fade (research-65/67/68, all failed blind test) - this measures
// actual price distance from SMA20 in ATR units (poor-man's Bollinger Band,
// since the snapshot has no stddev field), fading back toward the mean once
// price re-enters the band after extending 2x ATR beyond it. Gated by
// ADX<25 (non-trending) same as the RSI attempts.
// Usage: npx tsx scripts/dispatch-atr-band-fade-gold-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "ATR-band mean reversion for gold (GC=F, 1h) - a different range-trading mechanism than RSI Extreme Fade (which failed blind test). Measures price distance from SMA20 in ATR units (Bollinger-Band-like, since there's no stddev field), fading back toward the mean once price re-enters the band after extending beyond 2x ATR. Gated by ADX<25 for non-trending conditions.";

const candidates = [
  {
    label: "ATR-Band Mean Reversion (gold)",
    rationale:
      "Targets the same range-market gap as RSI Extreme Fade but via a different mechanism: distance from SMA20 measured in ATR (volatility-normalized), not an oscillator level. Price extending beyond SMA20 +/- 2xATR then closing back inside the band is treated as a fade signal, gated by ADX<25 to stay in non-trending regimes.",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i];
var c = bars[i], p = bars[i - 1];
if (s.sma20 == null || s.atr == null || s.adx == null) return null;
if (s.adx > 25) return null;
var upper = s.sma20 + 2 * s.atr;
var lower = s.sma20 - 2 * s.atr;
if (p.c > upper && c.c <= upper) return { side: "short", note: "faded back inside upper ATR band toward SMA20" };
if (p.c < lower && c.c >= lower) return { side: "long", note: "faded back inside lower ATR band toward SMA20" };
return null;
`,
  },
];

async function main() {
  const { runId } = await runResearch(brief, "GC=F", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
