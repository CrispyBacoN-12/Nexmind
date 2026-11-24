"use client";

// One year of daily closes with the support (green) and resistance (red)
// zones as bands, MA50/MA200 and, for a holding, the owner's average cost.
// Draws only what the zone list beside it already says.

import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { Zone } from "@/lib/levels/levels";
import { fmtMoney } from "@/lib/utils";

export interface SeriesPoint {
  t: number;
  c: number;
  ma50: number | null;
  ma200: number | null;
}

const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

export function LevelsChart({ series, zones, price, avgCost }: { series: SeriesPoint[]; zones: Zone[]; price: number; avgCost: number | null }) {
  const data = series.map((p) => ({ ...p, d: day(p.t) }));
  const closes = series.map((p) => p.c);
  const lo = Math.min(...closes, ...(avgCost ? [avgCost] : []));
  const hi = Math.max(...closes, ...(avgCost ? [avgCost] : []));
  const pad = (hi - lo) * 0.08;
  const yMin = Math.max(0, lo - pad);
  const yMax = hi + pad;
  const visible = zones.filter((z) => z.high >= yMin && z.low <= yMax);

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="d" tick={{ fontSize: 10 }} minTickGap={40} />
          <YAxis domain={[yMin, yMax]} tick={{ fontSize: 10 }} width={56} tickFormatter={(v: number) => v.toFixed(v < 20 ? 2 : 0)} />
          <Tooltip formatter={(v) => (typeof v === "number" ? fmtMoney(v) : String(v))} labelStyle={{ color: "#000" }} />
          {visible.map((z) => (
            <ReferenceArea
              key={`${z.low}-${z.high}`}
              y1={Math.max(z.low, yMin)}
              y2={Math.min(z.high, yMax)}
              fill={z.high < price ? "#10b981" : z.low > price ? "#f43f5e" : "#f59e0b"}
              fillOpacity={z.stale ? 0.08 : 0.18}
              strokeOpacity={0}
              ifOverflow="hidden"
            />
          ))}
          {avgCost != null && <ReferenceLine y={avgCost} stroke="#a78bfa" strokeDasharray="4 4" label={{ value: "ทุน", fontSize: 10, fill: "#a78bfa", position: "insideTopLeft" }} />}
          <Line type="monotone" dataKey="c" name="ราคาปิด" stroke="var(--color-accent)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          <Line type="monotone" dataKey="ma50" name="MA50" stroke="#60a5fa" dot={false} strokeWidth={1} isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="ma200" name="MA200" stroke="#94a3b8" dot={false} strokeWidth={1} isAnimationActive={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
