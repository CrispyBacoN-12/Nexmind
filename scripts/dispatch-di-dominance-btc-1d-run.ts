// Timeframe-gap test: DI-Dominance Widening (research-30, the most validated
// strategy in the project) ported to BTC-USD on DAILY bars. Every BTC-USD
// strategy tried so far used 15m or 1h - never 1d/1wk - despite BTC trading
// 24/7 with no session-gap issue that would make daily bars awkward the way
// they can be for equities. (4h was considered too, but isn't a supported
// interval here - ALLOWED_INTERVALS only has 5m/15m/30m/60m/1h/1d/1wk.)
// Isolates the timeframe variable alone: identical logic to research-30,
// only the bar size and market change. Manual candidate -> no API cost.
// Usage: npx tsx scripts/dispatch-di-dominance-btc-1d-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "DI-Dominance Widening for BTC-USD on daily bars: fires whenever the +DI/-DI gap is widening while ADX >= 20, no fresh crossover required. Identical logic to the live gold strategy (research-30). Every BTC-USD strategy tried so far used 15m or 1h bars - this is the first test of the pattern on a swing timeframe for crypto, which (unlike equities) has no session-gap reason to avoid daily bars.";

const candidates = [
  {
    label: "DI-Dominance Widening (BTC, daily)",
    rationale:
      "Unmodified port of research-30's logic onto BTC-USD 1d bars. Every prior BTC-USD strategy used 15m or 1h - crypto trades continuously so there's no structural reason daily bars should behave differently the way they might for equities with opening gaps. Tests both whether the DI-widening edge holds on crypto specifically, and whether it holds on a slower timeframe than anything tried on BTC before.",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 20) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long", note: "DI gap widening, +DI dominant" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short", note: "DI gap widening, -DI dominant" };
return null;
`,
  },
];

async function main() {
  const { runId } = await runResearch(brief, "BTC-USD", "1d", "5y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
