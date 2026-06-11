// The Iron Rules — the final, emotionless gate. Pure code, never an LLM.
// AI agents (HAWK, SAGE) may propose a trade, but these rules clamp every value.

export interface ProposedTrade {
  symbol: string;
  side: "long" | "short";
  entry: number;
  sl: number;
  tp1: number;
  lot: number;
  spread?: number; // current spread in price units
}

export interface AccountState {
  dailyLossUsd: number; // realized loss so far today (positive number)
  dailyLossCapUsd: number; // hard floor
  maxLotPerTrade: number;
  maxSpread?: number; // max acceptable spread in price units
  minRiskReward?: number; // R:R floor (default 1.5)
  pipValueUsdPerLot?: number; // for estimating worst-case loss; default 1
  killSwitch?: boolean; // global halt — blocks every new trade
  openPositions?: number; // current open trade count
  maxOpenPositions?: number; // cap; enforced only when both counts provided
}

export interface IronVerdict {
  passed: boolean;
  riskReward: number;
  failures: string[];
}

/** Risk:reward from entry/sl/tp1, side-aware. Returns 0 when risk is non-positive. */
export function riskReward(t: ProposedTrade): number {
  const risk = t.side === "long" ? t.entry - t.sl : t.sl - t.entry;
  const reward = t.side === "long" ? t.tp1 - t.entry : t.entry - t.tp1;
  if (risk <= 0 || reward <= 0) return 0;
  return reward / risk;
}

/**
 * Apply every hard rule. Returns the verdict with a list of failure reasons.
 * This is intentionally exhaustive and side-effect free so it is trivially testable.
 */
export function applyIronRules(t: ProposedTrade, acc: AccountState): IronVerdict {
  const failures: string[] = [];

  if (acc.killSwitch) failures.push("kill switch engaged — trading halted");

  if (
    acc.maxOpenPositions != null &&
    acc.openPositions != null &&
    acc.openPositions >= acc.maxOpenPositions
  ) {
    failures.push(`max open positions reached (${acc.openPositions}/${acc.maxOpenPositions})`);
  }
  const rr = riskReward(t);
  const minRR = acc.minRiskReward ?? 1.5;

  if (rr < minRR) failures.push(`R:R ${rr.toFixed(2)} below floor ${minRR}`);

  if (acc.maxSpread != null && t.spread != null && t.spread > acc.maxSpread) {
    failures.push(`spread ${t.spread} exceeds max ${acc.maxSpread}`);
  }

  if (t.lot <= 0) failures.push("lot size must be positive");
  if (t.lot > acc.maxLotPerTrade) failures.push(`lot ${t.lot} exceeds max ${acc.maxLotPerTrade}`);

  // Worst-case loss for this trade = distance to SL × pip value × lot.
  const slDistance = Math.abs(t.entry - t.sl);
  const pipValue = acc.pipValueUsdPerLot ?? 1;
  const worstCaseLoss = slDistance * pipValue * t.lot;
  if (acc.dailyLossUsd + worstCaseLoss > acc.dailyLossCapUsd) {
    failures.push(
      `would breach daily loss cap (used ${acc.dailyLossUsd.toFixed(2)} + risk ${worstCaseLoss.toFixed(2)} > ${acc.dailyLossCapUsd})`,
    );
  }

  if (acc.dailyLossUsd >= acc.dailyLossCapUsd) failures.push("daily loss cap already reached — no new trades");

  return { passed: failures.length === 0, riskReward: rr, failures };
}
