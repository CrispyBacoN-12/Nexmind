// New mechanism, never tried this session: volume-based climax exhaustion
// fade. Uses bars[i].v (untouched by any prior experiment) instead of any
// price/oscillator indicator - a bar with unusually high volume (>2x the
// 20-bar average) in a low-ADX/non-trending regime is treated as a
// capitulation/climax, faded on the assumption the move is about to reverse.
// Usage: npx tsx scripts/dispatch-volume-climax-fade-gold-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const brief =
  "Volume climax exhaustion fade for gold (GC=F, 1h) - the range-market mechanisms tried so far (RSI extreme, ATR-band distance, MACD exhaustion) all use price/oscillator data and all failed blind test or in-sample. This uses volume instead: a bar with volume > 2x the trailing 20-bar average, in a low-ADX (non-trending) regime, is treated as a climax/capitulation bar and faded.";

const candidates = [
  {
    label: "Volume Climax Fade (gold)",
    rationale:
      "Genuinely different data dimension from every range attempt so far (RSI, ATR, MACD - all price-derived). Volume climax (>2x trailing 20-bar average volume) in a non-trending regime (ADX<25) is a classic capitulation/exhaustion signal in market microstructure - faded here on the theory that a volume spike without trend confirmation marks a local extreme about to mean-revert.",
    code: `
var i = bars.length - 1;
if (i < 20) return null;
var s = snaps[i];
if (s.adx == null) return null;
if (s.adx > 25) return null;
var volSum = 0, volCnt = 0;
for (var k = i - 20; k < i; k++) {
  if (bars[k].v != null) { volSum += bars[k].v; volCnt++; }
}
if (volCnt < 15) return null;
var avgVol = volSum / volCnt;
var c = bars[i];
if (c.v == null || avgVol <= 0) return null;
var bullish = c.c > c.o, bearish = c.c < c.o;
if (c.v > avgVol * 2 && bearish) return { side: "long", note: "volume climax on bearish bar (" + (c.v / avgVol).toFixed(1) + "x avg), fading" };
if (c.v > avgVol * 2 && bullish) return { side: "short", note: "volume climax on bullish bar (" + (c.v / avgVol).toFixed(1) + "x avg), fading" };
return null;
`,
  },
];

async function main() {
  const { runId } = await runResearch(brief, "GC=F", "1h", "1y", candidates);
  console.log("Dispatched research run:", runId);
}

main().then(() => process.exit(0));
