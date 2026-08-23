// Analyst context — the facts HAWK and SAGE actually get to see.
//
// The scanner computes far more than it used to forward. Bollinger, Stochastic,
// VWAP deviation, Lorentzian and 60 bars of history all reached ScanResult and
// stopped there, while the prompt carried eight numbers — and the identical
// text — to all three personas. The "structure" analyst was being asked to
// reason from swing levels it had never been shown.
//
// This module assembles the numbers once. Every persona gets the whole sheet
// (blinding one of them is how you get confident nonsense) plus a lens saying
// which part of it is their job. Everything here is pure: the two facts a scan
// cannot produce — the higher timeframe and the fundamentals — are fetched by
// the caller and passed in, so this stays unit-testable with no network, no DB.

import { sma, rsi, cumulativeDelta, detectLiquiditySweep, volumeProfile, type Candle } from "@/lib/indicators";
import { findRecentUpLeg } from "@/lib/swings";
import type { ScanResult } from "./scanner";

export type Persona = "trend" | "structure" | "counter";

/** The parts of the context a ScanResult cannot supply. Both are best-effort:
 *  a failed fetch costs the analysts a paragraph, not the trade. */
export interface AnalystExtras {
  /** Daily bars for the higher-timeframe read; null when the fetch failed. */
  higherTf?: Candle[] | null;
  /** Pre-rendered `fundamentalsLine()`; null for non-equities or on failure. */
  fundamentals?: string | null;
  newsDigest?: string | null;
}

/** Named blocks rather than one string, so SAGE and the personas can be given
 *  different subsets later without re-deriving any of the numbers. */
export interface AnalystContext {
  head: string;
  bars: string;
  momentum: string;
  volatility: string;
  structure: string;
  volume: string;
  higherTf: string | null;
  fundamentals: string | null;
  news: string | null;
}

/** How many recent bars to spell out. Enough to see the shape of the last two
 *  sessions on 1h without turning a 3-call vote into a 3-call essay. */
const BARS = 20;

export function buildAnalystContext(scan: ScanResult, extras: AnalystExtras = {}): AnalystContext {
  const s = scan.snapshot;
  const d = digits(scan.price);
  const candles = scan.candles ?? [];

  return {
    head: [
      `${scan.symbol} · timeframe ${scan.timeframe} · last ${scan.price.toFixed(d)}`,
      `Scanner setup: ${scan.side ?? "none"} — ${scan.note}`,
    ].join("\n"),
    bars: barsBlock(candles, d),
    momentum: [
      `RSI ${num(s.rsi, 1)} · Stochastic %K ${num(s.stochK, 1)} / %D ${num(s.stochD, 1)} · MACD hist ${signed(s.macdHist, 3)}`,
      `ADX ${num(s.adx, 1)} (+DI ${num(s.plusDI, 1)} / -DI ${num(s.minusDI, 1)})`,
      `SMA20 ${num(s.sma20, d)} vs SMA50 ${num(s.sma50, d)} — ${maState(s.sma20, s.sma50)}; price is ${relTo(scan.price, s.sma20)} SMA20 and ${relTo(scan.price, s.sma50)} SMA50`,
      lcLine(s.lc),
    ]
      .filter(Boolean)
      .join("\n"),
    volatility: [
      `ATR ${num(s.atr, d)}${s.atr != null && scan.price ? ` (${((s.atr / scan.price) * 100).toFixed(2)}% of price)` : ""}`,
      `Bollinger %B ${num(s.bbPercentB, 2)} (0 = lower band, 1 = upper band) · bandwidth ${pct(s.bbWidth, 2, false)}`,
      `VWAP deviation ${pct(s.vwapDevPct, 2)} (session-anchored)`,
    ].join("\n"),
    structure: structureBlock(scan, candles, d),
    volume: volumeBlock(candles),
    higherTf: higherTfBlock(extras.higherTf ?? null, scan.price),
    fundamentals: extras.fundamentals ?? null,
    news: extras.newsDigest?.trim() ? extras.newsDigest.trim() : null,
  };
}

/** The full facts sheet, in a fixed order so the three persona calls share a
 *  stable prefix. */
