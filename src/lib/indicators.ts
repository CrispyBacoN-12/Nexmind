// Pure functions for technical indicators.
// Inputs are arrays of closing prices (or any numeric series).
// Outputs are aligned arrays (same length as input) with nulls where the
// indicator has insufficient look-back data.
//
// Core indicators (sma/ema/rsi/macd/bollinger/fastStoch/mcdx) are copied from
// the stock-tracker project. ATR + ADX are added here for the NEXMIND Scanner.

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period];
    out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) gain += diff;
    else loss -= diff;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine: (number | null)[] = values.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f != null && s != null ? f - s : null;
  });

  const firstIdx = macdLine.findIndex((v) => v != null);
  const signalLine: (number | null)[] = new Array(values.length).fill(null);
  if (firstIdx !== -1) {
    const sliced = macdLine.slice(firstIdx).filter((v): v is number => v != null);
    const sig = ema(sliced, signal);
    for (let i = 0; i < sig.length; i++) {
      signalLine[firstIdx + i] = sig[i];
    }
  }

  const histogram: (number | null)[] = values.map((_, i) => {
    const m = macdLine[i];
    const s = signalLine[i];
    return m != null && s != null ? m - s : null;
  });

  return { macdLine, signalLine, histogram };
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const middle = sma(values, period);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i++) {
    const m = middle[i] as number;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (values[j] - m) ** 2;
    const std = Math.sqrt(sumSq / period);
    upper[i] = m + mult * std;
    lower[i] = m - mult * std;
  }
  return { upper, middle, lower };
}

/**
 * Stochastic Oscillator: %K = raw fast stochastic (position of close within the
 * period's high-low range, 0-100), %D = smoothed %K (the slow/signal line).
 * Ported from the stock-tracker project's fastStoch, extended with %D for the
 * classic %K/%D crossover reading.
 */
export function stochastic(candles: Candle[], period = 14, smoothK = 3, smoothD = 3) {
  const n = candles.length;
  const rawK: (number | null)[] = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].h > hh) hh = candles[j].h;
      if (candles[j].l < ll) ll = candles[j].l;
    }
    const range = hh - ll;
    rawK[i] = range === 0 ? 50 : (100 * (candles[i].c - ll)) / range;
  }

  const smoothSeries = (series: (number | null)[], p: number): (number | null)[] => {
    const out: (number | null)[] = new Array(series.length).fill(null);
    for (let i = p - 1; i < series.length; i++) {
      let sum = 0;
      let ok = true;
      for (let j = i - p + 1; j <= i; j++) {
        const v = series[j];
        if (v == null) { ok = false; break; }
        sum += v;
      }
      if (ok) out[i] = sum / p;
    }
    return out;
  };

  const k = smoothSeries(rawK, smoothK);
  const d = smoothSeries(k, smoothD);
  return { k, d };
}

// ---------- ATR + ADX (added for the Scanner) ----------

/**
 * True Range series. TR[i] = max(high-low, |high-prevClose|, |low-prevClose|).
 * TR[0] is high-low (no previous close).
 */
export function trueRange(candles: Candle[]): number[] {
  const out: number[] = new Array(candles.length).fill(0);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) {
      out[i] = c.h - c.l;
      continue;
    }
    const prevClose = candles[i - 1].c;
    out[i] = Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose));
  }
  return out;
}

/** Wilder's ATR (smoothed true range). */
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return out;
  const tr = trueRange(candles);

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let prev = sum / period;
  out[period] = prev;

  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/**
 * Wilder's ADX with +DI / -DI. Measures trend strength (not direction).
 * ADX > 25 typically signals a trending market; < 20 = ranging.
 */
