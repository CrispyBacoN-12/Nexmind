import { runResearch } from "../src/lib/research/runResearch";

async function main() {
  const brief =
    "Replacement for DI-Cross (research-25) on Gold Desk #8, which failed a genuine " +
    "blind out-of-sample test (53.7% win, net negative on a held-out year). MACD " +
    "histogram flip confirmed by SMA20/SMA50 trend agreement. Validated on GC=F 1h: " +
    "stable both TUNE halves ($1081/$2523 annualized) and PASSED a true blind holdout " +
    "test on the prior, never-seen year (59.0% win, +$1001/yr annualized). Only 66% " +
    "signal-time overlap with research-30 (live on #13) - a genuinely distinct signal, " +
    "not a duplicate.";

  const candidates = [
    {
      label: "MACD Hist Flip + Trend Filter (sma20 vs sma50)",
      code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.macdHist == null || p.macdHist == null || s.sma20 == null || s.sma50 == null) return null;
if (p.macdHist <= 0 && s.macdHist > 0 && s.sma20 > s.sma50) return { side: "long", note: "MACD hist flips positive, uptrend" };
if (p.macdHist >= 0 && s.macdHist < 0 && s.sma20 < s.sma50) return { side: "short", note: "MACD hist flips negative, downtrend" };
return null;
`,
    },
  ];

  const run = await runResearch(brief, "GC=F", "1h", "1y", candidates);
  console.log(`Dispatched research run: ${run.id}`);
  console.log(JSON.stringify(run, null, 2));
}

main().then(() => process.exit(0));
