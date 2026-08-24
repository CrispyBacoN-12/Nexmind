// The trade tick — wires the team together for one symbol:
//   SCANNER (no AI) → HAWK×3 (vote) → SAGE (veto) → Iron Rules (code) → paper fill.
// Every stage is appended to a decision log so the War Room can show the trail.

import { prisma } from "@/lib/db";
import { aiBackend, aiOutageReason, type AiBackend } from "@/lib/anthropic";
import { scanSymbol, type ScanResult } from "./scanner";
import { runHawk, type HawkVerdict, type HawkVote, type ProposedLevels } from "./hawk";
import { runSage, type SageVerdict } from "./sage";
import { buildAnalystContext, type AnalystExtras } from "./context";
import { fetchFundamentals, fundamentalsLine } from "@/lib/market/fundamentals";
import { applyIronRules, riskReward, type AccountState } from "./ironRules";
import { applySlippage } from "./positionRules";
import { recordCounterfactual } from "./counterfactual";
import { DEFAULT_COST_MODEL } from "@/lib/backtest/engine";
import { isKillSwitchOn, getFearGreed, getStartingBalance, getRiskPctPerTrade, isGlobalTradingHalt, getPortfolioStrategy } from "@/lib/settings";
import { type Interval, type Range } from "@/lib/yahoo";
import { fetchCandles } from "@/lib/marketData";
import { dailyReturns, pearsonCorrelation } from "./correlation";
import { computeLot } from "./positionSizing";
import { isResearchStrategyKey } from "@/lib/research/adapter";

export interface TickStep { stage: string; note: string; data?: Record<string, unknown> }
export interface TickResult {
  symbol: string;
  outcome: "no-setup" | "already-open" | "no-ai-backend" | "no-consensus" | "vetoed" | "rules-blocked" | "executed";
  steps: TickStep[];
  tradeId?: number;
  costUsd: number;
}

const DEFAULT_ACCOUNT: AccountState = {
  // Safety ceiling only — computeLot() already sizes down to the configured
  // risk % per trade; this just bounds the worst case (e.g. a very tight ATR).
  // Was 0.2, which silently truncated position size well below the intended
  // 1% risk target for every trade; raised so that target is actually reached.
  maxLotPerTrade: 5,
  maxSpread: 5,
  minRiskReward: 1.5,
};

// Research strategies are validated (win rate, expectancy) against a tight
// single-target ladder — see runResearch.ts's runBacktest — not the live
// desk's stretched default. Applying that ladder here is what makes the
// backtested win rate real for paper trading instead of a research-only
// artifact. minRiskReward is relaxed to match: the tight ladder's ~0.8:1
// reward:risk would fail the generic 1.5 floor, but it's exactly what was
// backtested and approved, so the floor here only guards against a broken 0/negative R:R.
const RESEARCH_ATR_SL_MULT = 1.5;
const RESEARCH_ATR_TP_MULT = 1.2;
const RESEARCH_MIN_RISK_REWARD = 0.5;

type ExitOverride = {
  atrSlMult?: number;
  atrTpMult?: number;
  singleTarget?: boolean;
  trail?: { activateMult: number; offsetMult: number };
};

// Built-in strategies tuned via the Backtest Lab (scan.preferredExit) take
// priority over the research ladder — both exist to make live paper trading
// match whatever was actually validated offline, rather than falling back to
// the generic desk default (1.5 SL / 2.5 TP with a trailing tp2).
export function resolveExitOverride(scan: ScanResult, isResearch: boolean): ExitOverride {
  if (scan.preferredExit) {
    return {
      atrTpMult: scan.preferredExit.tp1Mult,
      singleTarget: scan.preferredExit.singleTarget,
      ...(scan.preferredExit.slMult != null ? { atrSlMult: scan.preferredExit.slMult } : {}),
      ...(scan.preferredExit.trail ? { trail: scan.preferredExit.trail } : {}),
    };
  }
  if (isResearch) {
    return { atrSlMult: RESEARCH_ATR_SL_MULT, atrTpMult: RESEARCH_ATR_TP_MULT, singleTarget: true };
  }
  return {};
}

// SL is fixed at 1.5x ATR everywhere the exit ladder is computed (mockHawk,
// hawk.ts's computeLevels), so a tuned tp1Mult's achievable R:R is tp1Mult/1.5.
// morning-star (tp1Mult=2.0) lands at ~1.33, below the generic 1.5 floor — this
// only lowers the floor to match a strategy's own tuned ladder, never raises it.
export function minRiskRewardFor(scan: ScanResult, isResearch: boolean): number {
  if (scan.preferredExit) {
    return Math.min(DEFAULT_ACCOUNT.minRiskReward ?? 1.5, scan.preferredExit.tp1Mult / 1.5);
  }
  return isResearch ? RESEARCH_MIN_RISK_REWARD : (DEFAULT_ACCOUNT.minRiskReward ?? 1.5);
}

