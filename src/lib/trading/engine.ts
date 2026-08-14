// The trade tick — wires the team together for one symbol:
//   SCANNER (no AI) → HAWK×3 (vote) → SAGE (veto) → Iron Rules (code) → paper fill.
// Every stage is appended to a decision log so the War Room can show the trail.

import { prisma } from "@/lib/db";
import { aiEnabled } from "@/lib/anthropic";
import { scanSymbol, type ScanResult } from "./scanner";
import { runHawk, type HawkVerdict, type HawkVote, type ProposedLevels } from "./hawk";
import { runSage, type SageVerdict } from "./sage";
import { applyIronRules, riskReward, type AccountState } from "./ironRules";
import { applySlippage } from "./positionRules";
import { DEFAULT_COST_MODEL } from "@/lib/backtest/engine";
import { isKillSwitchOn, getFearGreed, getStartingBalance, getRiskPctPerTrade, isGlobalTradingHalt, getPortfolioStrategy, isWebullShadowEnabled } from "@/lib/settings";
import { type Interval, type Range } from "@/lib/yahoo";
import { fetchCandles } from "@/lib/marketData";
import { dailyReturns, pearsonCorrelation } from "./correlation";
import { computeLot } from "./positionSizing";
import { isResearchStrategyKey } from "@/lib/research/adapter";
import { sizeWithRL, type RLState } from "./rlSizer";
import { proxyConfidence } from "./rlProxyConfidence";
import { getCurrentDrawdownPct, getCurrentEquity } from "./circuitBreaker";
import { placeWebullBracketOrder } from "@/lib/webull/paperTrade";
import { createShadowOrder } from "@/lib/webull/shadowOrderStore";
import { sendDiscordNotification } from "@/lib/notify/discord";

