"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { fmtMoney } from "@/lib/utils";

const COLORS = ["#34d399", "#22d3ee", "#a78bfa", "#f472b6", "#fbbf24", "#60a5fa", "#fb923c", "#4ade80"];

interface AllocTooltipPayload { label: string; value: number }

function AllocTooltip({ active, payload }: { active?: boolean; payload?: { payload: AllocTooltipPayload }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-(--color-border) bg-(--color-card) px-3 py-2 text-xs shadow-lg">
      <div className="font-mono font-semibold">{p.label}</div>
      <div className="font-mono tabular-nums mt-0.5">{fmtMoney(p.value)}</div>
    </div>
  );
}

/** Horizontal bar chart of position sizing by symbol — cost basis for holdings, premium for options. */
export function AllocationChart({ items }: { items: { label: string; value: number }[] }) {
  const data = [...items].sort((a, b) => b.value - a.value).slice(0, 12);
  if (data.length === 0) return null;
  const height = Math.max(80, data.length * 28);

  return (
    <div style={{ height }} className="-mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <XAxis type="number" tickFormatter={(v) => fmtMoney(v)} stroke="var(--color-muted)" fontSize={10} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" stroke="var(--color-muted)" fontSize={11} tickLine={false} axisLine={false} width={64} />
          <Tooltip content={<AllocTooltip />} cursor={{ fill: "var(--color-border)", opacity: 0.3 }} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
