// scripts/rl/compare-shadow-sizing.ts
// Reviews the gold desk's rl-shadow decision-trail entries against what
// actually happened, reporting counterfactual P/L if the RL-proposed lot had
// been used instead of the real computeLot() lot. This is the gate reviewed
// before ever flipping engine.ts to use RL sizing live (design doc Component 6).
// Usage: npx tsx scripts/rl/compare-shadow-sizing.ts

import { prisma } from "../../src/lib/db";

const GOLD_SYMBOL = "GC=F";

interface RLShadowData {
  rlWeight: number;
  rlLot: number;
  vetoed: boolean;
  actualLot: number;
}

interface TickStep { stage: string; note: string; data?: Record<string, unknown> }

function parseRLShadow(decisionLog: string): RLShadowData | null {
  let steps: TickStep[];
  try {
    steps = JSON.parse(decisionLog);
  } catch {
    return null;
  }
  const step = steps.find((s) => s.stage === "rl-shadow");
  if (!step?.data) return null;
  const d = step.data as Partial<RLShadowData>;
  if (typeof d.rlLot !== "number" || typeof d.actualLot !== "number") return null;
  return { rlWeight: d.rlWeight ?? 0, rlLot: d.rlLot, vetoed: Boolean(d.vetoed), actualLot: d.actualLot };
}

async function main() {
  const trades = await prisma.trade.findMany({
    where: { symbol: GOLD_SYMBOL, status: "closed" },
    orderBy: { closedAt: "asc" },
  });

  let compared = 0;
  let actualPnlTotal = 0;
  let rlPnlTotal = 0;
  let vetoedCount = 0;

  console.log(
    `${"tradeId".padEnd(8)} ${"actualLot".padStart(9)} ${"rlLot".padStart(7)} ${"actualPnl".padStart(10)} ${"rlPnl".padStart(10)} note`,
  );

  for (const t of trades) {
    const shadow = parseRLShadow(t.decisionLog);
    if (!shadow) continue;
    compared++;
    const actualPnl = t.pnl ?? 0;
    // Same entry/exit/slippage path -> P/L is proportional to lot size.
    const rlPnl = shadow.actualLot > 0 ? (actualPnl / shadow.actualLot) * shadow.rlLot : 0;
    actualPnlTotal += actualPnl;
    rlPnlTotal += rlPnl;
    if (shadow.vetoed) vetoedCount++;
    console.log(
      `${String(t.id).padEnd(8)} ${shadow.actualLot.toFixed(2).padStart(9)} ${shadow.rlLot.toFixed(2).padStart(7)} ` +
      `${actualPnl.toFixed(2).padStart(10)} ${rlPnl.toFixed(2).padStart(10)} ${shadow.vetoed ? "RL vetoed" : ""}`,
    );
  }

  console.log(`\n${compared} trades with an rl-shadow log entry`);
  console.log(`Actual total P/L:      $${actualPnlTotal.toFixed(2)}`);
  console.log(`RL-proposed total P/L: $${rlPnlTotal.toFixed(2)}`);
  console.log(`RL would have vetoed ${vetoedCount} of ${compared} trades`);
}

main();
