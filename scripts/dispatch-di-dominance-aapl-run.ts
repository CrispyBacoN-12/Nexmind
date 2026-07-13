// Dispatches "DI-Dominance Widening" - the most validated live strategy in
// the project (research-30, live on Gold Desk #8: 669-trade blind test,
// 59.2% win rate, +$4,419/yr annualized on gold) - ported to AAPL. AAPL has
// only 2 strategies total (vs. 26 on gold, 23 on BTC-USD) and both existing
// ones ran on tiny samples (9 trades on 2y/1d, 8 trades on 5y/1wk) because
// they used daily/weekly bars. This ports the proven logic unchanged onto
// AAPL 1h bars to get both a much larger sample size and a first real test
// of whether the DI-widening edge transfers from a commodity to an equity.
// Manual candidate -> no Anthropic API call, no cost.
// Usage: npx tsx scripts/dispatch-di-dominance-aapl-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "DI-Dominance Widening for AAPL: fires whenever the +DI/-DI gap is widening while ADX >= 20, no fresh crossover required. Identical logic to the live gold strategy (research-30, blind-tested 59.2% win rate, +$4,419/yr annualized) - ported here unchanged to test whether the edge transfers to an equity. AAPL has only 2 strategies total so far, both on tiny daily/weekly samples (8-9 trades); this uses 1h bars for a far larger sample.";

const candidates = [
  {
    label: "DI-Dominance Widening (AAPL)",
    rationale:
      "Unmodified port of research-30 (DI-Dominance Widening), the most extensively validated strategy in the project - live on Gold Desk #8, blind-tested on a 669-trade held-out sample at 59.2% win rate. Every AAPL strategy tried so far used daily or weekly bars and got single-digit trade counts, too small to trust. Testing the exact same logic on AAPL 1h bars answers two questions at once: does this specific edge hold on equities, and does AAPL behave well enough on 1h bars to be worth researching further at all.",
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
  const { runId } = await runResearch(brief, "AAPL", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
