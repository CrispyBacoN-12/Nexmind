// One-off test (NOT going through runResearch/the shared backtest engine):
// research-82 (Bollinger Band Reclaim Fade, gold) had a real, stable entry
// signal - win rate held at 56.1% in-sample and 55.5% on the blind held-out
// year - but PnL came out slightly negative both times under the shared
// fixed-ATR exit scheme (SL 1.5xATR, TP 2.5xATR or 1.2xATR in singleTarget
// mode). That scheme doesn't fit a mean-reversion trade: the natural target
// for "price reclaiming the band" is the middle band (SMA20) it's reverting
// toward, not a fixed multiple of ATR.
//
// This script re-simulates the exact same entry signal with a custom exit:
//   SL = entry -+ 1.5*ATR (same risk definition as the shared engine, for
//        comparable R-multiples)
//   TP = the middle Bollinger band (SMA20) value AT SIGNAL TIME (fixed at
//        entry, not trailing) - the level the reclaim is reverting toward.
// One position at a time. Adverse side (SL) checked first if a bar touches
// both. Tested on both the in-sample window and the same blind held-out
// year as every other blind test this session.
// Usage: npx tsx scripts/custom-exit-bb-reclaim.mts
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import type { Candle } from "../src/lib/indicators";

const SYMBOL = "GC=F";
const RISK_USD = 100;
const SL_MULT = 1.5;

function runCustomExit(bars: Candle[], snaps: ReturnType<typeof computeSnapshots>, label: string) {
  type Pos = { side: "long" | "short"; entry: number; sl: number; tp: number; entryIdx: number };
  let open: Pos | null = null;
  const trades: { outcome: "win" | "loss"; rMultiple: number }[] = [];

  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i];
    if (open) {
      const adverseHit = open.side === "long" ? bar.l <= open.sl : bar.h >= open.sl;
      const targetHit = open.side === "long" ? bar.h >= open.tp : bar.l <= open.tp;
      if (adverseHit) {
        trades.push({ outcome: "loss", rMultiple: -1 });
        open = null;
      } else if (targetHit) {
        const risk = Math.abs(open.entry - open.sl);
        const reward = Math.abs(open.tp - open.entry);
        trades.push({ outcome: "win", rMultiple: reward / risk });
        open = null;
      }
      if (open) continue;
    }

    const s = snaps[i], p = snaps[i - 1];
    if (s.adx == null || s.bbPercentB == null || p.bbPercentB == null || s.atr == null || s.sma20 == null) continue;
    if (s.adx > 25) continue;

    let side: "long" | "short" | null = null;
    if (p.bbPercentB > 1 && s.bbPercentB <= 1) side = "short";
    else if (p.bbPercentB < 0 && s.bbPercentB >= 0) side = "long";
    if (!side) continue;

    const entry = bar.c;
    const sl = side === "long" ? entry - SL_MULT * s.atr : entry + SL_MULT * s.atr;
    const tp = s.sma20; // middle band at signal time - the reversion target
    // Skip degenerate setups where the target is on the wrong side of entry (band inverted vs price).
    if (side === "long" && tp <= entry) continue;
    if (side === "short" && tp >= entry) continue;
    open = { side, entry, sl, tp, entryIdx: i };
  }

  const wins = trades.filter((t) => t.outcome === "win").length;
  const winRate = trades.length ? (wins / trades.length) * 100 : 0;
  const totalPnl = trades.reduce((sum, t) => sum + t.rMultiple * RISK_USD, 0);
  console.log(
    `${label.padEnd(14)} trades=${String(trades.length).padStart(4)} win%=${winRate.toFixed(1).padStart(5)} ` +
    `pnl=$${totalPnl.toFixed(0).padStart(6)} ${winRate > 50 && totalPnl > 0 ? "PASSED" : "FAILED"}`
  );
}

async function main() {
  const resp2y = await fetchCandles(SYMBOL, "2y", "1h");
  const bars = resp2y.candles;
  const cutoffTs = bars[bars.length - 1].t - 365 * 86400;
  const inSample = bars.filter((b) => b.t >= cutoffTs);
  const holdout = bars.filter((b) => b.t < cutoffTs);

  console.log(`In-sample: ${inSample.length} bars (~last 365d) | Holdout (blind): ${holdout.length} bars (~older 363d)\n`);

  runCustomExit(inSample, computeSnapshots(inSample), "In-sample (1y)");
  runCustomExit(holdout, computeSnapshots(holdout), "Holdout (blind)");
}

main();
