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
  /**
   * What this trade loses if the stop fills, in account currency. Supplied by
   * the caller rather than derived here: |entry - sl| is a price distance, and
   * turning it into money needs the instrument's contract size and tick value,
   * which these rules deliberately know nothing about. `computeLot` already
   * works from this number, so the caller has it.
   */
  riskUsd?: number;
}

export interface AccountState {
  maxLotPerTrade: number;
  maxSpread?: number; // max acceptable spread in price units
  minRiskReward?: number; // R:R floor (default 1.5)
  killSwitch?: boolean; // per-portfolio halt — blocks every new trade
  globalTradingHalt?: boolean; // manual global emergency brake — blocks all portfolios
  openPositions?: number; // current open trade count
  maxOpenPositions?: number; // cap; enforced only when both counts provided

  // --- leverage guards ---------------------------------------------------
  // The three below exist because a CFD position can lose more than the stop
  // says. They are the rules a prop firm enforces, and unlike every rule above
  // them they FAIL CLOSED: a limit that is configured but cannot be evaluated
  // refuses the trade instead of passing it through. The asymmetry is the
  // point — a false refusal costs one missed entry, a false pass costs an
  // account. (The market gate fails OPEN, for the opposite reason: it removes
  // a small loss and halting the desk over a data outage is worse.)

  /** Account equity in account currency. Denominator for both percentage caps. */
  equity?: number;
  /**
   * Summed risk of everything already open, in account currency. Five trades
   * at 1% each is a 5% bet on one correlated move, which is the exposure the
   * per-trade lot cap cannot see.
   */
  openRiskUsd?: number;
  /** Ceiling on (openRiskUsd + this trade's riskUsd) as a % of equity. */
  maxTotalRiskPct?: number;

  /** Today's realised + unrealised P/L in account currency; negative is a loss. */
  dailyPnlUsd?: number;
  /** Equity at the start of the trading day — the base the daily loss is measured against. */
  dayStartEquity?: number;
  /** Hard halt when the day is down this % of dayStartEquity. Not a warning. */
  dailyLossLimitPct?: number;

  /** equity / margin × 100, as MT5 reports it. Zero when no margin is in use. */
  marginLevel?: number;
  /** Margin currently held, in account currency. Disambiguates marginLevel === 0. */
  marginUsed?: number;
  /** Refuse new trades below this margin level (%). Stop-out territory is ~50–100. */
  minMarginLevel?: number;
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

  if (acc.globalTradingHalt) failures.push("global trading halt engaged — all trading stopped");

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

  failures.push(...leverageFailures(t, acc));

  return { passed: failures.length === 0, riskReward: rr, failures };
}

/**
 * The three leverage guards, each refusing rather than skipping when its own
 * inputs are missing. Split out so the fail-closed branches are visible as a
 * group instead of buried among rules that behave the other way.
 */
function leverageFailures(t: ProposedTrade, acc: AccountState): string[] {
  const failures: string[] = [];

  if (acc.maxTotalRiskPct != null) {
    if (acc.equity == null || acc.equity <= 0) {
      failures.push("total risk cap set but account equity is unknown");
    } else if (t.riskUsd == null || acc.openRiskUsd == null) {
      failures.push("total risk cap set but trade or open risk is unknown");
    } else {
      const totalPct = ((acc.openRiskUsd + t.riskUsd) / acc.equity) * 100;
      if (totalPct > acc.maxTotalRiskPct) {
        failures.push(
          `total open risk ${totalPct.toFixed(2)}% exceeds max ${acc.maxTotalRiskPct}%`,
        );
      }
    }
  }

  if (acc.dailyLossLimitPct != null) {
    if (acc.dayStartEquity == null || acc.dayStartEquity <= 0) {
      failures.push("daily loss limit set but the day's starting equity is unknown");
    } else if (acc.dailyPnlUsd == null) {
      failures.push("daily loss limit set but today's P/L is unknown");
    } else {
      // Only losses count. A day that is up cannot breach a loss limit, and
      // signing this the other way would halt on a profit.
      const lossPct = (Math.min(acc.dailyPnlUsd, 0) / acc.dayStartEquity) * -100;
      if (lossPct >= acc.dailyLossLimitPct) {
        failures.push(
          `daily loss ${lossPct.toFixed(2)}% reached the limit ${acc.dailyLossLimitPct}% — halted for the day`,
        );
      }
    }
  }

  if (acc.minMarginLevel != null) {
    if (acc.marginLevel == null || acc.marginUsed == null) {
      failures.push("margin level floor set but the account's margin is unknown");
    } else if (acc.marginUsed > 0 && acc.marginLevel < acc.minMarginLevel) {
      // marginUsed === 0 means nothing is open, and MT5 reports marginLevel 0
      // there. Reading that as a breach would refuse every trade on a flat
      // account — the one state in which there is nothing to protect.
      failures.push(
        `margin level ${acc.marginLevel.toFixed(1)}% below floor ${acc.minMarginLevel}%`,
      );
    }
  }

  return failures;
}
