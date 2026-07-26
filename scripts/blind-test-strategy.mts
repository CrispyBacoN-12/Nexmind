// Generic blind test for any ResearchStrategy candidate: fetches deep held-out
// history (bars older than the most recent 365 days) and backtests the
// candidate's own stored code against it. Replaces hand-writing a fresh
// blind-test-*.mts script per candidate — see src/lib/research/blindTest.ts
// for the two overfit-tell checks folded in (min held-out trade count,
// train/test-inversion detection).
// Usage: node --env-file=.env --import tsx scripts/blind-test-strategy.mts <id> [<id> ...]
import { runBlindTest } from "../src/lib/research/blindTest";

async function main() {
  const ids = process.argv.slice(2).map(Number).filter(Number.isInteger);
  if (!ids.length) {
    console.log("usage: node --env-file=.env --import tsx scripts/blind-test-strategy.mts <id> [<id> ...]");
    return;
  }
  for (const id of ids) {
    const r = await runBlindTest(id);
    if ("error" in r) {
      console.log(`research-${id}: ${r.error}`);
      continue;
    }
    console.log(
      `\nresearch-${r.strategy.id} "${r.strategy.label}" (${r.symbol}, held-out ${r.range} range)\n` +
        `  in-sample: trades=${r.inSample.trades ?? "?"} expectancy=${r.inSample.expectancy?.toFixed?.(2) ?? "n/a"}\n` +
        `  held-out:  trades=${r.holdout.trades} win%=${r.holdout.winRate.toFixed(1)} pnl=$${r.holdout.totalPnl.toFixed(0)} ` +
        `pf=${r.holdout.profitFactor?.toFixed(2) ?? "n/a"} (${r.holdoutBars} bars / ~${r.holdoutDays.toFixed(0)} days, of ${r.totalBars} total)\n` +
        `  verdict: ${r.passed ? "PASSED blind test" : "FAILED blind test"}` +
        (r.reasons.length ? `\n  - ${r.reasons.join("\n  - ")}` : ""),
    );
  }
}

main();