export function renderContext(ctx: AnalystContext): string {
  return [
    ctx.head,
    `\nRECENT BARS\n${ctx.bars}`,
    `\nMOMENTUM\n${ctx.momentum}`,
    `\nVOLATILITY & EXTENSION\n${ctx.volatility}`,
    `\nSTRUCTURE\n${ctx.structure}`,
    `\nVOLUME\n${ctx.volume}`,
    ctx.higherTf ? `\nHIGHER TIMEFRAME\n${ctx.higherTf}` : "",
    ctx.fundamentals ? `\n${ctx.fundamentals}` : "",
    ctx.news ? `\nINTEL\n${ctx.news}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** What this persona is being paid to look at. The three analysts see the same
 *  facts on purpose — the disagreement has to come from how they read them, not
 *  from one of them being kept in the dark. */
export function personaLens(persona: Persona): string {
  return LENSES[persona];
}

const LENSES: Record<Persona, string> = {
  trend:
    "YOUR LENS — trend. Weigh MA alignment, ADX and +DI/-DI, MACD, and the higher-timeframe read above all else. " +
    "A setup that fights the higher timeframe is a skip however clean the entry looks. Say which reading decided it.",
  structure:
    "YOUR LENS — market structure. Weigh the swing leg and where price sits inside it, the volume-profile POC and value area, " +
    "VWAP, and any liquidity sweep. Ask where the resting stops are and whether this is a level worth defending. " +
    "Ignore momentum hype. Say which level decided it.",
  counter:
    "YOUR LENS — mean reversion. Weigh RSI and Stochastic extremes, Bollinger %B and bandwidth, and how far price is stretched " +
    "from VWAP and SMA20. Call it a fade only on real exhaustion; a trend that is merely strong is not overextended. " +
    "Say which extreme decided it.",
};

// ---- blocks ----

function barsBlock(candles: Candle[], d: number): string {
  if (candles.length === 0) return "no candle history available";
  const tail = candles.slice(-BARS);
  const lines = tail.map(
    (c, i) =>
      `${stamp(c.t)}  O ${c.o.toFixed(d)}  H ${c.h.toFixed(d)}  L ${c.l.toFixed(d)}  C ${c.c.toFixed(d)}  V ${vol(c.v)}` +
      (i === tail.length - 1 && isForming(candles) ? "  [live quote, bar not closed]" : ""),
  );
  return [`last ${tail.length} bars, oldest first:`, ...lines].join("\n");
}

/** Yahoo appends the current quote as a zero-volume bar. Read naively it looks
 *  like an open/high/low/close of the same price on no volume — i.e. a market
 *  that stopped trading — so it has to be called out wherever it is used. */
function isForming(candles: Candle[]): boolean {
  return candles.length > 1 && candles[candles.length - 1].v === 0;
}

function structureBlock(scan: ScanResult, candles: Candle[], d: number): string {
  const out: string[] = [];

  // The plain range comes first because findRecentUpLeg only ever returns an
  // up-leg: during a pullback the most recent pivot is a low, so it returns
  // null and the structure analyst would otherwise be handed no levels at all.
  const win = candles.slice(-40);
  if (win.length >= 5) {
    let hi = win[0];
    let lo = win[0];
    for (const c of win) {
      if (c.h > hi.h) hi = c;
      if (c.l < lo.l) lo = c;
    }
    const span = hi.h - lo.l;
    const pos = span > 0 ? ((scan.price - lo.l) / span) * 100 : null;
    out.push(
      `Visible range (last ${win.length} bars): high ${hi.h.toFixed(d)} (${stamp(hi.t)}), low ${lo.l.toFixed(d)} (${stamp(lo.t)})` +
        (pos == null ? "" : `; price sits at ${pos.toFixed(0)}% of that range`),
    );
  }

  const leg = findRecentUpLeg(candles, 80, 3);
  if (leg) {
    const span = leg.high - leg.low;
    const retrace = span > 0 ? ((leg.high - scan.price) / span) * 100 : null;
    out.push(
      `Most recent confirmed up-leg: ${leg.low.toFixed(d)} (${stamp(leg.lowT)}) → ${leg.high.toFixed(d)} (${stamp(leg.highT)})` +
        (retrace == null ? "" : `; price ${scan.price.toFixed(d)} has retraced ${retrace.toFixed(0)}% of it`),
    );
  } else {
    out.push("No pivot-confirmed up-leg (swing low → swing high) in the visible history — the last confirmed pivot is a high.");
  }

  const vp = candles.length ? volumeProfile(candles, candles.length - 1, Math.min(50, candles.length)) : null;
  if (vp) {
    const where =
      scan.price > vp.vah ? "above the value area" : scan.price < vp.val ? "below the value area" : "inside the value area";
    out.push(`Volume profile: POC ${vp.poc.toFixed(d)}, value area ${vp.val.toFixed(d)}–${vp.vah.toFixed(d)}; price is ${where}.`);
  }

  // Only the last few bars matter — a sweep from two days ago is history, not a
  // reason to enter now.
  const sweeps: string[] = [];
  for (let i = Math.max(0, candles.length - 5); i < candles.length; i++) {
    const sw = detectLiquiditySweep(candles, i, 20);
    if (sw) sweeps.push(`${stamp(candles[i].t)} swept ${sw.sweptLevel.toFixed(d)} and closed back inside → ${sw.side} bias`);
  }
  out.push(sweeps.length ? `Liquidity sweeps in the last 5 bars: ${sweeps.join("; ")}.` : "No liquidity sweep in the last 5 bars.");

  return out.join("\n");
}

function volumeBlock(candles: Candle[]): string {
  if (candles.length < 2) return "no volume history available";
  // Compare the last *closed* bar: measuring the live zero-volume quote against
  // the 20-bar average reports "0.00× — thin" on a perfectly normal session.
  const forming = isForming(candles);
  const iLast = forming ? candles.length - 2 : candles.length - 1;
  if (iLast < 1) return "no volume history available";
  const lastV = candles[iLast].v;
  const window = candles.slice(Math.max(0, iLast - 20), iLast);
  const avg = window.length ? window.reduce((a, c) => a + c.v, 0) / window.length : 0;
  const ratio = avg > 0 ? lastV / avg : null;
  const lines = [
    `${forming ? "Last closed bar" : "Last bar"} volume ${vol(lastV)} vs ${window.length}-bar average ${vol(avg)}` +
      (ratio == null ? "" : ` (${ratio.toFixed(2)}× — ${ratio >= 1.5 ? "heavy" : ratio <= 0.6 ? "thin" : "normal"})`),
  ];

  // CVD here is a close-position proxy, not tape data — worth saying so in the
  // prompt, otherwise it reads as order-flow truth.
  const cvd = cumulativeDelta(candles);
  const span = Math.min(20, cvd.length - 1);
  if (span > 0) {
    const change = cvd[cvd.length - 1] - cvd[cvd.length - 1 - span];
    lines.push(
      `Cumulative volume delta over the last ${span} bars: ${change >= 0 ? "+" : "-"}${vol(Math.abs(change))} ` +
        `(${change >= 0 ? "buyers" : "sellers"} in control; estimated from close position within range, not tape data).`,
    );
  }
  return lines.join("\n");
}

function higherTfBlock(candles: Candle[] | null, price: number): string | null {
  if (!candles || candles.length < 50) return null;
  const closes = candles.map((c) => c.c);
  const d = digits(price);
  const h20 = lastOf(sma(closes, 20));
  const h50 = lastOf(sma(closes, 50));
  const hRsi = lastOf(rsi(closes, 14));
  const recent = closes.slice(-5).map((c) => c.toFixed(d)).join(" → ");
  return [
    `Daily: SMA20 ${num(h20, d)} vs SMA50 ${num(h50, d)} — ${maState(h20, h50)}; price is ${relTo(price, h50)} the daily SMA50. RSI ${num(hRsi, 1)}.`,
    `Last 5 daily closes: ${recent}.`,
  ].join("\n");
}

// ---- formatting ----

/** Decimal places that suit the instrument: two for equities, more for FX. */
function digits(price: number): number {
  if (!Number.isFinite(price) || price >= 100) return 2;
  if (price >= 1) return 3;
  return 5;
}

const num = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "n/a" : v.toFixed(d));
const signed = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;

function pct(v: number | null | undefined, d = 2, withSign = true): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  const p = v * 100;
  return `${withSign && p >= 0 ? "+" : ""}${p.toFixed(d)}%`;
}

function vol(v: number): string {
  if (!Number.isFinite(v)) return "n/a";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return v.toFixed(0);
}

/** Candle timestamps are seconds from Yahoo but milliseconds from some adapters
 *  — normalise rather than print a 1970 date into an analyst's prompt. */
function stamp(t: number): string {
  if (!Number.isFinite(t) || t <= 0) return "?";
  const ms = t > 1e11 ? t : t * 1000;
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z";
}

function maState(fast: number | null | undefined, slow: number | null | undefined): string {
  if (fast == null || slow == null) return "alignment unknown";
  if (fast === slow) return "flat";
  const gap = slow !== 0 ? Math.abs((fast - slow) / slow) * 100 : 0;
  return `${fast > slow ? "stacked up" : "stacked down"} by ${gap.toFixed(2)}%`;
}

function relTo(price: number, level: number | null | undefined): string {
  if (level == null || !Number.isFinite(level) || level === 0) return "n/a vs";
  const gap = ((price - level) / level) * 100;
  return `${gap >= 0 ? "above" : "below"} (${gap >= 0 ? "+" : ""}${gap.toFixed(2)}%)`;
}

function lcLine(lc: ScanResult["snapshot"]["lc"]): string {
  if (!lc) return "";
  const dir = lc.signal === 1 ? "long" : lc.signal === -1 ? "short" : "neutral";
  const kernel = lc.kernelBullish ? "bullish" : lc.kernelBearish ? "bearish" : "flat";
  return `Lorentzian classifier: signal ${dir}, prediction ${lc.prediction > 0 ? "+" : ""}${lc.prediction}, kernel ${kernel}`;
}

function lastOf(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
  return null;
}
