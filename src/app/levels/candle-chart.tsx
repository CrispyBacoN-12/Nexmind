"use client";

// TradingView-style daily candle chart for /levels (lightweight-charts):
// wheel to zoom, drag to pan, crosshair with an O/H/L/C legend, volume strip,
// MA50/MA200, zone bands behind the candles and, for a holding, the owner's
// average cost as a dashed line. Draws only what the zone list below says.

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type AutoscaleInfo,
  type IChartApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import { rangeStart, widenRange, type ChartBar, type RangeKey } from "@/lib/levels/chart";
import type { Zone } from "@/lib/levels/levels";
import { fmtMoney } from "@/lib/utils";

import { ZoneBands } from "./zone-bands";

const RANGES: RangeKey[] = ["3M", "6M", "1Y", "2Y"];
const UP = "#10b981";
const DOWN = "#f43f5e";

const ts = (t: number) => t as UTCTimestamp;
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const fmtVol = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(Math.round(v)));

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function CandleChart({ series, zones, price, avgCost }: { series: ChartBar[]; zones: Zone[]; price: number; avgCost: number | null }) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [hover, setHover] = useState<ChartBar | null>(null);
  const [range, setRange] = useState<RangeKey>("6M");

  useEffect(() => {
    const el = box.current;
    if (!el || series.length === 0) return;
    const text = cssVar("--foreground", "#d8e2ec");
    const grid = cssVar("--border", "#1b2734");
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: text, fontSize: 11 },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: grid },
      timeScale: { borderColor: grid },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      // keep the cost line on screen even when the price has moved far from it
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
        const info = base();
        return info && { ...info, priceRange: widenRange(info.priceRange, avgCost) };
      },
    });
    // leave the bottom quarter for the volume strip so the lowest candles never sit on it
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.25 } });
    candles.setData(series.map((b) => ({ time: ts(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));

    const volume = chart.addSeries(HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volume.setData(series.map((b) => ({ time: ts(b.t), value: b.v, color: b.c >= b.o ? `${UP}66` : `${DOWN}66` })));

    const line = (color: string, pick: (b: ChartBar) => number | null) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(series.flatMap((b) => (pick(b) == null ? [] : [{ time: ts(b.t), value: pick(b)! }])));
    };
    line("#60a5fa", (b) => b.ma50);
    line("#94a3b8", (b) => b.ma200);

    candles.attachPrimitive(new ZoneBands(zones, price));
    if (avgCost != null) {
      candles.createPriceLine({ price: avgCost, color: "#a78bfa", lineStyle: LineStyle.Dashed, lineWidth: 1, title: "ทุน", axisLabelVisible: true });
    }

    const byT = new Map(series.map((b) => [b.t, b]));
    const onMove = (p: MouseEventParams<Time>) => setHover(p.time == null ? null : (byT.get(p.time as number) ?? null));
    chart.subscribeCrosshairMove(onMove);

    const from = rangeStart(series, "6M");
    if (from != null) chart.timeScale().setVisibleRange({ from: ts(from), to: ts(series.at(-1)!.t) });
    setRange("6M");

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      setHover(null);
    };
  }, [series, zones, price, avgCost]);

  function show(key: RangeKey) {
    const from = rangeStart(series, key);
    if (from == null || !chartRef.current) return;
    chartRef.current.timeScale().setVisibleRange({ from: ts(from), to: ts(series.at(-1)!.t) });
    setRange(key);
  }

  const b = hover ?? series.at(-1);
  const tone = b && b.c >= b.o ? "text-emerald-400" : "text-rose-400";
  return (
    <div>
      <div className="relative h-[420px] w-full">
        <div ref={box} className="absolute inset-0" />
        {b && (
          <div className="pointer-events-none absolute left-2 top-1 z-10 flex flex-wrap gap-x-2 font-mono text-[11px]">
            <span className="text-(--color-muted)">{day(b.t)}</span>
            <span>
              O <span className={tone}>{fmtMoney(b.o)}</span>
            </span>
            <span>
              H <span className={tone}>{fmtMoney(b.h)}</span>
            </span>
            <span>
              L <span className={tone}>{fmtMoney(b.l)}</span>
            </span>
            <span>
              C <span className={tone}>{fmtMoney(b.c)}</span>
            </span>
            <span>
              V <span className="text-(--color-muted)">{fmtVol(b.v)}</span>
            </span>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
        {RANGES.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => show(k)}
            className={`rounded px-2 py-1 font-mono ${range === k ? "bg-(--color-accent)/15 text-(--color-accent)" : "text-(--color-muted) hover:bg-(--color-border)/40"}`}
          >
            {k}
          </button>
        ))}
        <span className="ml-auto flex flex-wrap gap-x-3 text-(--color-muted)">
          <span className="text-[#60a5fa]">— MA50</span>
          <span className="text-[#94a3b8]">— MA200</span>
          {avgCost != null && <span className="text-[#a78bfa]">┄ ทุน</span>}
          <span>ล้อเมาส์ = ซูม · ลาก = เลื่อน</span>
        </span>
      </div>
    </div>
  );
}
