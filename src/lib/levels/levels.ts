// Support / resistance zones from daily candles, for /portfolio. DESCRIPTIVE
// ONLY: where price has turned (swing pivots) or traded heavily (high-volume
// nodes). NEXMIND's research has not shown these levels predict a bounce, so
// nothing here scores, ranks by "strength" or says a level will hold.
// Spec: docs/superpowers/specs/2026-11-25-levels-design.md

import { atr, sma, type Candle } from "@/lib/indicators";

export const PIVOT_SIDE = 5;
export const HVN_BARS = 126;
export const HVN_BINS = 50;
export const HVN_MIN_RATIO = 1.5;
export const ZONE_JOIN_ATR = 0.5;
export const ZONE_MAX_ATR = 1.0;
export const RECENT_BARS = 60;
export const MIN_BARS = 60;
export const STALE_BARS = 252;
export const ATR_PERIOD = 14;
export const SUMMARY_PER_SIDE = 3;

export interface Pivot {
  kind: "high" | "low";
  price: number;
  t: number;
  index: number;
}

export interface Hvn {
  low: number;
  high: number;
  center: number;
  share: number;
}

export interface Zone {
  low: number;
  high: number;
  mid: number;
  touches: number;
  /** Epoch seconds of the newest pivot in the zone; null for an HVN-only zone. */
  lastTouch: number | null;
  lastTouchIndex: number | null;
  volumeShare: number;
  sources: ("pivot" | "hvn")[];
  stale: boolean;
}

export interface LevelsResult {
  price: number;
  priceT: number;
  forming: boolean;
  atr: number | null;
  support: Zone[];
  resistance: Zone[];
  inZone: Zone | null;
  allZones: Zone[];
  ma50: number | null;
  ma200: number | null;
  high52: number | null;
  low52: number | null;
  /** Price within 1 ATR of (or beyond) the 2-year high / low. Only then may an
   *  empty side say "near the high/low"; otherwise no zone simply qualified. */
  nearHigh: boolean;
  nearLow: boolean;
  note: "shortHistory" | null;
}

const nyParts = (sec: number) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(sec * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
};

/** The last bar is still forming when it is dated today (New York) and it is before 16:00 ET. */
export function completedBars(candles: Candle[], nowSec: number): { bars: Candle[]; forming: Candle | null } {
  const last = candles.at(-1);
  if (!last) return { bars: [], forming: null };
  const now = nyParts(nowSec);
  if (nyParts(last.t).date === now.date && now.minutes < 16 * 60) return { bars: candles.slice(0, -1), forming: last };
  return { bars: candles, forming: null };
}

/** Strict pivots: the high (low) beats `side` bars on each side; the last `side` bars cannot qualify. */
export function findPivots(bars: Candle[], side = PIVOT_SIDE): Pivot[] {
  const out: Pivot[] = [];
  for (let i = side; i < bars.length - side; i++) {
    let hi = true;
    let lo = true;
    for (let j = 1; j <= side && (hi || lo); j++) {
      if (!(bars[i].h > bars[i - j].h && bars[i].h > bars[i + j].h)) hi = false;
      if (!(bars[i].l < bars[i - j].l && bars[i].l < bars[i + j].l)) lo = false;
    }
    if (hi) out.push({ kind: "high", price: bars[i].h, t: bars[i].t, index: i });
    if (lo) out.push({ kind: "low", price: bars[i].l, t: bars[i].t, index: i });
  }
  return out;
}

/** Volume by price over the last `lookback` bars: peaks of a 3-bin smoothed histogram at ≥ minRatio × the mean bin. */
export function hvnNodes(bars: Candle[], lookback = HVN_BARS, bins = HVN_BINS, minRatio = HVN_MIN_RATIO): Hvn[] {
  const win = bars.slice(-lookback);
  if (win.length === 0) return [];
  const lo = Math.min(...win.map((b) => b.l));
  const hi = Math.max(...win.map((b) => b.h));
  const total = win.reduce((s, b) => s + (Number.isFinite(b.v) && b.v > 0 ? b.v : 0), 0);
  if (!(hi > lo) || total <= 0) return [];
  const width = (hi - lo) / bins;
  const vol = new Array<number>(bins).fill(0);
  const binOf = (p: number) => Math.min(bins - 1, Math.max(0, Math.floor((p - lo) / width)));
  for (const b of win) {
    if (!(Number.isFinite(b.v) && b.v > 0)) continue;
    const a = binOf(b.l);
    const z = binOf(b.h);
    for (let k = a; k <= z; k++) vol[k] += b.v / (z - a + 1);
  }
  // Spreading each bar evenly over its bins makes the raw histogram jagged
  // (edge bins pick up neighbours' volume), which splits one heavy area into
  // several peaks and lets tiny bumps pass a median test. So: smooth over 3
  // bins, find peaks on the smoothed curve, require ≥ minRatio × the MEAN bin,
  // and report each node as its peak bin ± 1 with the raw volume share.
  const sm = vol.map((_, k) => {
    let s = 0;
    let n = 0;
    for (let m = k - 1; m <= k + 1; m++) {
      if (m >= 0 && m < bins) {
        s += vol[m];
        n++;
      }
    }
    return s / n;
  });
  const mean = total / bins;
  const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
  const out: Hvn[] = [];
  for (let k = 0; k < bins; k++) {
    const left = k > 0 ? sm[k - 1] : -Infinity;
    if (!(sm[k] > left && !same(sm[k], left))) continue;
    let j = k;
    while (j + 1 < bins && same(sm[j + 1], sm[k])) j++; // flat top: one node
    const right = j + 1 < bins ? sm[j + 1] : -Infinity;
    if (sm[k] > right && sm[k] >= minRatio * mean) {
      const peak = Math.floor((k + j) / 2);
      const a = Math.max(0, peak - 1);
      const z = Math.min(bins - 1, peak + 1);
      let share = 0;
      for (let m = a; m <= z; m++) share += vol[m];
      const low = lo + a * width;
      const high = lo + (z + 1) * width;
      out.push({ low, high, center: (low + high) / 2, share: share / total });
    }
    k = j;
  }
  return out;
}