export interface TickStep { stage: string; note: string; data?: Record<string, unknown> }
export interface TickResult {
  symbol: string;
  outcome: "no-setup" | "already-open" | "no-consensus" | "vetoed" | "rules-blocked" | "executed";
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

/**
 * Live-side state features for the shadow-mode RL sizer. exposurePct/cashPct/
 * drawdownPct are defined identically to Task 2's offline dataset builder —
 * continuous riskUsd/balance exposure and peak-equity drawdown — a different
 * concept from Iron Rules' gate thresholds (an equity curve, not a gate).
 * Feeding the model a differently-defined feature at inference than it saw in
 * training would silently make that feature meaningless to the learned
 * policy. See docs/superpowers/plans/2026-07-23-hybrid-rl-allocation.md's
 * Decision Log (resolved by SaladPak, 2026-07-25) for the full rationale.
 */
export function buildRLState(
  scan: ScanResult,
  side: "long" | "short",
  riskUsd: number,
  balance: number,
  drawdownPct: number,
): RLState {
  const exposurePct = balance > 0 ? riskUsd / balance : 0;
  return {
    proxyConfidence: proxyConfidence({
      adx: scan.snapshot.adx, rsi: scan.snapshot.rsi,
      plusDI: scan.snapshot.plusDI, minusDI: scan.snapshot.minusDI, side,
    }),
    atr: scan.atr,
    adx: scan.snapshot.adx,
    bbWidth: scan.snapshot.bbWidth ?? null,
    exposurePct,
    cashPct: 1 - exposurePct,
    drawdownPct,
  };
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
  const newsDigest = await latestNewsDigest();
  const exitOverride = resolveExitOverride(scan, isResearch);
  const hawk: HawkVerdict = aiEnabled()
    ? await runHawk(scan, { newsDigest, ...exitOverride })
    : mockHawk(scan, exitOverride);
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

    // Shadow mode: gold desk only, purely additive logging — never affects `lot`.
    if (symbol === "XAUUSD" || symbol === "GC=F") {
      const [balance, drawdownPctRaw] = await Promise.all([
        getCurrentEquity(portfolioId),
        getCurrentDrawdownPct(portfolioId),
      ]);
      const rlState = buildRLState(scan, hawk.side, riskUsd, balance, drawdownPctRaw / 100);
      const rl = await sizeWithRL(rlState, {
        entry: levels.entry, sl: levels.sl, riskUsd,
        maxLotPerTrade: DEFAULT_ACCOUNT.maxLotPerTrade, minLot: 0.01,
      });
      if (rl.available) {
        const rlNote = rl.vetoed
          ? "RL would skip this trade (below min lot)"
          : `RL would size ${rl.lot} lot (weight ${rl.weight.toFixed(2)})`;
        steps.push({
          stage: "rl-shadow",
          note: `${rlNote} vs actual ${lot}`,
          data: { rlWeight: rl.weight, rlLot: rl.lot, vetoed: rl.vetoed, actualLot: lot },
        });
      }
    }
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

  // Phase 2: risk-free shadow order into Webull's PaperTrade, purely
  // observational — awaited so it completes before this short-lived process
  // exits, but never throws into this path and never alters `trade`/`steps`
  // beyond appending its own note.
  if (await isWebullShadowEnabled(portfolioId)) {
    const shadowNote = await placeWebullShadow(trade.id, symbol, hawk.side, lot, fillEntry, levels.sl, levels.tp1);
    steps.push({ stage: "webull-shadow", note: shadowNote });
    // decisionLog was already written inside prisma.trade.create above, but
    // trade.id (needed for WebullShadowOrder.tradeId) didn't exist until that
    // call resolved — so the webull-shadow step can only be appended now, via
    // a follow-up update.
    await prisma.trade.update({ where: { id: trade.id }, data: { decisionLog: JSON.stringify(steps) } });
  }

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

/** Daily returns for correlation, or null if the candle fetch fails. */
async function fetchDailyReturns(symbol: string): Promise<number[] | null> {
  try {
    const resp = await fetchCandles(symbol, "3mo", "1d");
    return dailyReturns(resp.candles);
  } catch {
    return null;
  }
}

/** Places the Webull shadow order for a just-created Trade, never throwing —
 *  a Webull outage/rate-limit/auth failure must never affect the real
 *  (simulated) Trade. Returns the note appended to decisionLog. */
async function placeWebullShadow(
  tradeId: number, symbol: string, side: "long" | "short", qty: number, entry: number, sl: number, tp: number,
): Promise<string> {
  try {
    const result = await placeWebullBracketOrder({
      symbol, side, qty, entry, sl, tp,
      accountId: process.env.WEBULL_PAPER_ACCOUNT_ID ?? "",
    });

    if (result.kind === "skipped") {
      return `skipped: ${result.reason === "outside-rth" ? "outside RTH" : "qty < 1 share"}`;
    }

    if (result.kind === "error") {
      // INSUFFICIENT_FUNDS is expected once the PaperTrade account's simulated
      // buying power is used up by repeated shadow orders — log it but don't
      // spam Discord; any other failure (bad/revoked key, outage) still alerts.
      if (/insufficient.?funds/i.test(result.message)) {
        console.log(`[webull-shadow] insufficient funds for ${symbol} (trade#${tradeId})`);
      } else {
        await sendDiscordNotification(`Webull shadow order failed for ${symbol} (trade#${tradeId}): ${result.message}`, "warning");
      }
      return `error: ${result.message}`;
    }

    try {
      await createShadowOrder(tradeId, result.parentOrderId, result.slOrderId, result.tpOrderId);
      return `placed: parentOrderId=${result.parentOrderId}`;
    } catch (dbErr) {
      // Orphan-order mitigation: Webull placed the order but the DB write
      // failed — log everything needed for a human to find/cancel it by hand
      // in the Webull UI, since no row will track it.
      await sendDiscordNotification(
        `Webull shadow order placed for ${symbol} (trade#${tradeId}) but the DB write failed — ` +
          `parentOrderId=${result.parentOrderId} slOrderId=${result.slOrderId ?? "?"} tpOrderId=${result.tpOrderId ?? "?"}: ${String(dbErr)}`,
        "critical",
      );
      return `orphaned: parentOrderId=${result.parentOrderId} (DB write failed: ${String(dbErr)})`;
    }
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ---- mock path (no API key): deterministic so the pipeline is demoable ----

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
