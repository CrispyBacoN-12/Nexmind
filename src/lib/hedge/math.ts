// Pure protective-put math for the /journal hedge card. Shows what a put would
// cost and change; never says one is worth buying.
// Spec: docs/superpowers/specs/2026-11-25-journal-put-hedge-design.md

import { daysBetween } from "@/lib/advisor/earningsPhrase";
import { GAP_MIN_SESSIONS } from "@/lib/advisor/gapRisk";
import type { EarningsInfo } from "@/lib/advisor/types";
import type { Candle } from "@/lib/indicators";

import type { MissingTarget, PutQuote, RowMath, StopOnly, StrikePick, StrikeTarget } from "./types";

/** Earnings closer than this pick the first expiry after the report. */
export const EARNINGS_WINDOW_DAYS = 45;
/** Otherwise: the first expiry at least this many days out. */
export const FALLBACK_EXPIRY_DAYS = 30;
/** How far past the target date to look for a listed expiry. */
export const EXPIRY_WINDOW_DAYS = 21;
/** A listed strike farther than this × price from its target is not shown for it. */
export const STRIKE_CAP_FRAC = 0.03;
/** (ask − bid) / ask above this flags the row "spread กว้าง". */
export const WIDE_SPREAD_FRAC = 0.3;
/** A quote older than this is marked "ราคาเก่า" (covers a long weekend). */
export const STALE_QUOTE_MS = 4 * 86_400_000;

const OCC = /^([A-Z][A-Z0-9.]{0,5})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

/** OCC contract symbol, e.g. AAPL261231P00240000 → AAPL, 2026-12-31, P, 240. */
export function parseOccSymbol(sym: string): { root: string; expiry: string; type: "P" | "C"; strike: number } | null {
  const m = OCC.exec(sym);
  if (!m) return null;
  const [, root, yy, mm, dd, type, strike] = m;
  return { root, expiry: `20${yy}-${mm}-${dd}`, type: type as "P" | "C", strike: Number(strike) / 1000 };
}

/** One contract covers 100 shares; any holding needs at least one. */
export function contractsFor(shares: number): number {
  return Math.max(1, Math.ceil(shares / 100));
}

/** Shares covered ÷ shares held. 1 = exact; 5 = covering five times what is held. */
export function overHedge(shares: number, contracts: number): number {
  return (contracts * 100) / shares;
}

/** Calendar-day arithmetic on YYYY-MM-DD, in UTC so no timezone shifts the day. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The earliest expiry date to accept. An expiry ON the earnings day is not
 * enough (an after-close report gaps the next morning), so it is the day after.
 */
export function chooseExpiryTarget(
  todayNY: string,
  earnings: EarningsInfo,
): { gte: string; reason: "afterEarnings" | "about30d" } {
  const days = earnings.date ? daysBetween(todayNY, earnings.date) : null;
  if (earnings.date && days != null && days >= 1 && days <= EARNINGS_WINDOW_DAYS) {
    return { gte: addDays(earnings.date, 1), reason: "afterEarnings" };
  }
  return { gte: addDays(todayNY, FALLBACK_EXPIRY_DAYS), reason: "about30d" };
}

export function pickExpiry(quotes: PutQuote[], gte: string): string | null {
  const ok = quotes.map((q) => q.expiry).filter((e) => e >= gte).sort();
  return ok[0] ?? null;
}

const TARGET_ORDER: StrikeTarget[] = ["stop", "minus5", "atm"];

/** Nearest listed strike per target (ties → the lower strike), capped at STRIKE_CAP_FRAC × price. */
export function pickStrikes(
  strikes: number[],
  price: number,
  stop: number,
): { picks: StrikePick[]; missing: MissingTarget[] } {
  const targetPrice: Record<StrikeTarget, number> = { stop, minus5: price * 0.95, atm: price };
  const sorted = [...new Set(strikes)].sort((a, b) => a - b);
  const byStrike = new Map<number, StrikeTarget[]>();
  const missing: MissingTarget[] = [];

  for (const target of TARGET_ORDER) {
    if (target === "stop" && stop >= price) {
      missing.push({ target, reason: "priceBelowStop" });
      continue;
    }
    const want = targetPrice[target];
    let best: number | null = null;
    for (const k of sorted) {
      if (best == null || Math.abs(k - want) < Math.abs(best - want)) best = k;
    }
    if (best == null || Math.abs(best - want) > STRIKE_CAP_FRAC * price) {
      missing.push({ target, reason: "noStrikeNear" });
      continue;
    }
    byStrike.set(best, [...(byStrike.get(best) ?? []), target]);
  }

  const picks = [...byStrike.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([strike, targets]) => ({ strike, targets }));
  return { picks, missing };
}

export function rowMath(a: {
  shares: number;
  entry: number;
  price: number;
  strike: number;
  contracts: number;
  bid: number | null;
  ask: number | null;
}): RowMath {
  const distancePct = (a.price - a.strike) / a.price;
  const hasAsk = a.ask != null && a.ask > 0;
  const wideSpread = hasAsk && (a.bid == null || a.bid <= 0 || (a.ask! - a.bid) / a.ask! > WIDE_SPREAD_FRAC);
  if (!hasAsk) {
    return { premiumTotal: null, premiumPct: null, breakeven: null, maxLossWithPut: null, distancePct, wideSpread };
  }
  const premiumTotal = a.ask! * 100 * a.contracts;
  return {
    premiumTotal,
    premiumPct: premiumTotal / (a.price * a.shares),
    breakeven: a.entry + premiumTotal / a.shares,
    // The loss is largest with the price exactly at the strike: below it the
    // put pays on 100 × contracts shares, at least as many as are held.
    maxLossWithPut: (a.entry - a.strike) * a.shares + premiumTotal,
    distancePct,
    wideSpread,
  };
}

/** Largest (prevClose − open) / prevClose over the series; null under GAP_MIN_SESSIONS measurable sessions. */
export function worstGapDownPct(candles: Candle[] | null): number | null {
  if (!candles) return null;
  let sessions = 0;
  let worst = 0;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].c;
    const open = candles[i].o;
    if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(open) || open <= 0) continue;
    sessions += 1;
    worst = Math.max(worst, (prev - open) / prev);
  }
  return sessions >= GAP_MIN_SESSIONS ? worst : null;
}

export function stopOnly(a: { entry: number; stop: number; shares: number; price: number; gapPct: number | null }): StopOnly {
  if (a.stop >= a.entry) return { atStop: null, gapPct: a.gapPct, gapLoss: null, note: "stopNotBelowEntry" };
  const atStop = (a.entry - a.stop) * a.shares;
  if (a.gapPct == null) return { atStop, gapPct: null, gapLoss: null, note: "notEnoughHistory" };
  // A gap that opens above the stop does not reach it: the stop is still what fills,
  // so the gap case is never shown as cheaper than the stop.
  const fill = Math.min(a.stop, a.price * (1 - a.gapPct));
  return { atStop, gapPct: a.gapPct, gapLoss: (a.entry - fill) * a.shares, note: null };
}

export function isQuoteStale(quotedAt: string | null, nowMs: number): boolean {
  if (!quotedAt) return true;
  const t = Date.parse(quotedAt);
  return !Number.isFinite(t) || nowMs - t > STALE_QUOTE_MS;
}
