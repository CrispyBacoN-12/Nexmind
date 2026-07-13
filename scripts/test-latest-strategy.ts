// Replays the most recent real signal from the latest approved research
// strategy (run #8's last candidate) through the ACTUAL live-wiring formulas
// (tight ladder + relaxed R:R floor + full-risk lot sizing), anchored to real
// market data, then walks forward on real candles to see what would actually
// have happened (win/loss) if this had executed live. This is the concrete,
// end-to-end proof requested: "test one, the latest one."
// Usage: npx tsx scripts/test-latest-strategy.ts

import { prisma } from "../src/lib/db";
import { fetchCandles } from "../src/lib/marketData";
import { computeSnapshots } from "../src/lib/research/adapter";
import { compileStrategy } from "../src/lib/research/sandbox";
import { computeLot } from "../src/lib/trading/positionSizing";
import { applyIronRules, riskReward } from "../src/lib/trading/ironRules";

const RESEARCH_ATR_SL_MULT = 1.5;
const RESEARCH_ATR_TP_MULT = 1.2;
const RESEARCH_MIN_RISK_REWARD = 0.5;
const MAX_LOT_PER_TRADE = 5;

async function main() {
  const latest = await prisma.researchStrategy.findFirst({
    where: { status: "approved" },
    orderBy: { id: "desc" },
  });
  if (!latest) throw new Error("no approved research strategy found");
  console.log(`Testing: [#${latest.id}] ${latest.label} (run ${latest.runId})\n`);

  const portfolio = await prisma.portfolio.findUnique({ where: { id: 8 } }); // Gold Desk
  if (!portfolio) throw new Error("Gold Desk portfolio not found");

  const symbol = "GC=F";
  const resp = await fetchCandles(symbol, "3mo", "1h");
  const bars = resp.candles;
  const snaps = computeSnapshots(bars);
  const compiled = compileStrategy(latest.code);
  const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;

  // Find the most recent bar with a fresh signal (skip the very last few bars
  // that may not have a resolved outcome yet).
  let sigIdx = -1;
  for (let i = bars.length - 3; i >= 60; i--) {
    if (entry(i)) { sigIdx = i; break; }
  }
  if (sigIdx === -1) { console.log("No recent signal found in the lookback window."); return; }

  const bar = bars[sigIdx];
  const side = entry(sigIdx)!;
  const atr = snaps[sigIdx].atr ?? bar.c * 0.005;
  const price = bar.c;
  const signalTime = new Date(bar.t * 1000).toISOString();

  const dir = side === "long" ? 1 : -1;
  const levels = {
    entry: price,
    sl: price - dir * RESEARCH_ATR_SL_MULT * atr,
    tp1: price + dir * RESEARCH_ATR_TP_MULT * atr,
    tp2: null as number | null,
  };

  console.log(`Signal bar: ${signalTime} (${bars.length - 1 - sigIdx} bars ago)`);
  console.log(`Side: ${side}  Entry: ${levels.entry.toFixed(2)}  SL: ${levels.sl.toFixed(2)}  TP1: ${levels.tp1.toFixed(2)}\n`);

  const riskUsd = (portfolio.startingBalance * portfolio.riskPctPerTrade) / 100;
  const sizing = computeLot({ entry: levels.entry, sl: levels.sl, riskUsd, maxLotPerTrade: MAX_LOT_PER_TRADE, avgCorrelation: null });
  console.log("Position sizing:", sizing);

  const rr = riskReward({ symbol, side, entry: levels.entry, sl: levels.sl, tp1: levels.tp1, lot: sizing.lot });
  const verdict = applyIronRules(
    { symbol, side, entry: levels.entry, sl: levels.sl, tp1: levels.tp1, lot: sizing.lot },
    { dailyLossUsd: 0, dailyLossCapUsd: 200, maxLotPerTrade: MAX_LOT_PER_TRADE, maxSpread: 5, minRiskReward: RESEARCH_MIN_RISK_REWARD, pipValueUsdPerLot: 1 },
  );
  console.log(`\nR:R = ${rr.toFixed(2)}   Iron Rules: ${verdict.passed ? "PASSED — trade would execute" : "BLOCKED: " + verdict.failures.join("; ")}`);

  // Walk forward on real candles to see what actually happened.
  let outcome: "win" | "loss" | "open-at-end" = "open-at-end";
  let exitBar = -1;
  for (let j = sigIdx + 1; j < bars.length; j++) {
    const b = bars[j];
    const adverse = side === "long" ? b.l : b.h;
    const favorable = side === "long" ? b.h : b.l;
    const hitSl = side === "long" ? adverse <= levels.sl : adverse >= levels.sl;
    const hitTp = side === "long" ? favorable >= levels.tp1 : favorable <= levels.tp1;
    if (hitSl) { outcome = "loss"; exitBar = j; break; }
    if (hitTp) { outcome = "win"; exitBar = j; break; }
  }

  const riskUsdActual = Math.abs(levels.entry - levels.sl) * sizing.lot;
  const rewardUsdActual = Math.abs(levels.tp1 - levels.entry) * sizing.lot;
  if (outcome === "win") {
    console.log(`\nActual outcome: WIN — hit TP1 at ${new Date(bars[exitBar].t * 1000).toISOString()} (${exitBar - sigIdx} bars later)`);
    console.log(`P/L: +$${rewardUsdActual.toFixed(2)}`);
  } else if (outcome === "loss") {
    console.log(`\nActual outcome: LOSS — hit SL at ${new Date(bars[exitBar].t * 1000).toISOString()} (${exitBar - sigIdx} bars later)`);
    console.log(`P/L: -$${riskUsdActual.toFixed(2)}`);
  } else {
    console.log(`\nActual outcome: still open as of the latest bar (${bars.length - 1 - sigIdx} bars since entry, no TP/SL touch yet)`);
  }
}

main().then(() => process.exit(0));