export function adx(candles: Candle[], period = 14) {
  const n = candles.length;
  const adxArr: (number | null)[] = new Array(n).fill(null);
  const plusDI: (number | null)[] = new Array(n).fill(null);
  const minusDI: (number | null)[] = new Array(n).fill(null);
  if (n < period * 2) return { adx: adxArr, plusDI, minusDI };

  const tr = trueRange(candles);
  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const up = candles[i].h - candles[i - 1].h;
    const down = candles[i - 1].l - candles[i].l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }

  // Wilder smoothing of TR / +DM / -DM seeded over the first `period` bars.
  let trS = 0;
  let pS = 0;
  let mS = 0;
  for (let i = 1; i <= period; i++) {
    trS += tr[i];
    pS += plusDM[i];
    mS += minusDM[i];
  }

  const dx: number[] = new Array(n).fill(0);
  const computeDX = (i: number) => {
    const pdi = trS === 0 ? 0 : (100 * pS) / trS;
    const mdi = trS === 0 ? 0 : (100 * mS) / trS;
    plusDI[i] = pdi;
    minusDI[i] = mdi;
    const denom = pdi + mdi;
    dx[i] = denom === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / denom;
  };
  computeDX(period);

  for (let i = period + 1; i < n; i++) {
    trS = trS - trS / period + tr[i];
    pS = pS - pS / period + plusDM[i];
    mS = mS - mS / period + minusDM[i];
    computeDX(i);
  }

  // ADX = Wilder-smoothed DX, first value at index period*2-1.
  let adxStart = period * 2 - 1;
  if (adxStart >= n) return { adx: adxArr, plusDI, minusDI };
  let sumDX = 0;
  for (let i = period; i <= adxStart; i++) sumDX += dx[i];
  let prevAdx = sumDX / period;
  adxArr[adxStart] = prevAdx;
  for (let i = adxStart + 1; i < n; i++) {
    prevAdx = (prevAdx * (period - 1) + dx[i]) / period;
    adxArr[i] = prevAdx;
  }
  return { adx: adxArr, plusDI, minusDI };
}

// ---------- Signal helpers (latest reading) ----------

export type Signal = "strong-bull" | "bull" | "neutral" | "bear" | "strong-bear";

export function rsiSignal(value: number): { signal: Signal; label: string } {
  if (value >= 70) return { signal: "bear", label: "Overbought" };
  if (value >= 60) return { signal: "bull", label: "Strong" };
  if (value > 40) return { signal: "neutral", label: "Neutral" };
  if (value > 30) return { signal: "bear", label: "Weak" };
  return { signal: "bull", label: "Oversold" };
}

export function macdSignal(macdLine: number, signalLine: number, histogram: number, prevHist: number | null) {
  const crossing = prevHist != null && Math.sign(prevHist) !== Math.sign(histogram);
  if (macdLine > signalLine && histogram > 0) {
    return crossing
      ? { signal: "strong-bull" as Signal, label: "Bullish crossover" }
      : { signal: "bull" as Signal, label: "Bullish" };
  }
  if (macdLine < signalLine && histogram < 0) {
    return crossing
      ? { signal: "strong-bear" as Signal, label: "Bearish crossover" }
      : { signal: "bear" as Signal, label: "Bearish" };
  }
  return { signal: "neutral" as Signal, label: "Neutral" };
}

export function smaTrendSignal(price: number, s20: number | null, s50: number | null, s200: number | null) {
  if (s20 == null || s50 == null || s200 == null) {
    return { signal: "neutral" as Signal, label: "Insufficient data" };
  }
  const above20 = price > s20;
  const above50 = price > s50;
  const above200 = price > s200;
  const goldenCross = s50 > s200;
  const allUp = above20 && above50 && above200 && goldenCross;
  const allDown = !above20 && !above50 && !above200 && !goldenCross;

  if (allUp) return { signal: "strong-bull" as Signal, label: "Uptrend (golden cross)" };
  if (allDown) return { signal: "strong-bear" as Signal, label: "Downtrend (death cross)" };
  if (above50 && goldenCross) return { signal: "bull" as Signal, label: "Above 50, golden cross" };
  if (!above50 && !goldenCross) return { signal: "bear" as Signal, label: "Below 50, death cross" };
  return { signal: "neutral" as Signal, label: "Mixed signals" };
}

