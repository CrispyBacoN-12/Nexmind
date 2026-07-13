// Dispatches "RSI-50 Momentum Cross" for BTC-USD via the real runResearch()
// pipeline (manual-candidates path, no AI cost) - the one candidate out of 8
// tested that was profitable in BOTH halves of a 1y BTC-USD 1h window (see
// btc-split-robustness.ts), unlike e.g. "ADX-Ignition Breakout" which looked
// great on average (60% win, +16%/yr) but flipped from -17.9%/yr (older 6mo)
// to +16.7%/yr (recent 6mo) - a regime-dependent illusion, not a real edge.
// Note: runOneCandidate() always backtests at a fixed TP=1.2xATR (see
// runResearch.ts:74), so the persisted backtestSummary here will show ~58.7%
// win rate (the tp=1.2 number), not the ~63% seen at the separately-optimized
// tp=1.0 (see btc-optimize-rsi50-momentum.ts) - both are stable across halves,
// tp=1.2 is just the fixed production value.
// Usage: npx tsx scripts/dispatch-btc-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Entry signal for BTC-USD swing trading, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a 1-year sample (not just a good average).";

const candidates = [
  {
    label: "RSI-50 Momentum Cross",
    rationale:
      "RSI crosses 50 in the trend direction (ADX>20 gate, price vs SMA50 for direction confirmation). Split-half tested on BTC-USD 1h/1y: only candidate (of 8 tried) profitable in BOTH the older 6mo (-> +$1674/yr equiv at tp=1.2) and newer 6mo (+$442/yr equiv) - other candidates like 'ADX-Ignition Breakout' looked good on average but flipped sign between halves (regime-dependent, not persistent). At tp=1.2: 58.7% win rate full-year, 60.4%/56.7% split by half.",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.rsi == null || p.rsi == null || s.sma50 == null || s.price == null) return null;
if (s.adx < 20) return null;
if (p.rsi <= 50 && s.rsi > 50 && s.price > s.sma50) return { side: "long", note: "RSI cross above 50, uptrend" };
if (p.rsi >= 50 && s.rsi < 50 && s.price < s.sma50) return { side: "short", note: "RSI cross below 50, downtrend" };
return null;
`,
  },
];

async function main() {
  const { runId } = await runResearch(brief, "BTC-USD", "1h", "3mo", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
