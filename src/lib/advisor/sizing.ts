// Whole-share position sizing for a cash brokerage account.
//
// This is NOT computeLot() in src/lib/trading/positionSizing.ts. That one
// returns a fractional forex lot with a 0.01 minimum, which a Webull share
// order cannot express. Two caps apply here and the binding one is usually
// affordability, not risk, because $2,500 spread over 5 slots buys very few
// shares of anything expensive. The result names which cap bound and reports
// the risk that actually results, never the risk that was requested.
//
// Pure.

import type { ShareSizingInput, ShareSizingResult, SizingCap } from "./types";

function refuse(slotBudget: number, riskUsdTarget: number, reason: string): ShareSizingResult {
  return {
    shares: 0,
    riskShares: 0,
    affordableShares: 0,
    slotBudget,
    riskUsdTarget,
    actualRiskUsd: 0,
    actualRiskPct: 0,
    boundBy: [],
    reason,
  };
}

export function sizeShares(input: ShareSizingInput): ShareSizingResult {
  const { entry, slDistance, capital, maxSlots, riskPct } = input;

  const slotBudget = maxSlots > 0 ? capital / maxSlots : 0;
  const riskUsdTarget = (capital * riskPct) / 100;

  if (!Number.isFinite(entry) || entry <= 0) {
    return refuse(
      slotBudget,
      riskUsdTarget,
      "No position: the entry price is not a positive number.",
    );
  }
  if (!Number.isFinite(slDistance) || slDistance <= 0) {
    return refuse(
      slotBudget,
      riskUsdTarget,
      "No position: the stop distance is zero or unreadable, so risk per share cannot be measured.",
    );
  }
  if (!Number.isFinite(maxSlots) || maxSlots <= 0) {
    return refuse(
      slotBudget,
      riskUsdTarget,
      "No position: the slot count must be at least 1.",
    );
  }
  if (!Number.isFinite(capital) || capital <= 0) {
    return refuse(
      slotBudget,
      riskUsdTarget,
      "No position: capital must be greater than zero.",
    );
  }

  const riskShares = Math.floor(riskUsdTarget / slDistance);
  const affordableShares = Math.floor(slotBudget / entry);
  const shares = Math.min(riskShares, affordableShares);

  const boundBy: SizingCap[] = [];
  if (riskShares <= affordableShares) boundBy.push("risk");
  if (affordableShares <= riskShares) boundBy.push("affordability");

  const actualRiskUsd = shares * slDistance;
  const actualRiskPct = (actualRiskUsd / capital) * 100;

  let reason: string;
  if (shares === 0) {
    const parts: string[] = [];
    if (riskShares === 0) {
      parts.push(
        `one share risks $${slDistance.toFixed(2)}, more than the entire risk budget of $${riskUsdTarget.toFixed(2)}`,
      );
    }
    if (affordableShares === 0) {
      parts.push(
        `one share costs $${entry.toFixed(2)}, more than the slot budget of $${slotBudget.toFixed(2)}`,
      );
    }
    reason = `No position: ${parts.join("; and ")}.`;
  } else if (boundBy.length === 2) {
    reason =
      `${shares} share(s). Both caps bind at the same number: the risk budget allows ${riskShares} ` +
      `and the slot budget affords ${affordableShares}. Real risk is $${actualRiskUsd.toFixed(2)} ` +
      `(${actualRiskPct.toFixed(2)}% of capital), not the ${riskPct}% requested.`;
  } else if (boundBy[0] === "risk") {
    reason =
      `${shares} share(s), capped by RISK: the risk budget of $${riskUsdTarget.toFixed(2)} allows ` +
      `${riskShares} at $${slDistance.toFixed(2)} of risk each, while the slot budget could afford ` +
      `${affordableShares}. Real risk is $${actualRiskUsd.toFixed(2)} (${actualRiskPct.toFixed(2)}% of capital).`;
  } else {
    reason =
      `${shares} share(s), capped by AFFORDABILITY: one slot is $${slotBudget.toFixed(2)}, which buys ` +
      `${affordableShares} at $${entry.toFixed(2)}, while the risk budget would have allowed ${riskShares}. ` +
      `Real risk is $${actualRiskUsd.toFixed(2)} (${actualRiskPct.toFixed(2)}% of capital), not the ${riskPct}% requested.`;
  }

  return {
    shares,
    riskShares,
    affordableShares,
    slotBudget,
    riskUsdTarget,
    actualRiskUsd,
    actualRiskPct,
    boundBy,
    reason,
  };
}