export function adxSignal(adxVal: number, plusDI: number, minusDI: number): { signal: Signal; label: string } {
  if (adxVal < 20) return { signal: "neutral", label: "Ranging (weak trend)" };
  const dir = plusDI >= minusDI;
  if (adxVal >= 40) return { signal: dir ? "strong-bull" : "strong-bear", label: `Strong ${dir ? "up" : "down"}trend` };
  return { signal: dir ? "bull" : "bear", label: `${dir ? "Up" : "Down"}trend` };
}

// ---------- Anchored VWAP, liquidity sweep, volume profile, order-flow proxy ----------
// Added for the Gold Desk's liquidity-sweep strategy (smart-money/ICT-style tools).

/**
 * VWAP re-anchored every time `isAnchor(i, candles)` is true (e.g. a new session
 * or day) — cumulative sum of typical-price*volume / cumulative volume since the
 * last anchor bar.
 */
export function anchoredVWAP(candles: Candle[], isAnchor: (i: number, candles: Candle[]) => boolean): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let pvSum = 0;
  let vSum = 0;
  for (let i = 0; i < candles.length; i++) {
    if (isAnchor(i, candles)) { pvSum = 0; vSum = 0; }
    const c = candles[i];
    const typical = (c.h + c.l + c.c) / 3;
    pvSum += typical * c.v;
    vSum += c.v;
    out[i] = vSum > 0 ? pvSum / vSum : null;
  }
  return out;
}

/** Anchor detector: reset at every new UTC day (same day-bucketing convention
 *  the Opening Range Breakout strategy uses). */
export function dailyAnchor(i: number, candles: Candle[]): boolean {
  if (i === 0) return true;
  return Math.floor(candles[i].t / 86_400) !== Math.floor(candles[i - 1].t / 86_400);
}

/** Anchor detector for swing/daily-bar strategies: reset at every new week
 *  (a weekday-number rollover, e.g. Fri→Mon, or any gap > 3 days for a
 *  weekend/holiday) instead of every day — daily-bar VWAP needs a longer
 *  anchor window than an intraday day-session reset. */
export function weeklyAnchor(i: number, candles: Candle[]): boolean {
  if (i === 0) return true;
  const prevDay = new Date(candles[i - 1].t * 1000).getUTCDay();
  const curDay = new Date(candles[i].t * 1000).getUTCDay();
  return curDay < prevDay || candles[i].t - candles[i - 1].t > 3 * 86_400;
}

/**
 * Pick the VWAP anchor that suits the bar spacing. A daily reset is right for
 * intraday bars, but on daily bars every bar is its own session — VWAP collapses
 * onto that bar's own typical price and the deviation is always ~0, which reads
 * as "price is exactly at fair value" on every single bar. Weekly instead.
 */
export function anchorFor(candles: Candle[]): (i: number, candles: Candle[]) => boolean {
  return medianSpacingSec(candles) >= 23 * 3600 ? weeklyAnchor : dailyAnchor;
}

