// Bridges research strategies (AI-generated, sandbox-only) into the same
// Strategy contract every built-in strategy satisfies, so the backtest engine
// and scanner can use them without knowing the difference.

import { sma, rsi, macd, atr, adx, bollinger, stochastic, anchoredVWAP, dailyAnchor, type Candle } from "@/lib/indicators";
import type { ScanSnapshot } from "@/lib/trading/scanner";
import type { Strategy, StrategyEvaluator } from "@/lib/trading/strategies";
import { prisma } from "@/lib/db";
import { compileStrategy, SandboxSafetyError } from "./sandbox";

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

export function wrapAsStrategy(researchStrategy: { id: number; label: string; code: string }): Strategy {
  return {
    key: `research-${researchStrategy.id}`,
    label: `${researchStrategy.label} (research)`,
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

/** Async fallback for getStrategy() — only approved research strategies are ever activatable. */
export async function getResearchStrategy(key: string): Promise<Strategy | null> {
  const match = RESEARCH_KEY_RE.exec(key);
  if (!match) return null;
  const id = Number(match[1]);
  const row = await prisma.researchStrategy.findFirst({ where: { id, status: "approved" } });
  if (!row) return null;
  return wrapAsStrategy(row);
}

export { SandboxSafetyError };
