import { greeks, type OptionType } from "./blackScholes";
import type { OptionQuote } from "./chain";

const SECONDS_PER_YEAR = 365.25 * 24 * 3600;
const SECONDS_PER_DAY = 86400;

export type Rating = "strong-buy" | "buy" | "watch" | "hold" | "avoid";

export function directionToType(rating: Rating): OptionType | null {
  if (rating === "strong-buy" || rating === "buy") return "call";
  if (rating === "avoid") return "put";
  return null;
}

export function chooseExpiry(expiries: number[], nowSec: number, minDays: number): number | null {
  const ok = expiries.filter((e) => (e - nowSec) / SECONDS_PER_DAY >= minDays).sort((a, b) => a - b);
  return ok[0] ?? null;
}

export function sizeContracts(budget: number, premium: number): number {
  if (!(premium > 0)) return 0;
  return Math.floor(budget / (100 * premium));
}

export function chooseStrike(
  quotes: OptionQuote[], underlyingPrice: number, type: OptionType, targetDelta: number, r: number, nowSec: number,
): OptionQuote | null {
  let best: OptionQuote | null = null;
  let bestDiff = Infinity;
  for (const q of quotes) {
    if (q.impliedVolatility <= 0 || q.strike <= 0) continue;
    const T = (q.expiry - nowSec) / SECONDS_PER_YEAR;
    if (T <= 0) continue;
    const d = greeks(type, underlyingPrice, q.strike, T, r, q.impliedVolatility).delta;
    const diff = Math.abs(Math.abs(d) - targetDelta);
    if (diff < bestDiff) { bestDiff = diff; best = q; }
  }
  return best;
}
