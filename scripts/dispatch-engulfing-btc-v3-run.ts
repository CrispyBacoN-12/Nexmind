// Second tuning pass on the Engulfing/BTC line. v1 (research-51, raw shape):
// PF 0.90, -$1571.57/446 trades. v2 (research-56, body>=1x ATR): PF 0.98,
// -$103.07/163 trades - clear improvement, still negative. Same direction,
// pushed further: body >= 1.5x ATR, to see whether continuing to filter for
// larger/more decisive engulfing candles keeps closing the gap toward
// break-even or whether the trade count drops too far to matter. Manual
// candidate -> no API cost.
// Usage: npx tsx scripts/dispatch-engulfing-btc-v3-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Second tuning pass on Engulfing + SMA50 (BTC). v1 (raw shape): PF 0.90, -$1571.57/446 trades. v2 (body>=1x ATR): PF 0.98, -$103.07/163 trades - closing in on break-even. Same change pushed further: body >= 1.5x ATR, testing whether the improving trend continues or trade count collapses first.";

const candidates = [
  {
    label: "Engulfing + SMA50 trend filter (BTC, 1.5x ATR)",
    rationale:
      "Third point on the same line as research-51 (no filter) and research-56 (1x ATR): raising the body-size floor to 1.5x ATR. v2 showed a large PF/PnL improvement from filtering marginal candles - this checks whether that trend continues toward profitability or whether 1x ATR already captured most of the effect and further filtering just starves the sample.",
    code: `
var i = bars.length - 1;
if (i < 1) return null;
var c = bars[i], p = bars[i - 1];
var s = snaps[i];
if (s.sma50 == null || s.atr == null) return null;

var body = Math.abs(c.c - c.o);
if (body < s.atr * 1.5) return null;

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
