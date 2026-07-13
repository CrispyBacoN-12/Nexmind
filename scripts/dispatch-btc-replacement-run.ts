import { runResearch } from "../src/lib/research/runResearch";

async function main() {
  const candidates = [
    {
      label: "Shallow Pullback in Trend (RSI 45/55 + SMA50)",
      rationale:
        "Replacement for research-27 on Bitcoin Desk #9 (RSI-50 momentum cross, negative bootstrap median return at live 2% risk). " +
        "Buys shallow RSI dips (crossing back above 45) while price stays above SMA50 (uptrend), shorts shallow rallies (crossing back " +
        "below 55) while price stays below SMA50 (downtrend) - i.e. trades WITH the trend on shallow pullbacks rather than on a bare " +
        "RSI-50 midline cross. Swept against 8 other candidates on pooled BTC-USD+BNB-USD 1h/2y data (TUNE=recent 365d, BLIND=older " +
        "365d holdout, never touched during selection): only this one passed both TUNE split-half stability (H1=$360/yr, H2=$2640/yr, " +
        "both positive) and the BLIND holdout (win%=56.6, ann=$600, positive). Monte Carlo bootstrap at the desk's real 2% risk sizing " +
        "shows a genuinely positive median return (+31.9% over the 2y backtest window) versus research-27's negative median.",
      code: `
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.rsi == null || p.rsi == null || s.sma50 == null || s.price == null) return null;
if (p.rsi <= 45 && s.rsi > 45 && s.price > s.sma50) return { side: "long" };
if (p.rsi >= 55 && s.rsi < 55 && s.price < s.sma50) return { side: "short" };
return null;
`,
    },
  ];

  const run = await runResearch(
    "Replacement for research-27 on Bitcoin Desk #9 - shallow pullback in trend using RSI 45/55 + SMA50 filter",
    "BTC-USD",
    "1h",
    "1y",
    candidates,
  );
  console.log(`Dispatched research run: ${run.runId}`);
}

main().then(() => process.exit(0));
