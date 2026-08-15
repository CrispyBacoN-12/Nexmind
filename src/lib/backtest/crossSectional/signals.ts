// Per-symbol series and the two decisions the ranker needs: is this symbol
// eligible today, and how far has it fallen. Everything reads bar indices <= i,
// which is what makes the whole backtest causal.
import { sma, rsi, atr, type Candle } from "@/lib/indicators";
import type { CsConfig } from "./types";

const VOL_WINDOW = 20;
const MOVE_WINDOW = 20;
/** SMA200 is the longest input, so nothing is trustworthy before this index. */
const WARMUP = 200;

export interface SymbolSeries {
  candles: Candle[];
  atr: (number | null)[];
  sma200: (number | null)[];
  sma5: (number | null)[];
  rsi2: (number | null)[];
  /** Trailing 20-bar average of close * volume. */
  dollarVol20: (number | null)[];
  /** Largest absolute close-to-close % move in the trailing 20 bars. */
  maxMovePct20: (number | null)[];
}

export function buildSeries(candles: Candle[]): SymbolSeries {
  const closes = candles.map((c) => c.c);

  const dollarVol20: (number | null)[] = candles.map((_, i) => {
    if (i < VOL_WINDOW - 1) return null;
    let sum = 0;
    for (let j = i - VOL_WINDOW + 1; j <= i; j++) sum += candles[j].c * candles[j].v;
    return sum / VOL_WINDOW;
  });

  const maxMovePct20: (number | null)[] = candles.map((_, i) => {
    if (i < MOVE_WINDOW) return null;
    let worst = 0;
    for (let j = i - MOVE_WINDOW + 1; j <= i; j++) {
      const prev = candles[j - 1].c;
      if (prev <= 0) continue;
      worst = Math.max(worst, Math.abs((candles[j].c - prev) / prev) * 100);
    }
    return worst;
  });

  return {
    candles,
    atr: atr(candles, 14),
    sma200: sma(closes, 200),
    sma5: sma(closes, 5),
    rsi2: rsi(closes, 2),
    dollarVol20,
    maxMovePct20,
  };
}

/** Point-in-time tradability check for bar `i`. Every input reads index <= i. */
export function isEligible(s: SymbolSeries, i: number, cfg: CsConfig): boolean {
  if (i < WARMUP) return false;

  const bar = s.candles[i];
  if (bar.c < cfg.minPrice) return false;

  const dv = s.dollarVol20[i];
  if (dv == null || dv < cfg.minDollarVol) return false;

  if (cfg.requireAboveSma200) {
    const s200 = s.sma200[i];
    if (s200 == null || bar.c <= s200) return false;
  }

  if (cfg.maxSingleDayMovePct != null) {
    const move = s.maxMovePct20[i];
    if (move == null || move > cfg.maxSingleDayMovePct) return false;
  }

  return true;
}

/**
 * How oversold the symbol is at bar `i`. **Lower is a better candidate.**
 * - atrReturn: the K-bar price change divided by ATR, so a $400 stock and a $20
 *   stock are on the same scale.
 * - rsi2: the 2-period RSI itself, which is already low when oversold.
 * Returns null when the inputs are unavailable at this index.
 */
export function rankScore(s: SymbolSeries, i: number, cfg: CsConfig): number | null {
  if (cfg.measure === "rsi2") return s.rsi2[i];

  const back = i - cfg.lookback;
  if (back < 0) return null;
  const a = s.atr[i];
  if (a == null || a <= 0) return null;
  return (s.candles[i].c - s.candles[back].c) / a;
}
