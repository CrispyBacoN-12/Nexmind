// Pure helpers behind the /levels candle chart: the OHLCV series it plots,
// where a range button starts, and where each zone band sits on screen.
// Spec: docs/superpowers/specs/2026-11-25-levels-page-design.md

import { sma, type Candle } from "@/lib/indicators";

import { completedBars, type Zone } from "./levels";

export interface ChartBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  ma50: number | null;
  ma200: number | null;
}

const finiteBar = (b: Candle) => [b.o, b.h, b.l, b.c].every(Number.isFinite);

/** Strictly ascending, one bar per timestamp (the later copy wins). */
function clean(candles: Candle[]): Candle[] {
  const byT = new Map<number, Candle>();
  for (const b of candles) if (Number.isFinite(b.t) && finiteBar(b)) byT.set(b.t, b);
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/** Every completed bar with MA50/MA200, then the still-forming bar (no MAs). */
export function chartSeries(candles: Candle[], nowSec: number): ChartBar[] {
  const { bars, forming } = completedBars(clean(candles), nowSec);
  const closes = bars.map((b) => b.c);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const row = (b: Candle, m50: number | null, m200: number | null): ChartBar => ({
    t: b.t,
    o: b.o,
    h: b.h,
    l: b.l,
    c: b.c,
    v: Number.isFinite(b.v) && b.v > 0 ? b.v : 0,
    ma50: m50,
    ma200: m200,
  });
  const out = bars.map((b, i) => row(b, ma50[i], ma200[i]));
  if (forming) out.push(row(forming, null, null));
  return out;
}

export type RangeKey = "3M" | "6M" | "1Y" | "2Y";

const TRADING_DAYS: Record<RangeKey, number> = { "3M": 63, "6M": 126, "1Y": 252, "2Y": 504 };

/** First bar inside the last N trading days (as calendar time); never before the series. */
export function rangeStart(bars: ChartBar[], key: RangeKey): number | null {
  const last = bars.at(-1);
  if (!last) return null;
  const from = last.t - (TRADING_DAYS[key] * 86400 * 7) / 5;
  return (bars.find((b) => b.t >= from) ?? bars[0]).t;
}

export interface BandRect {
  top: number;
  bottom: number;
  color: string;
  opacity: number;
}

export function bandColor(z: Zone, price: number): string {
  if (z.high < price) return "#10b981";
  if (z.low > price) return "#f43f5e";
  return "#f59e0b";
}

/** Zone bands in pane pixels, clipped to [0, paneHeight]; off-pane or unplaceable zones are skipped. */
export function bandRects(zones: Zone[], price: number, toY: (p: number) => number | null, paneHeight: number): BandRect[] {
  const out: BandRect[] = [];
  for (const z of zones) {
    const yHigh = toY(z.high);
    const yLow = toY(z.low);
    if (yHigh == null || yLow == null) continue;
    const top = Math.min(yHigh, yLow);
    const bottom = Math.max(yHigh, yLow);
    if (bottom < 0 || top > paneHeight) continue;
    out.push({ top: Math.max(0, top), bottom: Math.min(paneHeight, bottom), color: bandColor(z, price), opacity: z.stale ? 0.08 : 0.18 });
  }
  return out;
}
