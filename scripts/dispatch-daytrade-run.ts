// Dispatches real AI-proposed day-trading candidates (3 per symbol, momentum/
// mean-reversion/breakout) for GC=F and BTC-USD on 15m bars via the real
// runResearch() pipeline. Uses the AI proposer (not hand-authored candidates),
// so it costs real AI calls — but with no ANTHROPIC_API_KEY set and the Claude
// Code CLI present, those calls route through subscription auth (costUsd: 0
// billed), see src/lib/anthropic.ts.
//
// Brief instructs the AI to gate entries to 08:00-16:00 Thailand time (UTC+7)
// using bars[i].t directly in the candidate code, since the entry-rule sandbox
// contract only controls entries — the engine has no forced end-of-session
// close, so results here reflect "only enters intraday" but not "hard-flat by
// 16:00" (a normal ATR SL/TP exit can still land after 16:00 if the entry was
// late in the window).
// Usage: npx tsx scripts/dispatch-daytrade-run.ts
import { runResearch } from "../src/lib/research/runResearch";

const WINDOW_BRIEF =
  "Trade ONLY between 08:00 and 16:00 Thailand time (UTC+7). bars[i].t is a Unix " +
  "timestamp in seconds (UTC) - compute the local hour as (new Date(bars[i].t*1000)" +
  ".getUTCHours() + 7) % 24 and return null when that hour is outside [8, 16). No " +
  "overnight holds: any position still open gets force-closed externally at 16:00, " +
  "so focus purely on a high-quality intraday entry signal, not exit logic. The " +
  "backtester applies a tight single-target ladder (SL=1.5xATR, TP=1.2xATR) " +
  "automatically - design entries that work with a target roughly the same size as " +
  "the stop (quick intraday moves), not a distant multi-hour swing target.";

const RUNS: { symbol: string; brief: string }[] = [
  {
    symbol: "GC=F",
    brief: `Entry signal for gold futures (GC=F) day-trading on 15-minute bars. ${WINDOW_BRIEF} Win rate >50% with profit stable across the sample, not just a good average.`,
  },
  {
    symbol: "BTC-USD",
    brief: `Entry signal for BTC-USD day-trading on 15-minute bars. ${WINDOW_BRIEF} Win rate >50% with profit stable across the sample, not just a good average.`,
  },
];

async function main() {
  for (const r of RUNS) {
    console.log(`\nDispatching day-trade research run: ${r.symbol} ...`);
    const { runId } = await runResearch(r.brief, r.symbol, "15m", "1mo");
    console.log(`  -> runId ${runId}`);
  }
}

main().then(() => process.exit(0));