interface Point {
  price: number;
  lo: number;
  hi: number;
  kind: "pivot" | "hvn";
  share: number;
  t: number | null;
  index: number | null;
}

/** Merge pivots and HVN centres into zones (join ≤ 0.5·ATR from the running mean, span ≤ 1·ATR). */
export function buildZones(pivots: Pivot[], hvns: Hvn[], atrValue: number, lastIndex: number): Zone[] {
  const points: Point[] = [
    ...pivots.map((p) => ({ price: p.price, lo: p.price, hi: p.price, kind: "pivot" as const, share: 0, t: p.t, index: p.index })),
    ...hvns.map((h) => {
      const wide = h.high - h.low > ZONE_MAX_ATR * atrValue;
      return {
        price: h.center,
        lo: wide ? h.center - 0.5 * atrValue : h.low,
        hi: wide ? h.center + 0.5 * atrValue : h.high,
        kind: "hvn" as const,
        share: h.share,
        t: null,
        index: null,
      };
    }),
  ].sort((a, b) => a.price - b.price);

  const groups: Point[][] = [];
  for (const p of points) {
    const g = groups.at(-1);
    if (g) {
      const mean = g.reduce((s, x) => s + x.price, 0) / g.length;
      const span = p.price - g[0].price; // sorted ascending, so g[0] is the min
      if (Math.abs(p.price - mean) <= ZONE_JOIN_ATR * atrValue + 1e-12 && span <= ZONE_MAX_ATR * atrValue + 1e-12) {
        g.push(p);
        continue;
      }
    }
    groups.push([p]);
  }

  return groups.map((g) => {
    const pivotsIn = g.filter((x) => x.kind === "pivot");
    const newest = pivotsIn.reduce<Point | null>((a, b) => (a == null || (b.index ?? -1) > (a.index ?? -1) ? b : a), null);
    const low = Math.min(...g.map((x) => x.lo));
    const high = Math.max(...g.map((x) => x.hi));
    const lastTouchIndex = newest?.index ?? null;
    return {
      low,
      high,
      mid: (low + high) / 2,
      touches: pivotsIn.length,
      lastTouch: newest?.t ?? null,
      lastTouchIndex,
      volumeShare: g.reduce((s, x) => s + x.share, 0),
      sources: [...new Set(g.map((x) => x.kind))],
      stale: lastTouchIndex != null && lastIndex - lastTouchIndex > STALE_BARS,
    };
  });
}

const lastOf = (xs: (number | null)[]) => xs.at(-1) ?? null;

export function computeLevels(candles: Candle[], nowSec: number): LevelsResult | { note: "noData" } {
  if (candles.length === 0) return { note: "noData" };
  const { bars, forming } = completedBars(candles, nowSec);
  const priceBar = forming ?? bars.at(-1)!;
  const closes = bars.map((b) => b.c);
  const year = bars.slice(-252);
  const base: LevelsResult = {
    price: priceBar.c,
    priceT: priceBar.t,
    forming: forming != null,
    atr: null,
    support: [],
    resistance: [],
    inZone: null,
    allZones: [],
    ma50: lastOf(sma(closes, 50)),
    ma200: lastOf(sma(closes, 200)),
    high52: year.length ? Math.max(...year.map((b) => b.h)) : null,
    low52: year.length ? Math.min(...year.map((b) => b.l)) : null,
    nearHigh: false,
    nearLow: false,
    note: null,
  };
  if (bars.length < MIN_BARS) return { ...base, note: "shortHistory" };

  const atrValue = lastOf(atr(bars, ATR_PERIOD));
  if (atrValue == null || !(atrValue > 0)) return { ...base, note: "shortHistory" };
  const lastIndex = bars.length - 1;
  const zones = buildZones(findPivots(bars), hvnNodes(bars), atrValue, lastIndex).filter(
    (z) => z.touches >= 2 || z.volumeShare > 0 || (z.lastTouchIndex != null && z.lastTouchIndex >= lastIndex - RECENT_BARS),
  );

  const price = base.price;
  const high2y = Math.max(...bars.map((b) => b.h));
  const low2y = Math.min(...bars.map((b) => b.l));
  const nearHigh = high2y - price <= atrValue;
  const nearLow = price - low2y <= atrValue;
  const support = zones.filter((z) => z.high < price).sort((a, b) => b.mid - a.mid);
  const resistance = zones.filter((z) => z.low > price).sort((a, b) => a.mid - b.mid);
  const containing = zones.filter((z) => z.low <= price && z.high >= price).sort((a, b) => Math.abs(a.mid - price) - Math.abs(b.mid - price));
  return {
    ...base,
    atr: atrValue,
    nearHigh,
    nearLow,
    support: support.slice(0, SUMMARY_PER_SIDE),
    resistance: resistance.slice(0, SUMMARY_PER_SIDE),
    inZone: containing[0] ?? null,
    allZones: zones,
  };
}
