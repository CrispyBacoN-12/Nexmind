import { fetchMt5CandleRange } from "@/lib/mt5";

export interface RawBar {
  brokerTime: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  spreadAtClose?: number;
}

export interface GoldBar {
  utcTime: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  spreadAtClose?: number;
}

export interface BrokerOffsetSchedule {
  offsetMinutesAt(brokerTimeSec: number): number;
}

export interface MarketClosureWindow {
  isClosed(brokerTimeSec: number): boolean;
}

export interface Gap {
  fromExclusive: number;
  toExclusive: number;
  isWeekend: boolean;
}

// `brokerTimeSec` is read as a naive local timestamp throughout this file:
// the numeric value is interpreted with Date's UTC accessors as if it WERE
// UTC, matching how MT5 hands back broker-local wall-clock reads as epoch
// seconds. Both the DST schedule below and the weekly closure window use the
// same interpretation, so they stay internally consistent even though
// neither one is truly UTC. NEEDS CONFIRMATION against the real broker
// (see src/lib/gold/README.md).
function lastSundayOfMonthUtc(year: number, month0: number): number {
  const lastDayOfMonth = 0; // day 0 of month0+1 = last day of month0
  const dow = new Date(Date.UTC(year, month0 + 1, lastDayOfMonth)).getUTCDay();
  return Date.UTC(year, month0 + 1, lastDayOfMonth - dow) / 1000;
}

export const DEFAULT_EET_EEST_SCHEDULE: BrokerOffsetSchedule = {
  offsetMinutesAt(brokerTimeSec: number): number {
    const year = new Date(brokerTimeSec * 1000).getUTCFullYear();
    const dstStart = lastSundayOfMonthUtc(year, 2) + 3600; // last Sunday of March, 01:00
    const dstEnd = lastSundayOfMonthUtc(year, 9) + 3600; // last Sunday of October, 01:00
    const isDst = brokerTimeSec >= dstStart && brokerTimeSec < dstEnd;
    return isDst ? 180 : 120;
  },
};

export const DEFAULT_WEEKLY_CLOSURE: MarketClosureWindow = {
  isClosed(brokerTimeSec: number): boolean {
    const d = new Date(brokerTimeSec * 1000);
    const dow = d.getUTCDay();
    const hour = d.getUTCHours();
    if (dow === 6) return true;
    if (dow === 0 && hour < 22) return true;
    if (dow === 5 && hour >= 21) return true;
    return false;
  },
};

export function toUtcBar(bar: RawBar, schedule: BrokerOffsetSchedule = DEFAULT_EET_EEST_SCHEDULE): GoldBar {
  const offsetMinutes = schedule.offsetMinutesAt(bar.brokerTime);
  return {
    utcTime: bar.brokerTime - offsetMinutes * 60,
    o: bar.o,
    h: bar.h,
    l: bar.l,
    c: bar.c,
    v: bar.v,
    spreadAtClose: bar.spreadAtClose,
  };
}

export function normalizeToUtc(bars: RawBar[], schedule?: BrokerOffsetSchedule): GoldBar[] {
  return bars.map((bar) => toUtcBar(bar, schedule));
}

export function detectGaps(
  bars: RawBar[],
  expectedIntervalSeconds: number,
  nowBrokerTime: number,
  closure: MarketClosureWindow = DEFAULT_WEEKLY_CLOSURE,
): Gap[] {
  const sorted = [...bars].sort((a, b) => a.brokerTime - b.brokerTime);
  const gaps: Gap[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].brokerTime;
    const next = sorted[i].brokerTime;
    if (next - prev > expectedIntervalSeconds) {
      gaps.push({ fromExclusive: prev, toExclusive: next, isWeekend: isWeekendGap(prev, next, expectedIntervalSeconds, closure) });
    }
  }
  void nowBrokerTime; // reserved for a future trailing-gap check once storage exists; unused for now
  return gaps;
}

function isWeekendGap(
  fromExclusive: number,
  toExclusive: number,
  stepSeconds: number,
  closure: MarketClosureWindow,
): boolean {
  for (let t = fromExclusive + stepSeconds; t < toExclusive; t += stepSeconds) {
    if (!closure.isClosed(t)) return false;
  }
  return true;
}

export async function backfillGaps(symbol: string, timeframe: string, gaps: Gap[]): Promise<RawBar[]> {
  const filled: RawBar[] = [];
  for (const gap of gaps) {
    if (gap.isWeekend) continue;
    const { candles } = await fetchMt5CandleRange(symbol, timeframe, gap.fromExclusive, gap.toExclusive);
    for (const candle of candles) {
      if (candle.t > gap.fromExclusive && candle.t < gap.toExclusive) {
        filled.push({ brokerTime: candle.t, o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v });
      }
    }
  }
  return filled;
}

export function attachSpread(bars: RawBar[], ticks: { t: number; bid: number; ask: number }[]): RawBar[] {
  const sortedTicks = [...ticks].sort((a, b) => a.t - b.t);
  return bars.map((bar) => {
    const match = sortedTicks.find((tick) => tick.t >= bar.brokerTime);
    if (!match) return bar;
    return { ...bar, spreadAtClose: match.ask - match.bid };
  });
}

export type ReadState = "OK" | "DEGRADED";

export function computeReadState(lastTickBrokerTime: number, nowBrokerTime: number, thresholdSeconds = 7): ReadState {
  return nowBrokerTime - lastTickBrokerTime > thresholdSeconds ? "DEGRADED" : "OK";
}
