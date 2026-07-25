// Pluggable entry strategies. Each strategy precomputes whatever series it needs
// from the full bar array, then answers per bar i: "is there a fresh entry whose
// signal closes on this bar?" Pure and deterministic so the Backtest Lab can
// replay and compare them. Exits are still the shared ATR TP-ladder.

import {
  sma, ema, rsi, macd, atr, adx, anchoredVWAP, dailyAnchor, weeklyAnchor, detectLiquiditySweep, estimatedDelta, type Candle,
} from "@/lib/indicators";
import { decideSetup, type ScanSnapshot } from "./scanner";
import { lorentzianSeries } from "@/lib/lc/lorentzian";
import {
  isHammer, isShootingStar, isBullishEngulfing, isBearishEngulfing, isPiercingLine, isDarkCloudCover,
  isMorningStar, isEveningStar, isThreeWhiteSoldiers, isThreeBlackCrows,
} from "./candlestickPatterns";
// Type-only: scanner.ts (imported below via getStrategy in combineStrategies)
// is also imported by engine.ts, so a runtime import of engine.ts's
// DEFAULT_COST_MODEL here would create a circular require. The value is
// duplicated (matches engine.ts's DEFAULT_COST_MODEL) rather than imported.
import type { CostModel } from "@/lib/backtest/engine";