export async function runTradeTick(
  symbol: string,
  portfolioId: number,
  opts: { range?: Range; interval?: Interval; lot?: number; strategy?: string } = {},
): Promise<TickResult> {
  const steps: TickStep[] = [];
  let costUsd = 0;

  // 1) SCANNER (using the portfolio's chosen entry strategy unless overridden)
  const strategyKey = opts.strategy ?? (await getPortfolioStrategy(portfolioId));
  const isResearch = isResearchStrategyKey(strategyKey);
  const scan = await scanSymbol(symbol, opts.range, opts.interval, strategyKey);
  symbol = scan.symbol; // carry the symbol forward from the scan result
  steps.push({ stage: "scanner", note: scan.note });

  // One open position per symbol — re-scanning the same persisting setup must
  // not stack a duplicate trade (and must not burn AI calls finding that out).
  const existing = await prisma.trade.findFirst({
    where: { symbol, status: "open", portfolioId },
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
      portfolioId,
    },
  });

  if (!scan.side) {
    await prisma.signal.update({ where: { id: signal.id }, data: { status: "discarded" } });
    return { symbol, outcome: "no-setup", steps, costUsd };
  }

  // 2) HAWK ×3
  //
  // The AI stages used to degrade rather than fail: a desk with no backend
  // still scanned, still respected the Iron Rules, and decided on rules alone —
  // honestly labelled `aiBackend = "mock"`, never passed off as an analyst
  // verdict. That was deliberate, and on 2026-08-25 it was overruled by the
  // owner, because of what it added up to in practice: 45 of 45 trades ever
  // opened were mock, −$378.87 realised, and not one position had been seen by
  // HAWK or SAGE. A rule-only desk is a different product from the one being
  // built, and it was quietly running as if it were the same one.
  //
  // So: no backend, no NEW position. This deliberately does NOT touch position
  // management — open trades still get managed and closed on the pure-code exit
  // path, since stranding a live position with no exit logic is strictly worse
  // than the problem being fixed. The scan above still runs and is still logged,
  // so the War Room keeps showing which setups were passed on and why.
  const newsDigest = await latestNewsDigest();
  const exitOverride = resolveExitOverride(scan, isResearch);
  const backend: AiBackend = aiBackend();
  if (backend === "mock") {
    const why = aiOutageReason() ?? "no backend configured";
    steps.push({ stage: "ai", note: `no AI backend (${why}) — refusing to open a new position; HAWK/SAGE never saw this setup` });
    await prisma.signal.update({ where: { id: signal.id }, data: { status: "discarded" } });
    return { symbol, outcome: "no-ai-backend", steps, costUsd };
  }

  // The counterfactual arm. What the deterministic mock would have done with
  // this exact scan, written down next to whatever the analysts decide below.
  // Without it the Trade table only ever holds the trades HAWK and SAGE agreed
  // to take, so "are the analysts any good?" can only be answered from their own
  // survivors. Built before HAWK runs, because the interesting rows are the ones
  // where the analysts refuse and no Trade row is ever created.
  const mockRaw = mockSage(mockHawk(scan, exitOverride).levels!).adjusted;
  const mockLevels: ProposedLevels = {
    ...mockRaw,
    entry: applySlippage(scan.side === "long" ? "buy" : "sell", mockRaw.entry, DEFAULT_COST_MODEL.slippageBps ?? 0),
  };
  const cfLot = await counterfactualLot(portfolioId, mockLevels);
  const logCf = async (
    aiOutcome: "executed" | "no-consensus" | "vetoed" | "rules-blocked",
    aiReason: string,
    aiLevels: ProposedLevels | null,
    tradeId?: number,
  ) => {
    // No mock guard here any more: the only way to reach this point is with a
    // real backend, and a mid-flight analyst failure returns instead of
    // falling back, so the two arms can never be the same decision.
    await recordCounterfactual({
      portfolioId, symbol, timeframe: scan.timeframe, aiBackend: backend,
      scanSide: scan.side!, scanNote: scan.note,
      aiOutcome, aiReason, tradeId, aiLevels, mockLevels, lot: cfLot,
    });
  };

  // Built once and shared: HAWK's three personas and SAGE all judge the same
  // facts, so a disagreement means they read the market differently rather than
  // that one of them was handed a different market.
  const context = buildAnalystContext(scan, { ...(await fetchAnalystExtras(symbol)), newsDigest });

  let hawk: HawkVerdict;
  try {
    hawk = await runHawk(scan, { context, ...exitOverride });
  } catch (e) {
    // Was: fall back to mockHawk and keep going. Same refusal as the no-backend
    // guard above and for the same reason — a position opened on the rule-only
    // fallback is indistinguishable from one the analysts approved once it is
    // in the book, which is how 45 mock trades accumulated unnoticed.
    steps.push({ stage: "ai", note: `HAWK unavailable — refusing to open a new position (${errText(e)})` });
    await prisma.signal.update({ where: { id: signal.id }, data: { status: "discarded" } });
    return { symbol, outcome: "no-ai-backend", steps, costUsd };
  }
  costUsd += hawk.totalCostUsd;
  steps.push({
    stage: "hawk",
    note: `votes ${hawk.votes.map((v) => `${v.persona}:${v.vote}`).join(", ")} → ${hawk.agreed ? hawk.side : "no consensus"}`,
  });

  if (!hawk.agreed || !hawk.side || !hawk.levels) {
    await logCf("no-consensus", `votes ${hawk.votes.map((v) => `${v.persona}:${v.vote}`).join(", ")}`, null);
    await prisma.signal.update({ where: { id: signal.id }, data: { status: "discarded" } });
    return { symbol, outcome: "no-consensus", steps, costUsd };
  }

  // 3) SAGE — mockSage approves everything, so the old fall-through turned the
  // risk veto into a rubber stamp at exactly the moment risk review was
  // unavailable. Refuse instead: an unreviewed position is the one case where
  // "trade anyway" is worst.
  let sage: SageVerdict;
  try {
    sage = await runSage(scan, hawk.side, hawk.levels, { context, lessons: await latestLessons() });
  } catch (e) {
    steps.push({ stage: "ai", note: `SAGE unavailable — refusing to open a new position, risk veto could not be applied (${errText(e)})` });
    await prisma.signal.update({ where: { id: signal.id }, data: { status: "discarded" } });
    return { symbol, outcome: "no-ai-backend", steps, costUsd };
  }
  costUsd += sage.costUsd;
  steps.push({ stage: "sage", note: `${sage.approved ? "approve" : "VETO"} — ${sage.reason}` });

  if (!sage.approved) {
    await prisma.signal.update({
      where: { id: signal.id },
      data: { status: "vetoed", note: `SAGE veto: ${sage.reason}` },
    });
    await logCf("vetoed", sage.reason, null);
    return { symbol, outcome: "vetoed", steps, costUsd };
  }

  // 4) IRON RULES
  const levels = sage.adjusted;
  const account: AccountState = {
    ...DEFAULT_ACCOUNT,
    minRiskReward: minRiskRewardFor(scan, isResearch),
    killSwitch: await isKillSwitchOn(portfolioId),
    globalTradingHalt: await isGlobalTradingHalt(),
  };

  let lot: number;
  if (opts.lot != null) {
    lot = opts.lot;
  } else {
    const openPositions = await prisma.trade.findMany({
      where: { status: "open", portfolioId },
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

    const riskUsd = ((await getStartingBalance(portfolioId)) * (await getRiskPctPerTrade(portfolioId))) / 100;
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
    await logCf("rules-blocked", verdict.failures.join("; "), levels);
    return { symbol, outcome: "rules-blocked", steps, costUsd };
  }

  // 5) PAPER EXECUTION — filled with the same disclosed slippage assumption
  // QUANT's research backtests are judged against (DEFAULT_COST_MODEL), so a
  // strategy's live P/L stays comparable to the numbers that got it approved.
  const fillEntry = applySlippage(hawk.side === "long" ? "buy" : "sell", levels.entry, DEFAULT_COST_MODEL.slippageBps ?? 0);
  steps.push({ stage: "exec", note: `paper fill ${fillEntry.toFixed(4)} · staged TP armed` });
  const trade = await prisma.trade.create({
    data: {
      signalId: signal.id, portfolioId,
      symbol, side: hawk.side, entry: fillEntry, sl: levels.sl, tp1: levels.tp1, tp2: levels.tp2,
      lot, riskReward: riskReward({ symbol, side: hawk.side, entry: fillEntry, sl: levels.sl, tp1: levels.tp1, lot }),
      status: "open", ironRulesPassed: true,
      sageVerdict: `approve — ${sage.reason}`,
      // Stamped so performance analysis can separate trades the analysts really
      // decided from trades the deterministic stand-in decided. Without it the
      // two are indistinguishable in the DB and every review of "how is the AI
      // doing" silently measures the mock instead.
      aiBackend: backend,
      hawkVotes: JSON.stringify(hawk.votes),
      decisionLog: JSON.stringify(steps),
      stagedTp: JSON.stringify({
        tp1Hit: false,
        slToBreakeven: false,
        // No dedicated Trade column for a trailing stop's static config — carried
        // here so manage.ts can reconstruct it on every subsequent tick. origSl
        // anchors R-multiple math to the true initial risk once ticks start
        // ratcheting the Trade row's `sl` column away from where it opened.
        ...(levels.trail ? { trail: levels.trail, origSl: levels.sl } : {}),
      }),
    },
  });
  await prisma.signal.update({ where: { id: signal.id }, data: { status: "executed" } });
  await logCf("executed", `approve — ${sage.reason}`, { ...levels, entry: fillEntry }, trade.id);

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

/** The two facts the scan can't produce: the daily chart and the company behind
 *  the ticker. Both fail soft — a missing block costs the analysts a paragraph,
 *  not the trade. */
async function fetchAnalystExtras(symbol: string): Promise<AnalystExtras> {
  const [higherTf, fundamentals] = await Promise.all([
    fetchCandles(symbol, "1y", "1d").then((r) => r.candles).catch(() => null),
    fetchFundamentals(symbol).then((f) => fundamentalsLine(f, symbol)).catch(() => null),
  ]);
  return { higherTf, fundamentals };
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

/** Position size for both counterfactual arms, always taken off the mock
 *  ladder. Holding size constant is what makes the difference between the arms
 *  a measure of the DECISION rather than of the sizing — and the correlation
 *  haircut is left out on purpose, since which positions are open is itself
 *  downstream of past AI decisions and would leak one arm into the other. */
async function counterfactualLot(portfolioId: number, levels: ProposedLevels): Promise<number> {
  const riskUsd = ((await getStartingBalance(portfolioId)) * (await getRiskPctPerTrade(portfolioId))) / 100;
  return computeLot({
    entry: levels.entry, sl: levels.sl, riskUsd,
    maxLotPerTrade: DEFAULT_ACCOUNT.maxLotPerTrade, avgCorrelation: null,
  }).lot;
}

function errText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 160);
}

// ---- The deterministic rule-only arm. As of 2026-08-25 this NO LONGER decides
// any trade: its sole remaining caller is the counterfactual baseline, i.e. the
// "what would rules alone have done?" column the analysts are measured against.
// Nothing below is an opinion, and nothing below can open a position. ----

function mockHawk(scan: ScanResult, exit: ExitOverride): HawkVerdict {
  const side = scan.side!;
  const votes: HawkVote[] = [
    { persona: "trend", vote: side, confidence: 0.7, reason: "trend aligns (mock)" },
    { persona: "structure", vote: side, confidence: 0.6, reason: "respects structure (mock)" },
    { persona: "counter", vote: "skip", confidence: 0.4, reason: "slightly extended (mock)" },
  ];
  const atr = scan.atr ?? scan.price * 0.005;
  const e = scan.price;
  // No API key configured -> this mock path is what actually runs. Defaults
  // mirror hawk.ts's own computeLevels() so the mock and real-AI paths agree;
  // exit overrides (research ladder or a strategy's tuned preferredExit) win
  // when present so the validated win rate carries into paper trades.
  const slMult = exit.atrSlMult ?? 1.5;
  const tpMult = exit.atrTpMult ?? 2.5;
  const singleTarget = exit.singleTarget ?? false;
  const trail = exit.trail ? { activateDist: exit.trail.activateMult * atr, offsetDist: exit.trail.offsetMult * atr } : null;
  const levels: ProposedLevels =
    side === "long"
      ? { entry: e, sl: e - slMult * atr, tp1: e + tpMult * atr, tp2: singleTarget ? null : e + tpMult * 1.6 * atr, trail }
      : { entry: e, sl: e + slMult * atr, tp1: e - tpMult * atr, tp2: singleTarget ? null : e - tpMult * 1.6 * atr, trail };
  return { agreed: true, side, votes, levels, totalCostUsd: 0 };
}

function mockSage(levels: ProposedLevels): SageVerdict {
  return { approved: true, reason: "risk acceptable (mock)", adjusted: levels, costUsd: 0 };
}
