// Generic blind test for any ResearchStrategy candidate: runs the candidate's
// own stored code and swept exit ladder across the three held-out TEST folds of
// the S&P 500 bar panel — market it was never fitted on, and never selected on
// either. See src/lib/research/blindTest.ts for what each fold has to clear
// (trade + participation floors, retention against the FIT fold, a matched
// random-entry control, and a monthly block bootstrap).
//
// Only `panel-v1` rows can be blind-tested. A legacy row's stored summary came
// from one symbol on a window that overlapped itself by 66%, so there is no
// honest baseline to measure retention against; the script says so and moves on.
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
      `\nresearch-${r.strategy.id} "${r.strategy.label}" — ${r.validation}, ` +
        `${r.panel.symbols} symbols from ${r.panel.cachePath} (cached ${r.panel.fetchedAt})\n` +
        `  fit fold: trades=${r.fit.trades ?? "?"} avgR=${r.fit.avgR?.toFixed?.(3) ?? "n/a"}`,
    );
    for (const f of r.folds) {
      console.log(
        `  ${f.passed ? "PASS" : "FAIL"} ${f.fold} ${f.from}..${f.to} (${f.regime})\n` +
          `       trades=${f.summary.trades} symbols=${f.symbolsTraded}/${f.symbolsInFold} ` +
          `win%=${f.summary.winRate.toFixed(1)} pf=${f.summary.profitFactor?.toFixed(2) ?? "n/a"}\n` +
          `       avgR=${f.summary.avgR?.toFixed(3) ?? "n/a"} vs random-entry control ` +
          `p95=${f.control?.p95.toFixed(3) ?? "n/a"} median=${f.control?.median.toFixed(3) ?? "n/a"} ` +
          `(${f.control?.runs ?? 0} runs)\n` +
          `       bootstrap p5=${f.bootstrap?.p5.toFixed(3) ?? "n/a"} p50=${f.bootstrap?.p50.toFixed(3) ?? "n/a"} ` +
          `over ${f.bootstrap?.blocks ?? 0} monthly blocks` +
          (f.reasons.length ? `\n       - ${f.reasons.join("\n       - ")}` : ""),
      );
    }
    console.log(
      `  verdict: ${r.passed ? "PASSED all folds" : "FAILED"} ` +
        `(bar: >=${r.bar.minTrades} trades, >=${r.bar.minSymbols} symbols, per fold)\n` +
        `  caveat: ${r.caveat}`,
    );
  }
}

main();
