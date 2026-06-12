// Lorentzian Classification — faithful TypeScript port of the core of
// "Machine Learning: Lorentzian Classification" by ©jdehorty (TradingView, MPL-2.0),
// including the MLExtensions feature normalizations, volatility/regime filters and
// the Nadaraya-Watson kernel filters (rational quadratic + gaussian).
//
// Faithfulness notes (quirks preserved on purpose — this must match the original):
// - Training labels are y[t] = sign(close[t-4] vs close[t]) with the original's
//   inverted mapping (a 4-bar RISE labels "short"). Do not "fix" this.
// - The neighbor set (predictions/distances) PERSISTS across bars (Pine `var`),
//   capped at neighborsCount via shift, with the 75th-percentile distance gate.
// - Neighbors are drawn chronologically from the OLDEST maxBarsBack bars, skipping
//   every 4th index (i%4 == 0).
// - Kernel regression uses a ~(startAtBar+2)-bar window exactly like KernelFunctions v2.
// Warmup seeding of EMAs/RMAs differs slightly from Pine's na-handling; values
// converge after a few dozen bars, which both the scanner and backtester discard.

import type { Candle } from "@/lib/indicators";

export interface LCSettings {
  neighborsCount: number; // 8
  maxBarsBack: number; // 2000
  useVolatilityFilter: boolean; // true
  useRegimeFilter: boolean; // true
  useAdxFilter: boolean; // false
  regimeThreshold: number; // -0.1
  adxThreshold: number; // 20
  kernelLookback: number; // h = 8
  kernelRelativeWeight: number; // r = 8
  kernelRegressionLevel: number; // x = 25
  kernelLag: number; // 2
}

export const LC_DEFAULTS: LCSettings = {
  neighborsCount: 8,
  maxBarsBack: 2000,
  useVolatilityFilter: true,
  useRegimeFilter: true,
  useAdxFilter: false,
  regimeThreshold: -0.1,
  adxThreshold: 20,
  kernelLookback: 8,
  kernelRelativeWeight: 8,
  kernelRegressionLevel: 25,
  kernelLag: 2,
};

export interface LCSeries {
  prediction: number[]; // sum of neighbor labels per bar (-k..+k)
  signal: (1 | -1 | 0)[]; // filtered, persisted signal (1 long, -1 short)
  kernelBullish: boolean[]; // rational-quadratic estimate rising on this bar
  kernelBearish: boolean[];
  filterAll: boolean[];
}

// ---------- Pine-style series helpers (full-length number[] outputs) ----------

const emaArr = (src: number[], n: number): number[] => {
  const a = 2 / (n + 1);
  const out = new Array<number>(src.length);
  out[0] = src[0] ?? 0;
  for (let i = 1; i < src.length; i++) out[i] = a * src[i] + (1 - a) * out[i - 1];
  return out;
};

const rmaArr = (src: number[], n: number): number[] => {
  const a = 1 / n;
  const out = new Array<number>(src.length);
  out[0] = src[0] ?? 0;
  for (let i = 1; i < src.length; i++) out[i] = a * src[i] + (1 - a) * out[i - 1];
  return out;
};

const smaArr = (src: number[], n: number): number[] => {
  const out = new Array<number>(src.length);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= n) sum -= src[i - n];
    out[i] = sum / Math.min(i + 1, n);
  }
  return out;
};

const rsiArr = (close: number[], n: number): number[] => {
  const gains = new Array<number>(close.length).fill(0);
  const losses = new Array<number>(close.length).fill(0);
  for (let i = 1; i < close.length; i++) {
    const ch = close[i] - close[i - 1];
    gains[i] = Math.max(ch, 0);
    losses[i] = Math.max(-ch, 0);
  }
  const ag = rmaArr(gains, n);
  const al = rmaArr(losses, n);
  return close.map((_, i) => (al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i])));
};

const cciArr = (src: number[], n: number): number[] => {
  const ma = smaArr(src, n);
  const out = new Array<number>(src.length);
  for (let i = 0; i < src.length; i++) {
    const from = Math.max(0, i - n + 1);
    let md = 0;
    for (let j = from; j <= i; j++) md += Math.abs(src[j] - ma[i]);
    md /= i - from + 1;
    out[i] = md === 0 ? 0 : (src[i] - ma[i]) / (0.015 * md);
  }
  return out;
};

/** MLExtensions.normalize — running historic min/max scaled to [min,max]. */
const normalizeArr = (src: number[], lo = 0, hi = 1): number[] => {
  let hMin = Infinity;
  let hMax = -Infinity;
  return src.map((v) => {
    if (Number.isFinite(v)) {
      hMin = Math.min(hMin, v);
      hMax = Math.max(hMax, v);
    }
    return lo + ((hi - lo) * (v - hMin)) / Math.max(hMax - hMin, 1e-10);
  });
};