function medianSpacingSec(candles: Candle[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < Math.min(candles.length, 50); i++) gaps.push(candles[i].t - candles[i - 1].t);
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

export interface LiquiditySweep { side: "long" | "short"; sweptLevel: number }

/**
 * Liquidity sweep (stop hunt): bar i's wick pierces beyond the extreme of the
 * prior `lookback` bars (a resting-stop pool just past a swing high/low) but
 * closes back inside it — "grab the stops, then reverse." Returns the implied
 * reversal direction, or null if bar i doesn't qualify.
 */
export function detectLiquiditySweep(candles: Candle[], i: number, lookback = 20): LiquiditySweep | null {
  if (i < lookback) return null;
  let priorHigh = -Infinity;
  let priorLow = Infinity;
  for (let j = i - lookback; j < i; j++) {
    priorHigh = Math.max(priorHigh, candles[j].h);
    priorLow = Math.min(priorLow, candles[j].l);
  }
  const c = candles[i];
  if (c.l < priorLow && c.c > priorLow) return { side: "long", sweptLevel: priorLow };
  if (c.h > priorHigh && c.c < priorHigh) return { side: "short", sweptLevel: priorHigh };
  return null;
}

export interface VolumeProfileLevels { poc: number; vah: number; val: number }

/**
 * Rolling volume profile over the `lookback` bars ending at i (inclusive).
 * Buckets each bar's volume across the price buckets its high-low range spans
 * (a standard simplification when true per-price tick volume isn't available),
 * finds the point of control (highest-volume bucket), then expands outward
 * bucket-by-bucket until >= valueAreaPct of total volume is enclosed.
 */
export function volumeProfile(
  candles: Candle[], i: number, lookback = 50, bins = 24, valueAreaPct = 0.7,
): VolumeProfileLevels | null {
  if (i < lookback - 1) return null;
  const start = i - lookback + 1;
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = start; j <= i; j++) { hi = Math.max(hi, candles[j].h); lo = Math.min(lo, candles[j].l); }
  if (hi <= lo) return null;

  const width = (hi - lo) / bins;
  const vol = new Array(bins).fill(0);
  for (let j = start; j <= i; j++) {
    const c = candles[j];
    const bLo = Math.max(0, Math.floor((c.l - lo) / width));
    const bHi = Math.min(bins - 1, Math.floor((c.h - lo) / width));
    const span = bHi - bLo + 1;
    for (let b = bLo; b <= bHi; b++) vol[b] += c.v / span;
  }

  let pocIdx = 0;
  for (let b = 1; b < bins; b++) if (vol[b] > vol[pocIdx]) pocIdx = b;
  const totalVol = vol.reduce((s, v) => s + v, 0);

  let loIdx = pocIdx;
  let hiIdx = pocIdx;
  let covered = vol[pocIdx];
  while (covered < valueAreaPct * totalVol && (loIdx > 0 || hiIdx < bins - 1)) {
    const nextLo = loIdx > 0 ? vol[loIdx - 1] : -1;
    const nextHi = hiIdx < bins - 1 ? vol[hiIdx + 1] : -1;
    if (nextHi >= nextLo) { hiIdx++; covered += vol[hiIdx]; }
    else { loIdx--; covered += vol[loIdx]; }
  }

  const priceOf = (idx: number) => lo + (idx + 0.5) * width;
  return { poc: priceOf(pocIdx), vah: priceOf(hiIdx), val: priceOf(loIdx) };
}

/**
 * Proxy for real bid/ask order-flow delta (buy volume minus sell volume) when
 * only OHLCV bars are available — this app's gold feed is spot/CFD, not a
 * futures DOM/tick feed, so there's no real order flow to read. Approximates
 * delta from where the bar closed within its own high-low range: a close near
 * the high implies buy-dominant flow, near the low implies sell-dominant. This
 * is a well-known retail approximation, NOT real order flow — directional bias
 * only, not a precise buy/sell split.
 */
export function estimatedDelta(candles: Candle[]): number[] {
  return candles.map((c) => {
    const range = c.h - c.l;
    if (range <= 0) return 0;
    const closePos = (c.c - c.l) / range; // 0 = closed at low, 1 = closed at high
    return c.v * (2 * closePos - 1); // -v..+v
  });
}

/** Running sum of estimatedDelta — a cumulative volume delta (CVD) proxy. */
export function cumulativeDelta(candles: Candle[]): number[] {
  const d = estimatedDelta(candles);
  const out: number[] = new Array(d.length);
  let sum = 0;
  for (let i = 0; i < d.length; i++) { sum += d[i]; out[i] = sum; }
  return out;
}
