// New mechanism: session-anchored VWAP deviation fade. Genuinely different
// dimension from every prior range attempt (RSI/ATR/MACD/BB/Stochastic are
// all derived from price or price+volume-in-bar; VWAP deviation captures
// distance from the session's volume-weighted "fair value", a common
// intraday mean-reversion reference institutional desks watch). ADX<25 gate,
// same as every other range attempt this session.
// Usage: npx tsx scripts/dispatch-vwap-fade-gold-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Session-anchored VWAP deviation fade for gold (GC=F, 1h), ADX<25 gate. New mechanism using vwapDevPct (deviation from the daily-anchored VWAP), just added to the snapshot pipeline. Genuinely different dimension from every prior range-fade attempt - VWAP deviation is a volume-weighted fair-value reference rather than a price-only oscillator/band. Price stretching more than 0.5% from VWAP in a non-trending regime is faded back toward it.";

const candidates = [
  {
    label: "VWAP Deviation Fade (gold)",
    rationale:
      "New dimension: vwapDevPct (deviation of price from the session-anchored VWAP), distinct from every price-only oscillator/band tried so far. A >0.5% stretch from VWAP in a low-ADX (non-trending) regime is faded on the theory that VWAP is the session's volume-weighted fair value and price reverts to it absent a real trend.",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.vwapDevPct == null || p.vwapDevPct == null) return null;
if (s.adx > 25) return null;
var THRESH = 0.005;
if (p.vwapDevPct > THRESH && s.vwapDevPct <= p.vwapDevPct) return { side: "short", note: "faded back toward VWAP from +" + (p.vwapDevPct * 100).toFixed(2) + "%, ADX " + s.adx.toFixed(1) };
if (p.vwapDevPct < -THRESH && s.vwapDevPct >= p.vwapDevPct) return { side: "long", note: "faded back toward VWAP from " + (p.vwapDevPct * 100).toFixed(2) + "%, ADX " + s.adx.toFixed(1) };
return null;
`,
  },
];

async function main() {
  const { runId } = await runResearch(brief, "GC=F", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
