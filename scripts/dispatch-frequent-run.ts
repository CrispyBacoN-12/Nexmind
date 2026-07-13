// Dispatches the winning candidates from scripts/sweep-frequent.ts as a new
// research run via the real runResearch() pipeline (manual-candidates path —
// no AI call, no cost), so they land in the Backtest Lab for review/approve
// exactly like run #8. Re-validated against the ACTUAL production ladder:
// runOneCandidate() always backtests research candidates at a FIXED
// TP=1.2xATR (see runResearch.ts:74), not the swept 0.8/1.0/1.2 range — so
// only candidates that clear >60% win rate at tp=1.2 on BOTH the 3mo and 1y
// windows qualify. That leaves exactly two: "DI-Cross (no ADX filter)" (best
// frequency + P/L) and "DI-Cross + ADX>15 filter" (lower frequency, steadier).
// Usage: npx tsx scripts/dispatch-frequent-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Higher-frequency entry signals for near-daily trading at >60% win rate, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade.";

const candidates = [
  {
    label: "DI-Cross (no ADX filter)",
    rationale:
      "Plain +DI/-DI crossover, no ADX gate. Swept on GC=F 1h data (3mo + 1y): 63% win rate both windows at tp=1.2 (well above the ~55.6% breakeven line for this R:R), ~0.7-0.86 trades/day, positive P/L on both windows ($31 over 3mo, $101 over 1y).",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null) return null;
if (p.plusDI <= p.minusDI && s.plusDI > s.minusDI) return { side: "long", note: "DI cross up" };
if (p.plusDI >= p.minusDI && s.plusDI < s.minusDI) return { side: "short", note: "DI cross down" };
return null;
`,
  },
  {
    label: "DI-Cross + ADX>15 filter",
    rationale:
      "Same DI crossover with a light ADX>15 trend-strength gate. Swept on GC=F 1h data (3mo + 1y): 62-64% win rate both windows at tp=1.2, ~0.53-0.6 trades/day (lower frequency than the unfiltered version but slightly steadier win rate), positive P/L both windows ($24.50 over 3mo, $62.62 over 1y).",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 15) return null;
if (p.plusDI <= p.minusDI && s.plusDI > s.minusDI) return { side: "long", note: "DI cross up, ADX>15" };
if (p.plusDI >= p.minusDI && s.plusDI < s.minusDI) return { side: "short", note: "DI cross down, ADX>15" };
return null;
`,
  },
];

async function main() {
  const { runId } = await runResearch(brief, "GC=F", "1h", "3mo", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
