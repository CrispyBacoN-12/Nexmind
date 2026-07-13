// Tuning pass on research-53 (DI-Dominance Widening, AAPL): PF 0.96, -$1.04/
// 217 trades - break-even. Baseline used ADX>=20, the threshold tuned for
// gold's typical volatility regime. Single change: raise the ADX floor to 28
// so only strong-trend instances qualify, on the theory that AAPL needs a
// higher trend-strength bar before DI-gap-widening is a reliable signal
// (equities chop more at low-moderate ADX than gold does). One variable
// changed. Manual candidate -> no API cost.
// Usage: npx tsx scripts/dispatch-di-dominance-aapl-v2-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Tuning pass on research-53 (DI-Dominance Widening, AAPL): baseline was break-even (PF 0.96, -$1.04 over 217 trades) using the gold-tuned ADX>=20 floor. Same logic, one change: raise the ADX floor to 28, testing whether AAPL needs a stronger trend-strength bar before the DI-gap-widening signal is reliable.";

const candidates = [
  {
    label: "DI-Dominance Widening (AAPL, ADX28)",
    rationale:
      "Same DI-gap-widening logic as research-53, raising the ADX floor from 20 to 28. Gold's ADX>=20 threshold may be too permissive for AAPL, which likely chops more at low-moderate ADX than a trending commodity like gold - this isolates whether restricting to only clearly strong trends recovers the edge.",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 28) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long", note: "DI gap widening, +DI dominant, ADX " + Math.round(s.adx) };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short", note: "DI gap widening, -DI dominant, ADX " + Math.round(s.adx) };
return null;
`,
  },
];

async function main() {
  const { runId } = await runResearch(brief, "AAPL", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
