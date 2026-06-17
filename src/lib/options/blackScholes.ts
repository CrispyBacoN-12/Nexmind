// Black-Scholes European option pricing + greeks. Pure, no I/O.
// T in years, r/sigma as decimals (0.04 = 4%). Per-year theta, per-1.00-vol vega.

export const RISK_FREE_RATE = 0.04;

export type OptionType = "call" | "put";

/** Standard normal CDF via Abramowitz-Stegun erf approximation. */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const raw = x >= 0 ? 1 - p : p;
  return Math.min(1, Math.max(0, raw)); // A-S approximation can overshoot slightly at extremes
}

/** Standard normal PDF. */
function normPdf(x: number): number {
  return 0.3989422804014327 * Math.exp(-x * x / 2);
}

function intrinsic(type: OptionType, S: number, K: number): number {
  return type === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
}

function d1d2(S: number, K: number, T: number, r: number, sigma: number): [number, number] {
  const vsT = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / vsT;
  return [d1, d1 - vsT];
}

export function bsPrice(type: OptionType, S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return intrinsic(type, S, K);
  const [d1, d2] = d1d2(S, K, T, r, sigma);
  const disc = K * Math.exp(-r * T);
  return type === "call"
    ? S * normCdf(d1) - disc * normCdf(d2)
    : disc * normCdf(-d2) - S * normCdf(-d1);
}

export interface Greeks { delta: number; gamma: number; theta: number; vega: number }

export function greeks(type: OptionType, S: number, K: number, T: number, r: number, sigma: number): Greeks {
  if (T <= 0 || sigma <= 0) {
    const itm = intrinsic(type, S, K) > 0;
    return { delta: itm ? (type === "call" ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0 };
  }
  const [d1, d2] = d1d2(S, K, T, r, sigma);
  const sqrtT = Math.sqrt(T);
  const disc = K * Math.exp(-r * T);
  const delta = type === "call" ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = normPdf(d1) / (S * sigma * sqrtT);
  const vega = S * normPdf(d1) * sqrtT;
  const theta = type === "call"
    ? -(S * normPdf(d1) * sigma) / (2 * sqrtT) - r * disc * normCdf(d2)
    : -(S * normPdf(d1) * sigma) / (2 * sqrtT) + r * disc * normCdf(-d2);
  return { delta, gamma, theta, vega };
}
