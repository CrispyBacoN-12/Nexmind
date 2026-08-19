"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { Card, CardTitle, Stat, Button, Empty } from "@/components/ui";
import { cn, fmtMoney, fmtNumber, colorForChange } from "@/lib/utils";
import type { Candle } from "@/lib/indicators";
import type { Range, Interval } from "@/lib/yahoo";
import { WatchlistStrip } from "./webull/watchlist-strip";

interface CandleResponse {
  symbol: string;
  range: Range;
  interval: Interval;
  price?: number;
  candles: Candle[];
}

// "time": single trading day, axis shows only time-of-day. "datetime": spans
// multiple days at intraday resolution, so the axis needs the date too or
// ticks look non-sequential (e.g. "8:30, 8:23, 8:16" repeating every day).
// "date": daily/weekly bars, axis shows only the date.
type AxisFormat = "time" | "datetime" | "date";

const PERIODS: { key: string; label: string; range: Range; interval: Interval; axisFormat: AxisFormat }[] = [
  { key: "1D", label: "1D", range: "1d", interval: "1m", axisFormat: "time" },
  { key: "5D", label: "5D", range: "5d", interval: "5m", axisFormat: "datetime" },
  { key: "1M", label: "1M", range: "1mo", interval: "60m", axisFormat: "datetime" },
  { key: "3M", label: "3M", range: "3mo", interval: "1d", axisFormat: "date" },
  { key: "6M", label: "6M", range: "6mo", interval: "1d", axisFormat: "date" },
  { key: "1Y", label: "1Y", range: "1y", interval: "1d", axisFormat: "date" },
  { key: "5Y", label: "5Y", range: "5y", interval: "1wk", axisFormat: "date" },
];

const UP = "#34d399";
const DOWN = "#f43f5e";

function formatAxisTick(t: number, axisFormat: AxisFormat) {
  const d = new Date(t * 1000);
  if (axisFormat === "time") return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (axisFormat === "datetime") return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Webull's shared public sandbox occasionally emits bars whose price has
// diverged into an obviously synthetic random-walk (seen on TSLA/5y: real
// bars around $200-300 followed by bars in the millions). Drop anything far
// from the sample median rather than let one bad bar wreck the chart scale.
function dropOutlierCandles(candles: Candle[]): Candle[] {
  if (candles.length < 3) return candles;
  // internally-inconsistent bar: high/low miles away from that bar's own open/close
  const internallySane = candles.filter((c) => {
    const body = Math.max(c.o, c.c);
    const floor = Math.min(c.o, c.c);
    return c.h <= body * 3 && c.l >= floor / 3;
  });
  const pool = internallySane.length > 0 ? internallySane : candles;
  const sorted = [...pool].map((c) => c.c).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!median) return pool;
  return pool.filter((c) => c.c >= median / 3 && c.c <= median * 3);
}

