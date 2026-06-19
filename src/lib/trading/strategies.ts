// Pluggable entry strategies. Each strategy precomputes whatever series it needs
// from the full bar array, then answers per bar i: "is there a fresh entry whose
// signal closes on this bar?" Pure and deterministic so the Backtest Lab can
// replay and compare them. Exits are still the shared ATR TP-ladder.

import { sma, ema, rsi, macd, atr, adx, type Candle } from "@/lib/indicators";
import { decideSetup, type ScanSnapshot } from "./scanner";
import { lorentzianSeries } from "@/lib/lc/lorentzian";

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

/** Trend-pullback — the desk's built-in setup (SMA/ADX/RSI/MACD + Lorentzian),
 *  wrapped as a registry strategy so it can be compared and combined. */
const trendPullback: Strategy = {
  key: "trend-pullback",
  label: "Trend-pullback",
  build(bars) {
    const closes = bars.map((c) => c.c);
    const s20 = sma(closes, 20), s50 = sma(closes, 50), r = rsi(closes, 14);
    const { histogram } = macd(closes);
    const atrArr = atr(bars, 14);
    const { adx: adxArr, plusDI, minusDI } = adx(bars, 14);
    const lc = lorentzianSeries(bars);
    return (i) => {
      const snap: ScanSnapshot = {
        price: bars[i].c, sma20: s20[i], sma50: s50[i], rsi: r[i], adx: adxArr[i],
        plusDI: plusDI[i], minusDI: minusDI[i], macdHist: histogram[i], atr: atrArr[i],
        lc: { prediction: lc.prediction[i], signal: lc.signal[i], kernelBullish: lc.kernelBullish[i], kernelBearish: lc.kernelBearish[i] },
      };
      const { side } = decideSetup(snap);
      return side ? { side, note: "trend-pullback" } : null;
    };
  },
};

/** Dip Buy — long-only mean reversion with a trend filter. Enters when RSI
 *  bounces back out of oversold *and* price is above its SMA50, i.e. buying a
 *  pullback inside an uptrend rather than catching a falling knife. The naive
 *  symmetric RSI-30/70 version backtested negative (knives in BTC downtrends);
 *  the trend filter + long-only is the fix. */
const dipBuy: Strategy = {
  key: "mean-rev",
  label: "Dip Buy (RSI + SMA50 trend filter)",
  build(bars) {
    const closes = bars.map((c) => c.c);
    const r = rsi(closes, 14);
    const s50 = sma(closes, 50);
    return (i) => {
      if (i < 1) return null;
      const a = r[i], p = r[i - 1], ma = s50[i];
      if (a == null || p == null || ma == null) return null;
      // Shallow pullback turning back up while the longer-term trend is intact.
      if (p <= 45 && a > 45 && bars[i].c > ma) return { side: "long", note: `dip buy: RSI ${a.toFixed(0)}↑, above SMA50` };
      return null;
    };
  },
};

/** Rip Sell — the short-side mirror of Dip Buy. Shorts a bounce that rolls over
 *  (RSI rallying to >=55 then turning back down) while price is below SMA50, i.e.
 *  selling strength inside a downtrend instead of shorting the capitulation low. */
const ripSell: Strategy = {
  key: "rip-sell",
  label: "Rip Sell (RSI + SMA50 downtrend filter)",
  build(bars) {
    const closes = bars.map((c) => c.c);
    const r = rsi(closes, 14);
    const s50 = sma(closes, 50);
    return (i) => {
      if (i < 1) return null;
      const a = r[i], p = r[i - 1], ma = s50[i];
      if (a == null || p == null || ma == null) return null;
      // A bounce losing steam while the longer-term trend is still down.
      if (p >= 55 && a < 55 && bars[i].c < ma) return { side: "short", note: `rip sell: RSI ${a.toFixed(0)}↓, below SMA50` };
      return null;
    };
  },
};

export type CombineMode = "any" | "vote";

/** Build a meta-strategy that combines members. "any" enters when exactly one
 *  direction triggers this bar (conflicts skip). "vote" needs a fresh trigger
 *  plus >= minVotes members agreeing on that side within the last `window` bars. */
export function combineStrategies(
  key: string, label: string, memberKeys: string[], mode: CombineMode,
  opts: { minVotes?: number; window?: number } = {},
): Strategy {
  const minVotes = opts.minVotes ?? 2;
  const window = opts.window ?? 3;
  return {
    key, label,
    build(bars) {
      const evals = memberKeys
        .map((k) => getStrategy(k))
        .filter((s): s is Strategy => s != null)
        .map((s) => s.build(bars));
      // Precompute each member's per-bar signal once.
      const sigs = evals.map((ev) => bars.map((_, i) => ev(i)));
      const activeWithin = (side: "long" | "short", i: number) =>
        sigs.reduce((n, s) => {
          for (let j = Math.max(0, i - window + 1); j <= i; j++) if (s[j]?.side === side) return n + 1;
          return n;
        }, 0);
      return (i) => {
        const at = sigs.map((s) => s[i]);
        const longTrig = at.some((x) => x?.side === "long");
        const shortTrig = at.some((x) => x?.side === "short");
        if (mode === "any") {
          if (longTrig === shortTrig) return null; // none or conflicting
          return longTrig ? { side: "long", note: "combo OR long" } : { side: "short", note: "combo OR short" };
        }
        if (longTrig && !shortTrig && activeWithin("long", i) >= minVotes) return { side: "long", note: `combo vote long (${activeWithin("long", i)})` };
        if (shortTrig && !longTrig && activeWithin("short", i) >= minVotes) return { side: "short", note: `combo vote short (${activeWithin("short", i)})` };
        return null;
      };
    },
  };
}

export const STRATEGIES: Strategy[] = [
  trendPullback,
  emaCross,
  openingRangeBreakout,
  fairValueGap,
  dipBuy,
  ripSell,
  // Combos of the positive-edge members (EMA Cross excluded — it backtests negative).
  combineStrategies("combo-or", "Combo OR (Trend+ORB+FVG)", ["trend-pullback", "orb", "fvg"], "any"),
  combineStrategies("combo-vote", "Combo Vote≥2 (Trend+ORB+FVG)", ["trend-pullback", "orb", "fvg"], "vote", { minVotes: 2, window: 3 }),
];

export function getStrategy(key: string): Strategy | null {
  return STRATEGIES.find((s) => s.key === key) ?? null;
}
