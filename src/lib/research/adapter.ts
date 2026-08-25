// Bridges research strategies (AI-generated, sandbox-only) into the same
// Strategy contract every built-in strategy satisfies, so the backtest engine
// and scanner can use them without knowing the difference.

import { sma, rsi, macd, atr, adx, bollinger, stochastic, anchoredVWAP, dailyAnchor, type Candle } from "@/lib/indicators";
import type { ScanSnapshot } from "@/lib/trading/scanner";
import type { Strategy, StrategyEvaluator } from "@/lib/trading/strategies";
import { computeEntrySignals, type EntrySignals } from "@/lib/backtest/engine";
import { prisma } from "@/lib/db";
import { compileStrategy, SandboxSafetyError } from "./sandbox";
import { PANEL_VALIDATION } from "./panel";

const last = <T,>(arr: (T | null)[], i: number): T | null => arr[i] ?? null;

/** Precomputes a ScanSnapshot (minus `lc`, which research strategies don't get) for every bar. */
export function computeSnapshots(bars: Candle[]): ScanSnapshot[] {
  const closes = bars.map((c) => c.c);
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const r = rsi(closes, 14);
  const { histogram } = macd(closes);
  const atrArr = atr(bars, 14);
  const { adx: adxArr, plusDI, minusDI } = adx(bars, 14);
  const { upper: bbUpper, middle: bbMiddle, lower: bbLower } = bollinger(closes, 20, 2);
  const { k: stochKArr, d: stochDArr } = stochastic(bars, 14, 3, 3);
  const vwapArr = anchoredVWAP(bars, dailyAnchor);

  return bars.map((c, i) => {
    const bbU = last(bbUpper, i);
    const bbM = last(bbMiddle, i);
    const bbL = last(bbLower, i);
    const vwap = last(vwapArr, i);
    return {
      price: c.c,
      sma20: last(s20, i),
      sma50: last(s50, i),
      rsi: last(r, i),
      adx: last(adxArr, i),
      plusDI: last(plusDI, i),
      minusDI: last(minusDI, i),
      macdHist: last(histogram, i),
      atr: last(atrArr, i),
      bbPercentB: bbU != null && bbL != null && bbU !== bbL ? (c.c - bbL) / (bbU - bbL) : null,
      bbWidth: bbU != null && bbL != null && bbM ? (bbU - bbL) / bbM : null,
      stochK: last(stochKArr, i),
      stochD: last(stochDArr, i),
      vwapDevPct: vwap != null && vwap !== 0 ? (c.c - vwap) / vwap : null,
    };
  });
}

export function wrapAsStrategy(researchStrategy: { id: number; label: string; code: string; exitLadder?: string }): Strategy {
  let preferredExit: Strategy["preferredExit"];
  try {
    const parsed = JSON.parse(researchStrategy.exitLadder || "{}");
    if (typeof parsed.tp1Mult === "number" && typeof parsed.slMult === "number") {
      preferredExit = { tp1Mult: parsed.tp1Mult, slMult: parsed.slMult, singleTarget: !!parsed.singleTarget };
      // A swept trailing ladder has to survive the round trip or the live desk
      // silently trades the tp1Mult instead — which, on a trailing option, is
      // only a nominal R:R figure for the Iron Rules gate and was never an exit
      // level (see LADDER_TRAILS in runResearch.ts). Both multiples are
      // required: a half-specified trail is not a trail.
      const trail = parsed.trail;
      if (trail && typeof trail.activateMult === "number" && typeof trail.offsetMult === "number") {
        preferredExit.trail = { activateMult: trail.activateMult, offsetMult: trail.offsetMult };
      }
    }
  } catch {
    // malformed JSON — fall back to the engine's hardcoded RESEARCH_ATR_* ladder in src/lib/trading/engine.ts (preferredExit stays undefined)
  }

  return {
    key: `research-${researchStrategy.id}`,
    label: `${researchStrategy.label} (research)`,
    preferredExit,
    build(bars: Candle[]): StrategyEvaluator {
      const snaps = computeSnapshots(bars);
      const compiled = compileStrategy(researchStrategy.code);
      return (i: number) => compiled.invoke(bars, snaps, i);
    },
  };
}

const RESEARCH_KEY_RE = /^research-(\d+)$/;

/** True for any `research-{id}` strategy key, approved or not (cheap sync check, no DB hit). */
export function isResearchStrategyKey(key: string | null | undefined): boolean {
  return !!key && RESEARCH_KEY_RE.test(key);
}

/**
 * Async fallback for getStrategy() — only approved research strategies are ever
 * activatable, and as of 2026-08-25 only ones validated on the panel.
 *
 * The `validation` filter is the enforcement point for the whole panel change.
 * Everything upstream of it — folds, controls, bootstrap — is just measurement;
 * this line is what stops a row that was fitted and "held out" on a single
 * symbol over a window overlapping itself by 66% from being attached to a
 * portfolio. The 84 legacy rows already in the pool keep their status and their
 * history, they simply stop being eligible. Re-running one through a panel round
 * is the only way back in, which is the intended cost.
 */
export async function getResearchStrategy(key: string): Promise<Strategy | null> {
  const match = RESEARCH_KEY_RE.exec(key);
  if (!match) return null;
  const id = Number(match[1]);
  const row = await prisma.researchStrategy.findFirst({
    where: { id, status: "approved", validation: PANEL_VALIDATION },
  });
  if (!row) return null;
  return wrapAsStrategy(row);
}

export { SandboxSafetyError };

/**
 * Turn a candidate's source into the SignalSource the panel runner wants:
 * compile the sandbox once, then per symbol produce that symbol's entry signals.
 *
 * Lives here rather than in panelRun.ts to keep the panel gate free of the
 * sandbox — and, through it, of prisma — so the gate stays unit-testable
 * without a database.
 *
 * Note what is NOT passed to computeEntrySignals: `precomputed`. With a custom
 * entry rule the engine only needs each bar's ATR, so it takes the ~5ms
 * `atr(candles, 14)` path instead of building a full ScanSnapshot array it would
 * throw away. On a 2669-bar symbol that alone was 210ms of the 431ms a backtest
 * used to cost. The snapshots the *strategy* reads are the ones computed here.
 */
export function panelSignalsForCode(code: string): (symbol: string, candles: Candle[]) => EntrySignals {
  const compiled = compileStrategy(code);
  return (_symbol, candles) => {
    const snaps = computeSnapshots(candles);
    return computeEntrySignals(candles, undefined, (i) => compiled.invoke(candles, snaps, i)?.side ?? null);
  };
}
