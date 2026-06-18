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
