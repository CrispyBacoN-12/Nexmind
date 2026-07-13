// Tuning pass on research-51 (Engulfing + SMA50 trend filter, BTC): PF 0.90,
// -$1571.57/446 trades - the worst of the three ported strategies. Baseline
// only required the engulfing shape (body fully covers/is covered by prior
// body) plus SMA50 side. Single change: require the engulfing candle's body
// to be at least 1x ATR, filtering small/noisy engulfing shapes that are
// common in BTC's choppier 1h action but wouldn't have been "real" patterns
// on gold's smoother bars. One variable changed. Manual candidate -> no API
// cost.
// Usage: npx tsx scripts/dispatch-engulfing-btc-v2-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Tuning pass on research-51 (Engulfing + SMA50 trend filter, BTC): baseline was clearly negative (PF 0.90, -$1571.57 over 446 trades). Same logic, one change: require the engulfing candle's body to be at least 1x ATR, filtering small/noisy engulfing shapes that pass the raw shape test but aren't meaningfully large moves on BTC's noisier 1h bars.";

const candidates = [
  {
    label: "Engulfing + SMA50 trend filter (BTC, ATR-filtered)",
    rationale:
      "Same engulfing + SMA50 logic as research-51, adding a minimum body-size requirement (body >= 1x ATR). BTC's 1h bars produce far more marginal 'technically engulfing' candles than gold's - this isolates whether requiring a genuinely large engulfing candle (not just any shape that qualifies) recovers the edge that held on gold.",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var c = bars[i], p = bars[i - 1];
var s = snaps[i];
if (s.sma50 == null || s.atr == null) return null;

var body = Math.abs(c.c - c.o);
if (body < s.atr) return null;

var bullish = c.c > c.o;
var bearish = c.c < c.o;
var pBullish = p.c > p.o;
var pBearish = p.c < p.o;

if (bullish && pBearish && c.o <= p.c && c.c >= p.o && c.c > s.sma50) {
  return { side: "long", note: "large bullish engulfing above SMA50" };
}
if (bearish && pBullish && c.o >= p.c && c.c <= p.o && c.c < s.sma50) {
  return { side: "short", note: "large bearish engulfing below SMA50" };
}
return null;
`,
  },
];

async function main() {
  const { runId } = await runResearch(brief, "BTC-USD", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
