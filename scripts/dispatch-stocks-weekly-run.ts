// Dispatches "RSI-50 Momentum Cross (weekly)" for the US Stocks Desk (#11),
// replacing research-28 (ADX-Ignition Breakout, daily) which failed to hold
// up on a realistic 49-stock sp500 sample (stocks-large-sample-check.ts,
// stocks-sweep-large.ts: all 12 daily-bar candidates unstable at scale).
// Switching timeframe to weekly bars found two genuinely stable candidates
// (stocks-weekly-sweep.ts) - this is the stronger of the two: 64.2% win rate
// pooled (176 trades), +$546/yr pooled annualized on the same 49-stock
// sample, split-half stable (H1 68.6% win/+$479/yr, H2 59.2% win/+$183/yr -
// both positive, no sign flip, unlike every daily-bar candidate tested).
// Usage: npx tsx scripts/dispatch-stocks-weekly-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Entry signal for US equities (sp500 universe) swing trading on WEEKLY bars, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a sample (not just a good average). Daily-bar signals were tested extensively and failed to hold up broadly - weekly bars reduce noise and were found to carry more reliable edge.";

const candidates = [
  {
    label: "RSI-50 Momentum Cross (weekly)",
    rationale:
      "RSI crosses above/below 50 with trend confirmation (ADX>20, price vs SMA50), evaluated on weekly bars instead of daily. Swept across a 49-stock sector-diverse sp500 sample (every 10th sp500 symbol) at 1wk/5y, production ladder: 64.2% win rate pooled (176 trades), +$546/yr pooled annualized. Split-half stable: H1 68.6% win/+$479/yr, H2 59.2% win/+$183/yr - both halves solidly positive. The same signal and 11 other candidates all failed split-half stability when tested on daily bars across this sample - moving to weekly resolution is what made the edge hold up.",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.rsi == null || p.rsi == null || s.sma50 == null || s.price == null) return null;
if (s.adx < 20) return null;
if (p.rsi <= 50 && s.rsi > 50 && s.price > s.sma50) return { side: "long", note: "weekly RSI cross above 50, uptrend" };
if (p.rsi >= 50 && s.rsi < 50 && s.price < s.sma50) return { side: "short", note: "weekly RSI cross below 50, downtrend" };
return null;
`,
  },
];

async function main() {
  const { runId } = await runResearch(brief, "AAPL", "1wk", "5y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
