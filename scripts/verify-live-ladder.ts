// Verifies the live/paper trade-tick path (mockHawk, since no ANTHROPIC_API_KEY
// is configured) now uses the tight research ladder + relaxed R:R floor + a lot
// cap that actually allows the full configured 1% risk, for an approved research
// strategy. Mirrors the exact formulas in engine.ts's mockHawk()/runTradeTick(),
// without touching the DB.
// Usage: npx tsx scripts/verify-live-ladder.ts

import { computeLot } from "../src/lib/trading/positionSizing";
import { applyIronRules, riskReward } from "../src/lib/trading/ironRules";

const price = 3350; // approx gold price
const atr = 23.3; // approx avg ATR from scripts/report-rr.ts output
const side = "long" as const;

const RESEARCH_ATR_SL_MULT = 1.5;
const RESEARCH_ATR_TP_MULT = 1.2;
const RESEARCH_MIN_RISK_REWARD = 0.5;
const MAX_LOT_PER_TRADE = 5; // updated DEFAULT_ACCOUNT.maxLotPerTrade

const levels = {
  entry: price,
  sl: price - RESEARCH_ATR_SL_MULT * atr,
  tp1: price + RESEARCH_ATR_TP_MULT * atr,
  tp2: null as number | null,
};

const riskUsd = (10000 * 1) / 100; // $10k starting balance, 1% risk per trade
const sizing = computeLot({ entry: levels.entry, sl: levels.sl, riskUsd, maxLotPerTrade: MAX_LOT_PER_TRADE, avgCorrelation: null });
console.log("sizing:", sizing);

const rr = riskReward({ symbol: "GC=F", side, entry: levels.entry, sl: levels.sl, tp1: levels.tp1, lot: sizing.lot });
console.log("riskReward (reward:risk):", rr.toFixed(3));

const verdict = applyIronRules(
  { symbol: "GC=F", side, entry: levels.entry, sl: levels.sl, tp1: levels.tp1, lot: sizing.lot },
  { maxLotPerTrade: MAX_LOT_PER_TRADE, maxSpread: 5, minRiskReward: RESEARCH_MIN_RISK_REWARD },
);
console.log("ironRules verdict:", verdict);
console.log("actual $ risked:", (Math.abs(levels.entry - levels.sl) * sizing.lot).toFixed(2), "(target was $" + riskUsd.toFixed(2) + ")");

// Sanity check: same trade WITHOUT the fix (old 0.2 lot cap, old 1.5 R:R floor) would have been blocked/underrisked.
const oldSizing = computeLot({ entry: levels.entry, sl: levels.sl, riskUsd, maxLotPerTrade: 0.2, avgCorrelation: null });
const oldVerdict = applyIronRules(
  { symbol: "GC=F", side, entry: levels.entry, sl: levels.sl, tp1: levels.tp1, lot: oldSizing.lot },
  { maxLotPerTrade: 0.2, maxSpread: 5, minRiskReward: 1.5 },
);
console.log("\n--- before the fix, for comparison ---");
console.log("old lot:", oldSizing.lot, "old $ risked:", (Math.abs(levels.entry - levels.sl) * oldSizing.lot).toFixed(2));
console.log("old ironRules verdict:", oldVerdict);