/** MLExtensions.rescale from a fixed old range. */
const rescaleArr = (src: number[], oldLo: number, oldHi: number, lo = 0, hi = 1): number[] =>
  src.map((v) => lo + ((hi - lo) * (v - oldLo)) / Math.max(oldHi - oldLo, 1e-10));

// ---------- MLExtensions feature engineering ----------

const nRsi = (close: number[], n1: number, n2: number): number[] =>
  rescaleArr(emaArr(rsiArr(close, n1), n2), 0, 100);

const nWt = (hlc3: number[], n1 = 10, n2 = 11): number[] => {
  const e1 = emaArr(hlc3, n1);
  const e2 = emaArr(hlc3.map((v, i) => Math.abs(v - e1[i])), n1);
  const ci = hlc3.map((v, i) => (e2[i] === 0 ? 0 : (v - e1[i]) / (0.015 * e2[i])));
  const wt1 = emaArr(ci, n2);
  const wt2 = smaArr(wt1, 4);
  return normalizeArr(wt1.map((v, i) => v - wt2[i]));
};

const nCci = (close: number[], n1: number, n2: number): number[] =>
  normalizeArr(emaArr(cciArr(close, n1), n2));

const nAdx = (high: number[], low: number[], close: number[], n: number): number[] => {
  const len = close.length;
  const dx = new Array<number>(len).fill(0);
  let trS = 0;
  let plusS = 0;
  let minusS = 0;
  for (let i = 0; i < len; i++) {
    const prevC = i > 0 ? close[i - 1] : close[i];
    const prevH = i > 0 ? high[i - 1] : high[i];
    const prevL = i > 0 ? low[i - 1] : low[i];
    const tr = Math.max(high[i] - low[i], Math.abs(high[i] - prevC), Math.abs(low[i] - prevC));
    const up = high[i] - prevH;
    const dn = prevL - low[i];
    const plusDM = up > dn ? Math.max(up, 0) : 0;
    const minusDM = dn > up ? Math.max(dn, 0) : 0;
    trS = trS - trS / n + tr;
    plusS = plusS - plusS / n + plusDM;
    minusS = minusS - minusS / n + minusDM;
    const diP = trS === 0 ? 0 : (plusS / trS) * 100;
    const diN = trS === 0 ? 0 : (minusS / trS) * 100;
    dx[i] = diP + diN === 0 ? 0 : (Math.abs(diP - diN) / (diP + diN)) * 100;
  }
  return rescaleArr(rmaArr(dx, n), 0, 100);
};

// ---------- MLExtensions filters ----------

const volatilityFilterArr = (candles: Candle[], use: boolean): boolean[] => {
  const tr = candles.map((c, i) => {
    const prevC = i > 0 ? candles[i - 1].c : c.c;
    return Math.max(c.h - c.l, Math.abs(c.h - prevC), Math.abs(c.l - prevC));
  });
  const recent = rmaArr(tr, 1);
  const historical = rmaArr(tr, 10);
  return tr.map((_, i) => (use ? recent[i] > historical[i] : true));
};

const regimeFilterArr = (candles: Candle[], threshold: number, use: boolean): boolean[] => {
  const len = candles.length;
  const src = candles.map((c) => (c.o + c.h + c.l + c.c) / 4); // ohlc4
  let v1 = 0;
  let v2 = 0;
  let klmf = 0;
  const absSlope = new Array<number>(len).fill(0);
  for (let i = 0; i < len; i++) {
    const prevSrc = i > 0 ? src[i - 1] : src[i];
    const prevKlmf = klmf;
    v1 = 0.2 * (src[i] - prevSrc) + 0.8 * v1;
    v2 = 0.1 * (candles[i].h - candles[i].l) + 0.8 * v2;
    const omega = v2 === 0 ? 0 : Math.abs(v1 / v2);
    const alpha = (-(omega ** 2) + Math.sqrt(omega ** 4 + 16 * omega ** 2)) / 8;
    klmf = alpha * src[i] + (1 - alpha) * prevKlmf;
    absSlope[i] = Math.abs(klmf - prevKlmf);
  }
  const emaSlope = emaArr(absSlope, 200);
  return absSlope.map((s, i) => {
    if (!use) return true;
    if (emaSlope[i] === 0) return false;
    return (s - emaSlope[i]) / emaSlope[i] >= threshold;
  });
};

// ---------- KernelFunctions v2 (window = startAtBar + 2 bars) ----------