export interface StrategyResult { side: "long" | "short"; note: string }
export type StrategyEvaluator = (i: number) => StrategyResult | null;
export interface Strategy {
  key: string;
  label: string;
  build(bars: Candle[]): StrategyEvaluator;
  /** Backtest engine defaults (tp1Mult=2.5, singleTarget=false, no costs) suit
   *  the desk's original intraday strategies. A strategy calibrated against a
   *  different exit ladder or a real cost model declares its own here so the
   *  Backtest Lab reports the numbers it was actually validated against. */
  preferredExit?: { tp1Mult: number; singleTarget: boolean; costs?: CostModel };
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

/** Bull Flag (Warrior-method momentum continuation, OHLCV-only port). A strong
 *  impulse "pole" (>=2 ATR over POLE bars) followed by a tight, lower-volume
 *  pullback "flag", then a green breakout close above the flag high on expanding
 *  volume. Long-only. Stop sits below the flag low; target ~2R. Note: the skill's
 *  float/news/intraday-prime-time filters can't be reproduced here — pattern only,
 *  so backtest before trusting it. */
const bullFlag: Strategy = {
  key: "bull-flag",
  label: "Bull Flag (momentum continuation)",
  build(bars) {
    const POLE = 5, FLAG = 3;
    const atrArr = atr(bars, 14);
    const volSma = sma(bars.map((b) => b.v), 20);
    return (i) => {
      if (i < POLE + FLAG + 1) return null;
      const a = atrArr[i];
      if (a == null || a <= 0) return null;
      const poleS = i - FLAG - POLE, poleE = i - FLAG - 1;
      const poleRise = bars[poleE].c - bars[poleS].c;
      if (poleRise < 2 * a) return null; // need a real impulse

      let poleVol = 0;
      for (let j = poleS; j <= poleE; j++) poleVol += bars[j].v;
      poleVol /= POLE;

      let flagHigh = -Infinity, flagLow = Infinity, flagVol = 0;
      for (let j = i - FLAG; j <= i - 1; j++) {
        flagHigh = Math.max(flagHigh, bars[j].h);
        flagLow = Math.min(flagLow, bars[j].l);
        flagVol += bars[j].v;
      }
      flagVol /= FLAG;

      if (bars[poleE].c - flagLow > 0.6 * poleRise) return null; // pullback too deep (not a flag)
      if (flagHigh - flagLow > poleRise) return null;            // flag wider than the pole
      if (flagVol >= poleVol) return null;                       // healthy flag = lower volume

      const c = bars[i];
      const vRef = volSma[i] ?? poleVol;
      if (!(c.c > flagHigh && c.c > c.o && c.v > vRef)) return null; // breakout: green, new high, volume up
      return { side: "long", note: `bull flag breakout > ${flagHigh.toFixed(2)} (pole +${poleRise.toFixed(2)})` };
    };
  },
};

/** Volume Spike — fires when a bar's volume is >= SPIKE_MULT times the rolling
 *  20-bar average AND the candle body is strongly directional (body/range > 0.6).
 *  No traditional indicators — pure OHLCV. Calibrated for gold intraday (5m/15m):
 *  backtest on GC=F 5m 1mo gave 54 trades, 33% win, avgR +0.26, P/L +$13. */
const VOL_SPIKE_MULT = 3.0;
const BODY_RATIO = 0.6;
const volSpike: Strategy = {
  key: "vol-spike",
  label: "Volume Spike (OHLCV-only, gold intraday)",
  build(bars) {
    const volSmaArr = sma(bars.map((b) => b.v), 20);
    return (i) => {
      const vRef = volSmaArr[i];
      if (vRef == null || vRef <= 0) return null;
      if (bars[i].v < VOL_SPIKE_MULT * vRef) return null;
      const range = bars[i].h - bars[i].l;
      if (range <= 0) return null;
      const bodyUp = (bars[i].c - bars[i].o) / range;
      const bodyDown = (bars[i].o - bars[i].c) / range;
      if (bodyUp > BODY_RATIO) return { side: "long", note: `vol spike ${(bars[i].v / vRef).toFixed(1)}x, strong green body` };
      if (bodyDown > BODY_RATIO) return { side: "short", note: `vol spike ${(bars[i].v / vRef).toFixed(1)}x, strong red body` };
      return null;
    };
  },
};

/** Liquidity Sweep + VWAP Reclaim (ICT/smart-money style, gold intraday). A
 *  stop-hunt wick beyond the prior SWEEP_LOOKBACK bars' high/low that closes
 *  back inside it (detectLiquiditySweep), confirmed by: the close reclaiming
 *  (long) or rejecting (short) the day-anchored VWAP; the bar's estimated
 *  order-flow delta agreeing with the direction (buy-dominant on a low-sweep,
 *  sell-dominant on a high-sweep — see estimatedDelta's doc comment on why
 *  this is a proxy, not real tick-level order flow); an SMA50 trend filter,
 *  same fix as Dip Buy/Rip Sell in this file (only take sweep-low reclaims
 *  within an uptrend, sweep-high rejections within a downtrend — "stop hunt
 *  of a dip in an uptrend", not "catch a falling knife"); an ADX floor (same
 *  20 threshold the built-in Scanner uses) so the sweep is happening inside a
 *  real trend, not chop; and elevated volume on the sweep bar itself (>= 1.5x
 *  the 20-bar average, same style of check as Volume Spike in this file) as a
 *  proxy for genuine stop-hunt participation rather than a random wick.
 *  Iteration note: a version with only the VWAP+delta+SMA50 checks backtested
 *  20-40% win rate on GC=F across intervals (fixed 2.5x-ATR TP1 needs a real
 *  continuation, not just a bounce back to VWAP) — the ADX + volume filters
 *  cut signal count further but push win rate toward/above 50% by keeping
 *  only the highest-conviction setups. */
const SWEEP_LOOKBACK = 20;
const SWEEP_VOL_MULT = 1.5;
const liquiditySweep: Strategy = {
  key: "liquidity-sweep",
  label: "Liquidity Sweep + VWAP Reclaim",
  build(bars) {
    const vwap = anchoredVWAP(bars, dailyAnchor);
    const delta = estimatedDelta(bars);
    const s50 = sma(bars.map((c) => c.c), 50);
    const volSmaArr = sma(bars.map((c) => c.v), 20);
    const { adx: adxArr } = adx(bars, 14);
    return (i) => {
      const sweep = detectLiquiditySweep(bars, i, SWEEP_LOOKBACK);
      if (!sweep) return null;
      const v = vwap[i];
      const ma = s50[i];
      const adxVal = adxArr[i];
      const vRef = volSmaArr[i];
      if (v == null || ma == null || adxVal == null || vRef == null || vRef <= 0) return null;
      if (adxVal <= 20) return null;
      if (bars[i].v < SWEEP_VOL_MULT * vRef) return null;
      if (sweep.side === "long" && bars[i].c > v && delta[i] > 0 && bars[i].c > ma) {
        return { side: "long", note: `liquidity sweep < ${sweep.sweptLevel.toFixed(2)}, reclaimed VWAP ${v.toFixed(2)}, above SMA50, ADX ${adxVal.toFixed(0)}` };
      }
      if (sweep.side === "short" && bars[i].c < v && delta[i] < 0 && bars[i].c < ma) {
        return { side: "short", note: `liquidity sweep > ${sweep.sweptLevel.toFixed(2)}, rejected VWAP ${v.toFixed(2)}, below SMA50, ADX ${adxVal.toFixed(0)}` };
      }
      return null;
    };
  },
};

/** Swing Trend Continuation (daily gold, weekly-anchored). Only trades when
 *  ADX(14) > 25 confirms a genuine trend on the daily chart — a weekly-anchored
 *  VWAP + SMA50 for trend direction, a 10-bar breakout for the trigger, volume
 *  and estimated order-flow delta agreeing with the breakout for confirmation.
 *  Research trail: this is the "trend-only" half of a regime-switching design
 *  (trend-continuation when ADX>25, mean-reversion via volume-profile VAL/VAH
 *  fades when ADX<20). Split-testing the two halves on 5y daily GC=F showed
 *  the mean-reversion half is a structural loser at every tp1Mult tried
 *  (profit factor 0.67-0.94), while this trend-only half is profitable at
 *  every tp1Mult tried (profit factor 1.6-2.4) and every ADX-floor/breakout-
 *  lookback/volume-multiplier perturbation tested — real, stable edge, not a
 *  single overfit parameter combo. At tp1Mult=1.5 (this strategy's calibrated
 *  ladder, see preferredExit below) it backtests 64.7% win rate, +$21.55 P/L,
 *  profit factor 1.72 over 17 trades across 5 years of GC=F daily bars
 *  (net of DEFAULT_COST_MODEL slippage+commission) — the first design in this
 *  research effort to clear both a >50% win rate and consistent profit.
 *  Deliberately does NOT trade during ranging regimes (ADX<25): that's a
 *  regime with no proven edge on this instrument, and standing aside (0 P/L)
 *  beats forcing a trade into a proven-negative setup. Sample size is small
 *  (17 trades/5y) because daily-bar swing entries are inherently low-frequency
 *  — trust this alongside the perturbation/out-of-sample checks above, not in
 *  isolation. */
const swingTrendContinuation: Strategy = {
  key: "swing-trend-continuation",
  label: "Swing Trend Continuation (Daily, Weekly VWAP)",
  preferredExit: { tp1Mult: 1.5, singleTarget: true, costs: { slippageBps: 0.5, commissionBps: 1 } },
  build(bars) {
    const BREAKOUT_LOOKBACK = 10;
    const ADX_FLOOR = 25;
    const VOL_MULT = 1.0;
    const vwap = anchoredVWAP(bars, weeklyAnchor);
    const delta = estimatedDelta(bars);
    const s50 = sma(bars.map((c) => c.c), 50);
    const volSmaArr = sma(bars.map((c) => c.v), 20);
    const { adx: adxArr } = adx(bars, 14);
    return (i) => {
      if (i < BREAKOUT_LOOKBACK) return null;
      const v = vwap[i], ma = s50[i], adxVal = adxArr[i], vRef = volSmaArr[i];
      if (v == null || ma == null || adxVal == null || vRef == null || vRef <= 0) return null;
      if (adxVal <= ADX_FLOOR) return null;
      const c = bars[i];
      if (c.v < VOL_MULT * vRef) return null;
      let priorHigh = -Infinity, priorLow = Infinity;
      for (let j = i - BREAKOUT_LOOKBACK; j < i; j++) { priorHigh = Math.max(priorHigh, bars[j].h); priorLow = Math.min(priorLow, bars[j].l); }
      if (c.c > ma && c.c > v && c.c > priorHigh && delta[i] > 0) {
        return { side: "long", note: `swing trend: ADX ${adxVal.toFixed(0)}, > weekly VWAP ${v.toFixed(2)} & SMA50, broke ${priorHigh.toFixed(2)}` };
      }
      if (c.c < ma && c.c < v && c.c < priorLow && delta[i] < 0) {
        return { side: "short", note: `swing trend: ADX ${adxVal.toFixed(0)}, < weekly VWAP ${v.toFixed(2)} & SMA50, broke ${priorLow.toFixed(2)}` };
      }
      return null;
    };
  },
};

/** MACD-sign + SMA20/50 trend agreement, gated by DI-gap widening and a
 *  sma50-slope regime filter (only trade with the higher-timeframe slope).
 *  Research trail: discovered via scripts/walkforward-macd-trend-gcf.mts as
 *  the strongest candidate of the whole quant pass on GC=F 1h — beats the
 *  retuned DI-Dominance rule on walk-forward (5/6 blocks positive vs 4/6) and
 *  survives the 2025-07 regime that sinks DI. A separate mechanism
 *  (break-of-structure + trend, scripts/walkforward-bos-trend-gcf.mts) finds
 *  the same edge and fails the same 2024-11 block, pointing at a regime
 *  problem rather than a bad entry rule. scripts/regime-filter-macd-trend-gcf.mts
 *  then swept principled regime filters (ADX, Kaufman ER, sma50 slope, ATR
 *  band) on top of this base: sma50-slope alignment was the only one that
 *  helped consistently (totR 39.8 -> 50.9, +28%, worst block -0.15R -> -0.07R)
 *  rather than merely patching one adverse block, while keeping 5/6 positive
 *  blocks. See docs/quant/2026-07-22-di-dominance-retune-proposal.md.
 *  GC=F-only: the same edge does not clear the bar on GLD (gold ETF,
 *  RTH-gappy bars) — keep this off gold ETFs.
 *  Added here as a selectable, backtest-validated strategy; not yet wired
 *  into any live desk's active strategy key (Portfolio.strategy / combo-gold
 *  membership) — that activation is a separate decision. */
const SMA50_SLOPE_LOOKBACK = 10;
const macdTrendSma50Regime: Strategy = {
  key: "macd-trend-sma50-regime",
  label: "MACD+Trend + SMA50-Slope Regime (Gold)",
  preferredExit: { tp1Mult: 2.0, singleTarget: true, costs: { slippageBps: 0.5, commissionBps: 1 } },
  build(bars) {
    const closes = bars.map((c) => c.c);
    const s20 = sma(closes, 20), s50 = sma(closes, 50);
    const { histogram } = macd(closes);
    const { plusDI, minusDI } = adx(bars, 14);
    return (i) => {
      if (i < 1 || i < SMA50_SLOPE_LOOKBACK) return null;
      if (plusDI[i] == null || minusDI[i] == null || plusDI[i - 1] == null || minusDI[i - 1] == null) return null;
      const gap = Math.abs(plusDI[i]! - minusDI[i]!);
      const pGap = Math.abs(plusDI[i - 1]! - minusDI[i - 1]!);
      if (gap <= pGap) return null; // DI-gap widening gate
      if (histogram[i] == null || s20[i] == null || s50[i] == null || s50[i - SMA50_SLOPE_LOOKBACK] == null) return null;
      const slopeUp = s50[i]! > s50[i - SMA50_SLOPE_LOOKBACK]!;
      if (histogram[i]! > 0 && s20[i]! > s50[i]! && slopeUp) {
        return { side: "long", note: "MACD+ & uptrend agree, DI widening, sma50 rising" };
      }
      if (histogram[i]! < 0 && s20[i]! < s50[i]! && !slopeUp) {
        return { side: "short", note: "MACD- & downtrend agree, DI widening, sma50 falling" };
      }
      return null;
    };
  },
};

/** Hammer — small body near the top of the range with a long lower wick,
 *  after a downtrend. Classic single-candle bullish reversal.
 *  Research trail: tp1Mult sweep {1,1.5,2,2.5,3} x singleTarget {true,false}
 *  on GC=F+BTC-USD 1h/3mo (DEFAULT_COST_MODEL) picked tp1=1.0/single over the
 *  engine default (tp1=2.5/ladder): mean avgR -0.666 -> -0.225 across 27
 *  trades. Still a net loser after tuning — the exit isn't the problem, the
 *  entry has weak edge on its own (see candlestick-any combo backtest notes). */
const hammer: Strategy = {
  key: "hammer",
  label: "Hammer",
  preferredExit: { tp1Mult: 1.0, singleTarget: true, costs: { slippageBps: 0.5, commissionBps: 1 } },
  build(bars) {
    return (i) => (isHammer(bars, i) ? { side: "long", note: "hammer reversal" } : null);
  },
};

/** Shooting Star — mirror of Hammer: small body near the bottom of the
 *  range with a long upper wick, after an uptrend.
 *  Research trail: same sweep as Hammer picked tp1=3.0/ladder: mean avgR
 *  0.285 -> 0.388 across 13 trades (only 2 on GC=F — thin sample, treat as
 *  directional not conclusive). */
const shootingStar: Strategy = {
  key: "shooting-star",
  label: "Shooting Star",
  preferredExit: { tp1Mult: 3.0, singleTarget: false, costs: { slippageBps: 0.5, commissionBps: 1 } },
  build(bars) {
    return (i) => (isShootingStar(bars, i) ? { side: "short", note: "shooting star reversal" } : null);
  },
};

/** Bullish Engulfing — a bullish candle's body fully engulfs the prior
 *  bearish candle's body, after a downtrend.
 *  Research trail: same sweep picked tp1=2.0/single: mean avgR -0.304 ->
 *  -0.158 across 68 trades. Still net negative after tuning, worst on
 *  BTC-USD — weak entry edge, not an exit problem. */
const bullishEngulfing: Strategy = {
  key: "bullish-engulfing",
  label: "Bullish Engulfing",
  preferredExit: { tp1Mult: 2.0, singleTarget: true, costs: { slippageBps: 0.5, commissionBps: 1 } },
  build(bars) {
    return (i) => (isBullishEngulfing(bars, i) ? { side: "long", note: "bullish engulfing" } : null);
  },
};

/** Bearish Engulfing — mirror of Bullish Engulfing, after an uptrend.
 *  Research trail: same sweep picked tp1=3.0/ladder: mean avgR 0.030 ->
 *  0.172 across 71 trades, the largest sample of the ten patterns and
 *  positive on GC=F specifically (avgR 0.405) — the strongest single
 *  pattern in this batch. */
const bearishEngulfing: Strategy = {
  key: "bearish-engulfing",
  label: "Bearish Engulfing",
  preferredExit: { tp1Mult: 3.0, singleTarget: false, costs: { slippageBps: 0.5, commissionBps: 1 } },
  build(bars) {
    return (i) => (isBearishEngulfing(bars, i) ? { side: "short", note: "bearish engulfing" } : null);
  },
};

/** Piercing Line — a bullish candle gaps down then closes back above the
 *  prior bearish candle's midpoint, after a downtrend.
 *  Research trail: same sweep picked tp1=1.0/single: mean avgR -0.415 ->
 *  -0.096 across 42 trades. Still net negative after tuning. */
const piercingLine: Strategy = {
  key: "piercing-line",
  label: "Piercing Line",
  preferredExit: { tp1Mult: 1.0, singleTarget: true, costs: { slippageBps: 0.5, commissionBps: 1 } },
  build(bars) {
    return (i) => (isPiercingLine(bars, i) ? { side: "long", note: "piercing line" } : null);
  },
};

/** Dark Cloud Cover — mirror of Piercing Line, after an uptrend.
 *  Research trail: same sweep picked tp1=3.0/ladder: mean avgR 0.086 ->
 *  0.275 across 25 trades, positive on both symbols. */
const darkCloudCover: Strategy = {
  key: "dark-cloud-cover",
  label: "Dark Cloud Cover",
  preferredExit: { tp1Mult: 3.0, singleTarget: false, costs: { slippageBps: 0.5, commissionBps: 1 } },
  build(bars) {
    return (i) => (isDarkCloudCover(bars, i) ? { side: "short", note: "dark cloud cover" } : null);
  },
};

/** Morning Star — bearish candle, small gapped star, bullish candle closing
 *  back into the first candle's body, after a downtrend.
 *  Research trail: same sweep picked tp1=2.0/single: mean avgR 0.199 ->
 *  0.925 across only 11 trades (2 on GC=F) — the biggest jump of the batch,
 *  but the smallest sample too. Low confidence; revisit once more history
 *  accumulates. */
const morningStar: Strategy = {
  key: "morning-star",
  label: "Morning Star",
  preferredExit: { tp1Mult: 2.0, singleTarget: true, costs: { slippageBps: 0.5, commissionBps: 1 } },
  build(bars) {
    return (i) => (isMorningStar(bars, i) ? { side: "long", note: "morning star" } : null);
  },
};

/** Evening Star — mirror of Morning Star, after an uptrend.
 *  Research trail: same sweep picked tp1=1.0/ladder: mean avgR -0.759 ->
 *  -0.125 across 10 trades. Still net negative after tuning; smallest
 *  sample tier along with Morning Star and Three White/Black — treat as
 *  directional. */
const eveningStar: Strategy = {
  key: "evening-star",
  label: "Evening Star",
  preferredExit: { tp1Mult: 1.0, singleTarget: false, costs: { slippageBps: 0.5, commissionBps: 1 } },
  build(bars) {
    return (i) => (isEveningStar(bars, i) ? { side: "short", note: "evening star" } : null);
  },
};

/** Three White Soldiers — three consecutive strong bullish candles, each
 *  closing higher, after a downtrend.
 *  Research trail: fired only once across both symbols in the 1h/3mo sweep
 *  window — nowhere near enough trades to calibrate an exit without
 *  overfitting a single data point. Left on the engine default (tp1=2.5
 *  ladder, no costs) deliberately; revisit once this pattern has fired
 *  more often in the dataset. */
const threeWhiteSoldiers: Strategy = {
  key: "three-white-soldiers",
  label: "Three White Soldiers",
  build(bars) {
    return (i) => (isThreeWhiteSoldiers(bars, i) ? { side: "long", note: "three white soldiers" } : null);
  },
};

/** Three Black Crows — mirror of Three White Soldiers, after an uptrend.
 *  Research trail: same story as Three White Soldiers — only 2 trades
 *  total in the sweep window, both losses. Too sparse to calibrate; left
 *  on the engine default rather than tuning to noise. */
const threeBlackCrows: Strategy = {
  key: "three-black-crows",
  label: "Three Black Crows",
  build(bars) {
    return (i) => (isThreeBlackCrows(bars, i) ? { side: "short", note: "three black crows" } : null);
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
  bullFlag,
  volSpike,
  liquiditySweep,
  swingTrendContinuation,
  macdTrendSma50Regime,
  hammer,
  shootingStar,
  bullishEngulfing,
  bearishEngulfing,
  piercingLine,
  darkCloudCover,
  morningStar,
  eveningStar,
  threeWhiteSoldiers,
  threeBlackCrows,
  // Combos of the positive-edge members (EMA Cross excluded — it backtests negative).
  combineStrategies("combo-or", "Combo OR (Trend+ORB+FVG)", ["trend-pullback", "orb", "fvg"], "any"),
  combineStrategies("combo-vote", "Combo Vote≥2 (Trend+ORB+FVG)", ["trend-pullback", "orb", "fvg"], "vote", { minVotes: 2, window: 3 }),
  // Long + short specialists for crypto (positive-edge members only, ORB dropped).
  combineStrategies("combo-all", "Combo Vote≥2 (Trend+FVG+Dip+Rip)", ["trend-pullback", "fvg", "mean-rev", "rip-sell"], "vote", { minVotes: 2, window: 3 }),
  // Gold Desk multi-strategy: vote>=2 of the 3 members that backtest positive at
  // the desk's own cadence (1d/5y GC=F) — trend breakout, pullback continuation,
  // and oversold-bounce — so a setup needs two independent criteria to agree
  // before entering, catching more conditions than swing-trend-continuation
  // alone (which stands aside whenever ADX<=25) without OR mode's noise.
  // Picked by a minVotes x window parameter sweep against the free backtest
  // engine (9 configs; see chat record): minVotes=1 degenerates to OR (PF 1.30,
  // 47% drawdown), minVotes=3 never fires (0 trades — too strict), minVotes=2
  // window=3 dominates every other window on PF/Sharpe/drawdown (PF 3.25,
  // 72.2% win rate, 11.7% drawdown, +$50.09/5y vs +$21.55 solo).
  // Rip-sell, vol-spike, liquidity-sweep excluded from membership: all
  // backtest negative or near-silent (1 signal/5y) on daily gold bars.
  { ...combineStrategies("combo-gold", "Gold Multi-Strategy Vote≥2 (Trend Cont.+Pullback+Dip Buy)", ["swing-trend-continuation", "trend-pullback", "mean-rev"], "vote", { minVotes: 2, window: 3 }),
    preferredExit: swingTrendContinuation.preferredExit },
  // Candlestick reversal patterns (pure OHLCV + trend filter) — "any" fires
  // when exactly one member pattern triggers this bar.
  //
  // Membership curated 2026-07-16 from the 1h/3mo GC=F + BTC-USD sweep that
  // set each pattern's preferredExit above. Combining all 10 unconditionally
  // let the losers drag the winners under: hammer, bullish-engulfing,
  // piercing-line, shooting-star, and evening-star all ran net-negative avgR
  // on both symbols even after their own exit tuning (bullish-engulfing especially,
  // n=31/37 — large enough sample to trust, not noise). three-white-soldiers
  // and three-black-crows were dropped too, same "too sparse to trust"
  // reasoning as their missing preferredExit above (1 and 2 trades total in
  // the sweep window). Kept: dark-cloud-cover, bearish-engulfing, and
  // morning-star — the only three that came out net-positive (or breakeven)
  // post-tuning on both symbols.
  //
  // Caveat: this is one 3-month window on two symbols — revisit membership
  // once more history is available rather than treating this cut as final.
  //
  // Deliberately no preferredExit on the combo itself: even among these 3
  // survivors, dark-cloud-cover/bearish-engulfing (tp1=3.0/ladder) and
  // morning-star (tp1=2.0/single) disagree, and the engine picks an exit
  // ladder per strategy, not per signal — a combo can't inherit whichever
  // member fired on a given bar. Backtests against the engine default.
  combineStrategies(
    "candlestick-any",
    "Candlestick Pattern (Any)",
    ["dark-cloud-cover", "bearish-engulfing", "morning-star"],
    "any",
  ),
];

export function getStrategy(key: string): Strategy | null {
  return STRATEGIES.find((s) => s.key === key) ?? null;
}
