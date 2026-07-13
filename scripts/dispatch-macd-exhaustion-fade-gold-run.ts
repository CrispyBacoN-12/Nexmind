// New range-market mechanism: MACD histogram exhaustion fade. Catches a
// mini-trend's momentum peaking and contracting back toward zero WITHOUT
// crossing it - distinct from the existing MACD Hist Flip / Zero-Cross
// strategies (research-31/49, both trend-continuation, both trigger AFTER
// the zero cross). This fades the reversal before momentum fully dies.
// Usage: npx tsx scripts/dispatch-macd-exhaustion-fade-gold-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "MACD histogram exhaustion fade for gold (GC=F, 1h) - a different range-trading mechanism than RSI Extreme Fade or ATR-Band Mean Reversion. Detects the histogram peaking (still positive) or troughing (still negative) and starting to contract toward zero - momentum exhaustion within a mini-trend, before any zero-cross - and fades the move, betting on reversion rather than continuation.";

const candidates = [
  {
    label: "MACD Histogram Exhaustion Fade (gold)",
    rationale:
      "Existing MACD strategies (research-31, research-49) are trend-continuation: they enter AFTER the histogram crosses zero, riding the new trend. This is the opposite bet: it catches the histogram peaking/troughing and contracting back toward zero while still on the same side, treating that deceleration as exhaustion of the current mini-trend and fading it - a genuinely different, non-trend-following idea for choppy/ranging conditions.",
    code: `
var i = bars.length - 1;
if (i < 2) return null;
var s = snaps[i], p = snaps[i - 1], pp = snaps[i - 2];
if (s.macdHist == null || p.macdHist == null || pp.macdHist == null) return null;
if (pp.macdHist < p.macdHist && p.macdHist > s.macdHist && s.macdHist > 0) {
  return { side: "short", note: "MACD hist peaked positive and contracting - momentum exhaustion" };
}
if (pp.macdHist > p.macdHist && p.macdHist < s.macdHist && s.macdHist < 0) {
  return { side: "long", note: "MACD hist troughed negative and contracting - momentum exhaustion" };
}
return null;
`,
  },
];

async function main() {
  const { runId } = await runResearch(brief, "GC=F", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
