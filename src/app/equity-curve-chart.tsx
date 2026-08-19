"use client";

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { fmtMoney } from "@/lib/utils";

const UP = "#34d399";
const DOWN = "#f43f5e";

interface Point { t: number; cum: number }

function CurveTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const d = new Date(p.t * 1000);
  return (
    <div className="rounded-md border border-(--color-border) bg-(--color-card) px-3 py-2 text-xs shadow-lg">
      <div className="text-(--color-muted) font-mono">{d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
      <div className="font-mono tabular-nums mt-0.5">{fmtMoney(p.cum)}</div>
    </div>
  );
}

/** Cumulative realized P/L over a sequence of closed trades. */
export function EquityCurveChart({ trades }: { trades: { openedAt: Date | string; pnl: number | null }[] }) {
  const sorted = [...trades].sort((a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime());
  let cum = 0;
  const data: Point[] = sorted.map((t) => {
    cum += t.pnl ?? 0;
    return { t: Math.floor(new Date(t.openedAt).getTime() / 1000), cum };
  });
  if (data.length < 2) return null;
  const lineColor = cum >= 0 ? UP : DOWN;

  return (
    <div className="h-40 -mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`equityFill-${lineColor}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={0.3} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t) => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            stroke="var(--color-muted)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={(v) => fmtMoney(v)}
            stroke="var(--color-muted)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <ReferenceLine y={0} stroke="var(--color-border)" />
          <Tooltip content={<CurveTooltip />} />
          <Area type="monotone" dataKey="cum" stroke={lineColor} strokeWidth={1.75} fill={`url(#equityFill-${lineColor})`} dot={false} activeDot={{ r: 3 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
