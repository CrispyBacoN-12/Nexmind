// Dispatches "ADX-Ignition Breakout" for the US Stocks Desk (#11, sp500
// universe, daily bars) via the real runResearch() pipeline (manual-candidate
// path, no AI cost).
//
// Baseline "combo-vote" scored only 29.5% weighted win-rate and 2/10 stable
// across a 10-stock sp500 sample (stocks-baseline-check.ts) - nowhere near
// the >50% win-rate / stable-both-halves bar. Swept the same 8-candidate
// library used for Gold/Bitcoin against the sample at 1d/2y, production
// ladder (SL=1.5xATR, TP=1.2xATR, singleTarget=true), pooling trades across
// all 10 symbols (stocks-sweep-candidates.ts). Two candidates cleared the
// bar; "ADX-Ignition Breakout" won clearly:
//   ADX-Ignition Breakout:  65.3% win pooled, +$661/yr pooled, H1 65.8%/+$701 H2 65.5%/+$521 -> STABLE+
//   RSI-50 Momentum Cross:  60.8% win pooled, +$350/yr pooled, H1 63.6%/+$481 H2 57.7%/+$100 -> STABLE+ (weaker)
// Notably the opposite of the BTC-USD case, where ADX-Ignition Breakout was
// REJECTED for being regime-dependent (H1 -17.9%/yr vs H2 +16.7%/yr) - same
// signal, different asset class, different verdict. On sp500 daily bars its
// two halves are close (701 vs 521), no sign flip - a real, persistent edge
// here rather than a lucky regime.
// Usage: npx tsx scripts/dispatch-stocks-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Entry signal for US equities (sp500 universe) swing trading, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a sample (not just a good average).";

const candidates = [
  {
    label: "ADX-Ignition Breakout",
    rationale:
      "Fresh ADX cross above 25 (was <25 prior bar) with +DI/-DI dominance and price vs SMA50 confirming direction. Swept across a 10-stock sp500 sample (AAPL, MSFT, NVDA, AMD, JPM, XOM, UNH, HD, PG, CAT) at 1d/2y, production ladder: 65.3% win rate pooled (75 trades), +$661/yr pooled annualized. Split-half stable: H1 65.8% win/+$701/yr, H2 65.5% win/+$521/yr - both halves solidly positive and consistent with each other, unlike the same signal on BTC-USD where it was regime-dependent and rejected.",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.plusDI == null || s.minusDI == null || s.sma50 == null || s.price == null) return null;
if (p.adx >= 25 || s.adx < 25) return null;
if (s.plusDI > s.minusDI && s.price > s.sma50) return { side: "long", note: "fresh ADX ignition, +DI dominant, above sma50" };
if (s.minusDI > s.plusDI && s.price < s.sma50) return { side: "short", note: "fresh ADX ignition, -DI dominant, below sma50" };
return null;
`,
  },
];

async function main() {
  const { runId } = await runResearch(brief, "AAPL", "1d", "2y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
