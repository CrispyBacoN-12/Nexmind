// The trade tick — wires the team together for one symbol:
//   SCANNER (no AI) → HAWK×3 (vote) → SAGE (veto) → Iron Rules (code) → paper fill.
// Every stage is appended to a decision log so the War Room can show the trail.

import { prisma } from "@/lib/db";
import { aiEnabled } from "@/lib/anthropic";
import { scanSymbol, type ScanResult } from "./scanner";
import { runHawk, type HawkVerdict, type HawkVote, type ProposedLevels } from "./hawk";
import { runSage, type SageVerdict } from "./sage";
import { applyIronRules, riskReward, type AccountState } from "./ironRules";
import { isKillSwitchOn, getMaxOpenPositions, getFearGreed, getStartingBalance, getRiskPctPerTrade } from "@/lib/settings";
import { type Interval, type Range } from "@/lib/yahoo";
import { fetchCandles } from "@/lib/marketData";
import { dailyReturns, pearsonCorrelation } from "./correlation";
import { computeLot } from "./positionSizing";

export interface TickStep { stage: string; note: string }
export interface TickResult {
  symbol: string;
  outcome: "no-setup" | "already-open" | "no-consensus" | "vetoed" | "rules-blocked" | "executed";
  steps: TickStep[];
  tradeId?: number;
  costUsd: number;
}

const DEFAULT_ACCOUNT: AccountState = {
  dailyLossUsd: 0,
  dailyLossCapUsd: 200,
  maxLotPerTrade: 0.2,
  maxSpread: 5,
  minRiskReward: 1.5,
  pipValueUsdPerLot: 1,
};

export async function runTradeTick(
  symbol: string,
  opts: { range?: Range; interval?: Interval; lot?: number } = {},
): Promise<TickResult> {
  const steps: TickStep[] = [];
  let costUsd = 0;

  // 1) SCANNER
  const scan = await scanSymbol(symbol, opts.range, opts.interval);
  symbol = scan.symbol; // use the resolved symbol (e.g. JMART → JMART.BK)
  steps.push({ stage: "scanner", note: scan.note });

  // One open position per symbol — re-scanning the same persisting setup must
  // not stack a duplicate trade (and must not burn AI calls finding that out).
  const existing = await prisma.trade.findFirst({
    where: { symbol, status: "open" },
    select: { id: true },
  });
  if (existing) {
    steps.push({ stage: "dedupe", note: `position #${existing.id} already open — skipped` });
    return { symbol, outcome: "already-open", steps, costUsd };
  }

  const signal = await prisma.signal.create({
    data: {
      symbol, timeframe: scan.timeframe, side: scan.side ?? "long", price: scan.price, atr: scan.atr,
      indicators: JSON.stringify(scan.snapshot), note: scan.note, status: "proposed",
    },
  });

  if (!scan.side) {
    await prisma.signal.update({ where: { id: signal.id }, data: { status: "discarded" } });
    return { symbol, outcome: "no-setup", steps, costUsd };
  }

  // 2) HAWK ×3
  const newsDigest = await latestNewsDigest();
  const hawk: HawkVerdict = aiEnabled()
    ? await runHawk(scan, { newsDigest })
    : mockHawk(scan);
  costUsd += hawk.totalCostUsd;
  steps.push({
    stage: "hawk",
    note: `votes ${hawk.votes.map((v) => `${v.persona}:${v.vote}`).join(", ")} → ${hawk.agreed ? hawk.side : "no consensus"}`,
  });

  if (!hawk.agreed || !hawk.side || !hawk.levels) {
    await prisma.signal.update({ where: { id: signal.id }, data: { status: "discarded" } });
    return { symbol, outcome: "no-consensus", steps, costUsd };
  }

  // 3) SAGE
  const sage: SageVerdict = aiEnabled()
    ? await runSage(scan, hawk.side, hawk.levels, { newsDigest, lessons: await latestLessons() })
    : mockSage(hawk.levels);
  costUsd += sage.costUsd;
  steps.push({ stage: "sage", note: `${sage.approved ? "approve" : "VETO"} — ${sage.reason}` });

  if (!sage.approved) {
    await prisma.signal.update({
      where: { id: signal.id },
      data: { status: "vetoed", note: `SAGE veto: ${sage.reason}` },
    });
    return { symbol, outcome: "vetoed", steps, costUsd };
  }

  // 4) IRON RULES
  const levels = sage.adjusted;
  let lot: number;
  if (opts.lot != null) {
    lot = opts.lot;
  } else {
    const openPositions = await prisma.trade.findMany({
      where: { status: "open" },
      select: { symbol: true },
    });
    const openSymbols = [...new Set(openPositions.map((p) => p.symbol))].filter((s) => s !== symbol);

    let avgCorrelation: number | null = null;
    if (openSymbols.length > 0) {
      const currentReturns = await fetchDailyReturns(symbol);
      if (currentReturns) {
        const correlations: number[] = [];
        for (const openSymbol of openSymbols) {
          const openReturns = await fetchDailyReturns(openSymbol);
          if (!openReturns) continue;
          const corr = pearsonCorrelation(currentReturns, openReturns);
          if (corr != null) correlations.push(corr);
        }
        if (correlations.length > 0) {
          avgCorrelation = correlations.reduce((a, b) => a + b, 0) / correlations.length;
        }
      }
    }

    const riskUsd = ((await getStartingBalance()) * (await getRiskPctPerTrade())) / 100;
    const sizing = computeLot({
      entry: levels.entry,
      sl: levels.sl,
      riskUsd,
      maxLotPerTrade: DEFAULT_ACCOUNT.maxLotPerTrade,
      avgCorrelation,
    });
    lot = sizing.lot;
    steps.push({ stage: "sizing", note: sizing.reasoning });
  }
  const account: AccountState = {
    ...DEFAULT_ACCOUNT,
    dailyLossUsd: await todaysRealizedLoss(),
    killSwitch: await isKillSwitchOn(),
    openPositions: await prisma.trade.count({ where: { status: "open" } }),
    maxOpenPositions: await getMaxOpenPositions(),
  };
  const verdict = applyIronRules(
    { symbol, side: hawk.side, entry: levels.entry, sl: levels.sl, tp1: levels.tp1, lot },
    account,
  );
  steps.push({
    stage: "ironRules",
    note: verdict.passed ? `passed · R:R ${verdict.riskReward.toFixed(2)}` : `blocked: ${verdict.failures.join("; ")}`,
  });

  if (!verdict.passed) {
    await prisma.signal.update({
      where: { id: signal.id },
      data: { status: "discarded", note: `Iron Rules: ${verdict.failures.join("; ")}` },
    });
    return { symbol, outcome: "rules-blocked", steps, costUsd };
  }

  // 5) PAPER EXECUTION
  steps.push({ stage: "exec", note: `paper fill ${levels.entry.toFixed(4)} · staged TP armed` });
  const trade = await prisma.trade.create({
    data: {
      signalId: signal.id,
      symbol, side: hawk.side, entry: levels.entry, sl: levels.sl, tp1: levels.tp1, tp2: levels.tp2,
      lot, riskReward: riskReward({ symbol, side: hawk.side, entry: levels.entry, sl: levels.sl, tp1: levels.tp1, lot }),
      status: "open", ironRulesPassed: true,
      sageVerdict: `approve — ${sage.reason}`,
      hawkVotes: JSON.stringify(hawk.votes),
      decisionLog: JSON.stringify(steps),
      stagedTp: JSON.stringify({ tp1Hit: false, slToBreakeven: false }),
    },
  });
  await prisma.signal.update({ where: { id: signal.id }, data: { status: "executed" } });

  return { symbol, outcome: "executed", steps, tradeId: trade.id, costUsd };
}

