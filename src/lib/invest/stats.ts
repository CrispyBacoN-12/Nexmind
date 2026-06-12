// Pure long-horizon statistics from weekly candles. No I/O — trivially testable.

import { sma, rsi, type Candle } from "@/lib/indicators";

export interface LongTermStats {
  price: number;
  cagrPct: number | null; // annualized over the whole series (needs ≥1y of data)
  change52wPct: number | null;
  sma40w: number | null; // ≈ 200-day MA on the weekly frame
  priceVsSma40wPct: number | null; // +5 = price 5% above the 40-week MA
  drawdownFromHighPct: number; // 0 = at the high, -30 = 30% below it
  rangePos52wPct: number | null; // 0 = at 52w low, 100 = at 52w high
  rsiWeekly: number | null;
}

const YEAR_S = 365.25 * 24 * 3600;

export function computeLongTermStats(candles: Candle[]): LongTermStats {
  const closes = candles.map((c) => c.c);
  const price = closes[closes.length - 1];

  const years = candles.length >= 2 ? (candles[candles.length - 1].t - candles[0].t) / YEAR_S : 0;
  const cagrPct =
    years >= 1 && closes[0] > 0 ? (Math.pow(price / closes[0], 1 / years) - 1) * 100 : null;

  const idx52w = candles.length - 53; // ~52 weekly candles back
  const change52wPct =
    idx52w >= 0 && closes[idx52w] > 0 ? ((price - closes[idx52w]) / closes[idx52w]) * 100 : null;

  const sma40wArr = sma(closes, 40);
  const sma40w = sma40wArr[sma40wArr.length - 1] ?? null;
  const priceVsSma40wPct = sma40w != null && sma40w > 0 ? ((price - sma40w) / sma40w) * 100 : null;

  const high = Math.max(...candles.map((c) => c.h));
  const drawdownFromHighPct = high > 0 ? ((price - high) / high) * 100 : 0;

  const last52 = candles.slice(-52);
  const lo52 = Math.min(...last52.map((c) => c.l));
  const hi52 = Math.max(...last52.map((c) => c.h));
  const rangePos52wPct = hi52 > lo52 ? ((price - lo52) / (hi52 - lo52)) * 100 : null;

  const rsiArr = rsi(closes, 14);
  const rsiWeekly = rsiArr[rsiArr.length - 1] ?? null;

  return { price, cagrPct, change52wPct, sma40w, priceVsSma40wPct, drawdownFromHighPct, rangePos52wPct, rsiWeekly };
}
