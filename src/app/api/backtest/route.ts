import { NextResponse } from "next/server";
import { fetchCandles } from "@/lib/marketData";
import { backtestCandles, summarizeBacktest } from "@/lib/backtest/engine";
import { DEFAULT_THRESHOLDS } from "@/lib/trading/scanner";
import { ALLOWED_RANGES, ALLOWED_INTERVALS, type Range, type Interval } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ConfigIn { interval?: string; range?: string; adxFloor?: number; rsiLow?: number; rsiHigh?: number }

const DEFAULT_SYMBOLS = ["GC=F", "BTC-USD"];
const DEFAULT_CONFIGS: ConfigIn[] = [
  { interval: "15m", range: "5d" },
  { interval: "1h", range: "3mo" },
  { interval: "1d", range: "1y" },
];

const isInterval = (v: unknown): v is Interval => typeof v === "string" && (ALLOWED_INTERVALS as readonly string[]).includes(v);
const isRange = (v: unknown): v is Range => typeof v === "string" && (ALLOWED_RANGES as readonly string[]).includes(v);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { symbols?: string[]; configs?: ConfigIn[] };
  const symbols = Array.isArray(body.symbols) && body.symbols.length ? body.symbols : DEFAULT_SYMBOLS;
  const configs = Array.isArray(body.configs) && body.configs.length ? body.configs : DEFAULT_CONFIGS;

  const results: Record<string, unknown>[] = [];
  for (const sym of symbols) {
    for (const c of configs) {
      const interval = isInterval(c.interval) ? c.interval : "1h";
      const range = isRange(c.range) ? c.range : "3mo";
      const thresholds = {
        adxFloor: num(c.adxFloor, DEFAULT_THRESHOLDS.adxFloor),
        rsiLow: num(c.rsiLow, DEFAULT_THRESHOLDS.rsiLow),
        rsiHigh: num(c.rsiHigh, DEFAULT_THRESHOLDS.rsiHigh),
      };
      try {
        const resp = await fetchCandles(sym, range, interval);
        const bt = backtestCandles(resp.symbol, resp.candles, 0.1, thresholds);
        const summary = summarizeBacktest(bt.trades);
        results.push({ symbol: resp.symbol, interval, range, ...thresholds, bars: bt.bars, signals: bt.signals, ...summary });
      } catch (e) {
        results.push({ symbol: sym, interval, range, ...thresholds, error: String(e) });
      }
    }
  }

  return NextResponse.json({ results });
}
