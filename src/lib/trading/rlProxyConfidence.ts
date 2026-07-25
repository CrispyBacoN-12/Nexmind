// Deterministic stand-in for what an aggregated HAWK/SAGE confidence might
// read, used only to label OFFLINE training data (scripts/rl/build-gold-dataset.ts)
// — never called on the live decision path (HAWK/SAGE keep real veto authority).

import { DEFAULT_THRESHOLDS } from "./scanner";

export interface ProxyConfidenceInput {
  adx: number | null;
  rsi: number | null;
  plusDI: number | null;
  minusDI: number | null;
  side: "long" | "short";
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Computes an unsigned magnitude 0..1 of how strongly indicators support
 * `side`, then applies the sign mechanically as the last step: positive for
 * "long", negative for "short" — so +1.0 always means "strong long
 * conviction" regardless of which raw readings produced it.
 */
export function proxyConfidence(input: ProxyConfidenceInput): number {
  const { adx, rsi, plusDI, minusDI, side } = input;
  if (adx == null || rsi == null || plusDI == null || minusDI == null) return 0;

  // Trend strength: how far ADX sits above the setup-gate floor, saturating at 2x floor.
  const trendStrength = clamp01((adx - DEFAULT_THRESHOLDS.adxFloor) / DEFAULT_THRESHOLDS.adxFloor);

  // RSI distance from 50, read in the direction `side` wants (long wants >50, short wants <50).
  const rsiSigned = side === "long" ? rsi - 50 : 50 - rsi;
  const rsiConviction = clamp01(rsiSigned / 50);

  // DI spread, read in the direction `side` wants (long wants +DI>-DI, short the mirror).
  const diSigned = side === "long" ? plusDI - minusDI : minusDI - plusDI;
  const diConviction = clamp01(diSigned / 50);

  const magnitude = clamp01((trendStrength + rsiConviction + diConviction) / 3);
  return side === "long" ? magnitude : -magnitude;
}