function ChartTooltip({ active, payload, intraday }: { active?: boolean; payload?: { payload: { t: number; c: number; v: number } }[]; intraday: boolean }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const d = new Date(p.t * 1000);
  return (
    <div className="rounded-md border border-(--color-border) bg-(--color-card) px-3 py-2 text-xs shadow-lg">
      <div className="text-(--color-muted) font-mono">
        {intraday
          ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
          : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
      </div>
      <div className="font-mono tabular-nums mt-0.5">{fmtMoney(p.c)}</div>
      <div className="text-(--color-muted) font-mono tabular-nums">vol {fmtNumber(p.v, 0)}</div>
    </div>
  );
}

/** Webull live market data (quotes, chart, volume) — embedded directly in War
 *  Room so the desk and the tape live on one screen. Same data source as the
 *  former standalone /webull page. */
export function WebullPanel() {
  const [symbolInput, setSymbolInput] = useState("AAPL");
  const [activeSymbol, setActiveSymbol] = useState("AAPL");
  const [periodKey, setPeriodKey] = useState("3M");
  const [data, setData] = useState<CandleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const period = PERIODS.find((p) => p.key === periodKey) ?? PERIODS[3];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/webull/candles?symbol=${activeSymbol}&range=${period.range}&interval=${period.interval}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `request failed (${r.status})`);
        return body as CandleResponse;
      })
      .then((body) => {
        const candles = dropOutlierCandles(body.candles);
        if (candles.length === 0) throw new Error("Webull sandbox returned only anomalous bars for this symbol/period");
        if (!cancelled) setData({ ...body, candles });
      })
      .catch((e) => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setData(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeSymbol, period.range, period.interval]);

  const stats = useMemo(() => {
    const candles = data?.candles ?? [];
    if (candles.length === 0) return null;
    const last = candles.at(-1)!;
    const open = candles[0].o;
    const changePct = open ? ((last.c - open) / open) * 100 : 0;
    const high = Math.max(...candles.map((c) => c.h));
    const low = Math.min(...candles.map((c) => c.l));
    const volume = candles.reduce((sum, c) => sum + c.v, 0);
    return { last: last.c, changePct, high, low, volume };
  }, [data]);

  const positive = (stats?.changePct ?? 0) >= 0;
  const lineColor = positive ? UP : DOWN;

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const s = symbolInput.trim().toUpperCase();
    if (s) setActiveSymbol(s);
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-3">
        <CardTitle className="mb-0">📈 Webull Tape</CardTitle>
      </div>

      <div className="mb-4">
        <WatchlistStrip active={activeSymbol} onSelect={(s) => { setSymbolInput(s); setActiveSymbol(s); }} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <input
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
            placeholder="Symbol e.g. AAPL"
            className="h-9 w-40 rounded-md border border-(--color-border) bg-(--color-card-2) px-3 text-sm font-mono uppercase tracking-wide outline-none focus:border-(--color-accent)/60"
          />
          <Button type="submit" size="sm">Load</Button>
        </form>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriodKey(p.key)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs font-medium transition",
                p.key === periodKey ? "bg-(--color-accent)/15 text-(--color-accent)" : "text-(--color-muted) hover:bg-(--color-border)/40",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="h-72 flex items-center justify-center text-sm text-(--color-muted)">Loading {activeSymbol}…</div>}

      {!loading && error && (
        <Empty title={`Couldn't load ${activeSymbol} from Webull`} hint={error} />
      )}

      {!loading && !error && data && stats && (
        <>
          <div className="flex items-baseline gap-3 mb-4">
            <span className="text-3xl font-semibold font-mono tabular-nums">{fmtMoney(stats.last)}</span>
            <span className={cn("text-sm font-mono tabular-nums font-medium", colorForChange(stats.changePct))}>
              {stats.changePct >= 0 ? "+" : ""}{fmtNumber(stats.changePct, 2)}% ({period.label})
            </span>
          </div>

          <div className="h-72 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.candles} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="priceFillWarRoom" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColor} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(t) => formatAxisTick(t, period.axisFormat)}
                  stroke="var(--color-muted)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                />
                <YAxis
                  yAxisId="price"
                  domain={["auto", "auto"]}
                  tickFormatter={(v) => fmtNumber(v, 0)}
                  stroke="var(--color-muted)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                />
                <YAxis yAxisId="volume" orientation="right" domain={[0, (max: number) => max * 4]} hide />
                <Tooltip content={<ChartTooltip intraday={period.axisFormat !== "date"} />} />
                <Bar yAxisId="volume" dataKey="v" fill="var(--color-border)" radius={[1, 1, 0, 0]} />
                <Area yAxisId="price" type="monotone" dataKey="c" stroke={lineColor} strokeWidth={1.75} fill="url(#priceFillWarRoom)" dot={false} activeDot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {!loading && !error && stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <Stat label="Period High" value={fmtMoney(stats.high)} />
          <Stat label="Period Low" value={fmtMoney(stats.low)} />
          <Stat label="Volume" value={fmtNumber(stats.volume, 0)} />
          <Stat label="Interval" value={<span className="font-mono">{period.interval}</span>} sub={<span className="font-mono">{period.range}</span>} />
        </div>
      )}
    </Card>
  );
}
