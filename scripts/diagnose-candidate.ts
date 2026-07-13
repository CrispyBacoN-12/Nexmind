// One-off diagnostic: run a research candidate's entry rule through the real
// backtest engine and print per-trade detail (not just the summary), so a
// refinement can be based on actual failure patterns instead of guesswork.
// Usage: npx tsx scripts/diagnose-candidate.ts <label> <code-file>

import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { backtestCandles } from "../src/lib/backtest/engine";
import { readFileSync } from "node:fs";

async function main() {
  const [symbol, interval, range, codeFile] = process.argv.slice(2);
  const code = readFileSync(codeFile, "utf8");
  const resp = await fetchCandles(symbol, range as never, interval as never);
  const bars = resp.candles;
  const snaps = computeSnapshots(bars);
  const compiled = compileStrategy(code);
  const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
  const result = backtestCandles(symbol, bars, 0.1, undefined, entry);

  console.log(`bars=${bars.length} signals=${result.signals} trades=${result.trades.length} openAtEnd=${result.openAtEnd}\n`);
  for (const t of result.trades) {
    const heldMs = t.closedAt.getTime() - t.openedAt.getTime();
    const heldHrs = (heldMs / 3600000).toFixed(1);
    console.log(
      `${t.openedAt.toISOString().slice(0, 16)}  ${t.side.padEnd(5)}  entry=${t.entry.toFixed(2).padStart(9)}  exit=${t.exit.toFixed(2).padStart(9)}  ` +
      `${t.outcome.padEnd(9)} pnl=${t.pnl.toFixed(2).padStart(8)}  R=${t.rMultiple?.toFixed(2).padStart(5) ?? "  —  "}  held=${heldHrs}h  tp1Hit=${t.tp1Hit}`
    );
  }
}

main();