const rationalQuadraticArr = (src: number[], lookback: number, relWeight: number, startAtBar: number): number[] => {
  const window = startAtBar + 2;
  const weights: number[] = [];
  for (let k = 0; k < window; k++) {
    weights.push(Math.pow(1 + (k * k) / (lookback * lookback * 2 * relWeight), -relWeight));
  }
  return src.map((_, i) => {
    let cw = 0;
    let w = 0;
    for (let k = 0; k < window && i - k >= 0; k++) {
      cw += src[i - k] * weights[k];
      w += weights[k];
    }
    return w === 0 ? src[i] : cw / w;
  });
};

// ---------- main: per-bar Lorentzian classification over a candle series ----------

export function lorentzianSeries(candles: Candle[], settings: LCSettings = LC_DEFAULTS): LCSeries {
  const n = candles.length;
  const close = candles.map((c) => c.c);
  const high = candles.map((c) => c.h);
  const low = candles.map((c) => c.l);
  const hlc3 = candles.map((c) => (c.h + c.l + c.c) / 3);

  // Default 5 features: RSI(14,1), WT(10,11), CCI(20,1), ADX(20), RSI(9,1)
  const features = [
    nRsi(close, 14, 1),
    nWt(hlc3, 10, 11),
    nCci(close, 20, 1),
    nAdx(high, low, close, 20),
    nRsi(close, 9, 1),
  ];

  // Training labels — original's mapping preserved: a 4-bar RISE labels short(-1).
  const y = new Array<number>(n).fill(0);
  for (let t = 4; t < n; t++) y[t] = close[t - 4] < close[t] ? -1 : close[t - 4] > close[t] ? 1 : 0;

  const vol = volatilityFilterArr(candles, settings.useVolatilityFilter);
  const regime = regimeFilterArr(candles, settings.regimeThreshold, settings.useRegimeFilter);
  const adxOk = settings.useAdxFilter
    ? rescaleArr(nAdx(high, low, close, 14), 0, 1, 0, 100).map((v) => v > settings.adxThreshold)
    : new Array<boolean>(n).fill(true);

  const yhat1 = rationalQuadraticArr(close, settings.kernelLookback, settings.kernelRelativeWeight, settings.kernelRegressionLevel);

  const prediction = new Array<number>(n).fill(0);
  const signal = new Array<1 | -1 | 0>(n).fill(0);
  const kernelBullish = new Array<boolean>(n).fill(false);
  const kernelBearish = new Array<boolean>(n).fill(false);
  const filterAll = new Array<boolean>(n).fill(false);

  // Pine `var` arrays — persist across bars.
  const distances: number[] = [];
  const predictions: number[] = [];
  const maxBarsBackIndex = n - 1 >= settings.maxBarsBack ? n - 1 - settings.maxBarsBack : 0;
  const k75 = Math.round((settings.neighborsCount * 3) / 4);

  for (let t = 0; t < n; t++) {
    if (t >= maxBarsBackIndex) {
      let lastDistance = -1.0;
      const sizeLoop = Math.min(settings.maxBarsBack - 1, t);
      for (let i = 0; i <= sizeLoop; i++) {
        let d = 0;
        for (const f of features) d += Math.log(1 + Math.abs(f[t] - f[i]));
        if (d >= lastDistance && i % 4 !== 0) {
          lastDistance = d;
          distances.push(d);
          predictions.push(Math.round(y[i]));
          if (predictions.length > settings.neighborsCount) {
            lastDistance = distances[k75];
            distances.shift();
            predictions.shift();
          }
        }
      }
      prediction[t] = predictions.reduce((a, b) => a + b, 0);
    }

    filterAll[t] = vol[t] && regime[t] && adxOk[t];
    signal[t] =
      prediction[t] > 0 && filterAll[t] ? 1 : prediction[t] < 0 && filterAll[t] ? -1 : t > 0 ? signal[t - 1] : 0;

    if (t > 0) {
      kernelBullish[t] = yhat1[t - 1] < yhat1[t];
      kernelBearish[t] = yhat1[t - 1] > yhat1[t];
    }
  }

  return { prediction, signal, kernelBullish, kernelBearish, filterAll };
}

/** Convenience: the last bar's LC state, for the live scanner snapshot. */
export interface LCState {
  prediction: number;
  signal: 1 | -1 | 0;
  kernelBullish: boolean;
  kernelBearish: boolean;
}

export function lorentzianLast(candles: Candle[], settings: LCSettings = LC_DEFAULTS): LCState | null {
  if (candles.length < 80) return null; // not enough history to be meaningful
  const s = lorentzianSeries(candles, settings);
  const i = candles.length - 1;
  return { prediction: s.prediction[i], signal: s.signal[i], kernelBullish: s.kernelBullish[i], kernelBearish: s.kernelBearish[i] };
}
