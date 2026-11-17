"use client";

// Rules vs buy-and-hold (info only): the AI-kept fills summed in R at each daily close, under the
// exit rules (stop / T1 / 10 sessions) and held forever. Same recharts setup as cumulative-chart.tsx.

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { RulesVsHoldPoint } from "@/lib/scorecard/rulesVsHold";

import { fmtR } from "./format";

const RULES = "#34d399";
const HOLD = "#a78bfa";

export function RulesVsHoldChart({ points }: { points: RulesVsHoldPoint[] }) {
  if (points.length === 0) return null;
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fill: "var(--color-muted)", fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis tick={{ fill: "var(--color-muted)", fontSize: 11 }} tickFormatter={(v: number) => `${v}R`} width={48} />
          <Tooltip
            contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", fontSize: 12 }}
            labelStyle={{ color: "var(--color-muted)" }}
            labelFormatter={(d, payload) => {
              const n = (payload?.[0]?.payload as RulesVsHoldPoint | undefined)?.n;
              return n === undefined ? String(d) : `${d} · ${n} เทรด`;
            }}
            formatter={(v) => fmtR(typeof v === "number" ? v : Number(v))}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="linear" dataKey="rules" name="ตามกฎ (stop/T1/10 วัน)" stroke={RULES} dot={false} strokeWidth={2} isAnimationActive={false} />
          <Line type="linear" dataKey="hold" name="ซื้อแล้วถือ" stroke={HOLD} dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