// ---- helpers ----

async function latestNewsDigest(): Promise<string> {
  const fg = await getFearGreed();
  const news = await prisma.newsItem.findMany({ orderBy: { createdAt: "desc" }, take: 5 });
  const lines = news.map((n) => `${n.source}: ${n.title}${n.sentiment ? ` (${n.sentiment})` : ""}`).join("; ");
  return fg ? `Fear & Greed: ${fg.value} (${fg.label}); ${lines}` : lines;
}

async function latestLessons(): Promise<string> {
  const lessons = await prisma.lesson.findMany({ orderBy: { createdAt: "desc" }, take: 5 });
  return lessons.map((l) => l.text).join("; ");
}

async function todaysRealizedLoss(): Promise<number> {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const closed = await prisma.trade.findMany({ where: { status: "closed", closedAt: { gte: start } } });
  const loss = closed.reduce((s, t) => s + Math.min(0, t.pnl ?? 0), 0);
  return Math.abs(loss);
}

/** Daily returns for correlation, or null if the candle fetch fails. */
async function fetchDailyReturns(symbol: string): Promise<number[] | null> {
  try {
    const resp = await fetchCandles(symbol, "3mo", "1d");
    return dailyReturns(resp.candles);
  } catch {
    return null;
  }
}

// ---- mock path (no API key): deterministic so the pipeline is demoable ----

function mockHawk(scan: ScanResult): HawkVerdict {
  const side = scan.side!;
  const votes: HawkVote[] = [
    { persona: "trend", vote: side, confidence: 0.7, reason: "trend aligns (mock)" },
    { persona: "structure", vote: side, confidence: 0.6, reason: "respects structure (mock)" },
    { persona: "counter", vote: "skip", confidence: 0.4, reason: "slightly extended (mock)" },
  ];
  const atr = scan.atr ?? scan.price * 0.005;
  const e = scan.price;
  const levels: ProposedLevels =
    side === "long"
      ? { entry: e, sl: e - 1.5 * atr, tp1: e + 2.5 * atr, tp2: e + 4 * atr }
      : { entry: e, sl: e + 1.5 * atr, tp1: e - 2.5 * atr, tp2: e - 4 * atr };
  return { agreed: true, side, votes, levels, totalCostUsd: 0 };
}

function mockSage(levels: ProposedLevels): SageVerdict {
  return { approved: true, reason: "risk acceptable (mock)", adjusted: levels, costUsd: 0 };
}
