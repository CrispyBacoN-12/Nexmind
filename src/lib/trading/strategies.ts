// Pluggable entry strategies. Each strategy precomputes whatever series it needs
// from the full bar array, then answers per bar i: "is there a fresh entry whose
// signal closes on this bar?" Pure and deterministic so the Backtest Lab can
// replay and compare them. Exits are still the shared ATR TP-ladder.

import { ema, type Candle } from "@/lib/indicators";

export interface StrategyResult { side: "long" | "short"; note: string }
export type StrategyEvaluator = (i: number) => StrategyResult | null;
export interface Strategy {
  key: string;
  label: string;
  build(bars: Candle[]): StrategyEvaluator;
}

/** EMA Cross — fast EMA(9) crossing the slow EMA(21). */
const emaCross: Strategy = {
  key: "ema-cross",
  label: "EMA Cross (9/21)",
  build(bars) {
    const closes = bars.map((c) => c.c);
    const e9 = ema(closes, 9);
    const e21 = ema(closes, 21);
    return (i) => {
      if (i < 1) return null;
      const a = e9[i], b = e21[i], pa = e9[i - 1], pb = e21[i - 1];
      if (a == null || b == null || pa == null || pb == null) return null;
      if (pa <= pb && a > b) return { side: "long", note: "EMA9 crossed above EMA21" };
      if (pa >= pb && a < b) return { side: "short", note: "EMA9 crossed below EMA21" };
      return null;
    };
  },
};

/** Opening Range Breakout — break of the first N bars' high/low of each UTC day.
 *  Intraday only: on daily candles each day has one bar, so it never fires. */
const openingRangeBreakout: Strategy = {
  key: "orb",
  label: "Opening Range Breakout",
  build(bars) {
    const OR_BARS = 4;
    const dayKey = bars.map((b) => Math.floor(b.t / 86_400)); // UTC day index
    const firstIdxOfDay = new Map<number, number>();
    bars.forEach((b, i) => { if (!firstIdxOfDay.has(dayKey[i])) firstIdxOfDay.set(dayKey[i], i); });
    const firedLong = new Set<number>();
    const firedShort = new Set<number>();
    return (i) => {
      const day = dayKey[i];
      const start = firstIdxOfDay.get(day)!;
      if (i - start < OR_BARS) return null; // still building the opening range
      let hi = -Infinity, lo = Infinity;
      for (let j = start; j < start + OR_BARS && j < bars.length; j++) { hi = Math.max(hi, bars[j].h); lo = Math.min(lo, bars[j].l); }
      const c = bars[i].c;
      if (c > hi && !firedLong.has(day)) { firedLong.add(day); return { side: "long", note: `ORB up > ${hi.toFixed(2)}` }; }
      if (c < lo && !firedShort.has(day)) { firedShort.add(day); return { side: "short", note: `ORB down < ${lo.toFixed(2)}` }; }
      return null;
    };
  },
};

/** Fair Value Gap (ICT) — a 3-bar imbalance: bar i-2 and bar i don't overlap,
 *  signalling a momentum gap. Trade in the gap's direction. */
const fairValueGap: Strategy = {
  key: "fvg",
  label: "Fair Value Gap (ICT)",
  build(bars) {
    return (i) => {
      if (i < 2) return null;
      const a = bars[i - 2], c = bars[i];
      if (a.h < c.l) return { side: "long", note: `bullish FVG ${a.h.toFixed(2)}–${c.l.toFixed(2)}` };
      if (a.l > c.h) return { side: "short", note: `bearish FVG ${c.h.toFixed(2)}–${a.l.toFixed(2)}` };
      return null;
    };
  },
};

export const STRATEGIES: Strategy[] = [emaCross, openingRangeBreakout, fairValueGap];

export function getStrategy(key: string): Strategy | null {
  return STRATEGIES.find((s) => s.key === key) ?? null;
}
