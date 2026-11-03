"use client";

// Cumulative R by exit date (primary exit): AI kept, AI vetoed, and, once the verdict is
// frozen, the random control's median R per trade times the kept trade count so far
// (what the same number of random entries would have earned on median).
// Kept setups after the frozen 300 are a separate dashed line (information only).
// Chart approach follows scan/setup-chart.tsx (recharts, CSS-variable colours).

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fmtR } from "./format";

export interface CumPoint {
  date: string;
  cumR: number;
  n: number;
}

interface Props {
  kept: CumPoint[];
  vetoed: CumPoint[];
  afterVerdict: CumPoint[];
  /** Frozen control median R per trade, or null before the verdict. */
  controlMedian: number | null;
}

const KEPT = "#34d399";
const VETOED = "#f43f5e";
const AFTER = "#22d3ee";
const CONTROL = "#a1a1aa";

type Row = { date: string; kept?: number; vetoed?: number; afterVerdict?: number; control?: number };

function buildRows({ kept, vetoed, afterVerdict, controlMedian }: Props): Row[] {
  const byDate = new Map<string, Row>();
  const row = (date: string) => {
    let r = byDate.get(date);
    if (!r) {
      r = { date };
      byDate.set(date, r);
    }
    return r;
  };
  for (const p of kept) {
    const r = row(p.date);
    r.kept = p.cumR;
    if (controlMedian !== null) r.control = controlMedian * p.n;
  }
  for (const p of vetoed) row(p.date).vetoed = p.cumR;
  for (const p of afterVerdict) row(p.date).afterVerdict = p.cumR;
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function CumulativeChart(props: Props) {
  const rows = buildRows(props);
  if (rows.length === 0) return null;
  const hasAfter = props.afterVerdict.length > 0;
  const hasControl = props.controlMedian !== null && props.kept.length > 0;

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fill: "var(--color-muted)", fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis tick={{ fill: "var(--color-muted)", fontSize: 11 }} tickFormatter={(v: number) => `${v}R`} width={48} />
          <Tooltip
            contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", fontSize: 12 }}
            labelStyle={{ color: "var(--color-muted)" }}
            formatter={(v) => fmtR(typeof v === "number" ? v : Number(v))}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="linear" dataKey="kept" name="AI เก็บ" stroke={KEPT} dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
          <Line type="linear" dataKey="vetoed" name="AI ทิ้ง" stroke={VETOED} dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
          {hasAfter && (
            <Line type="linear" dataKey="afterVerdict" name="หลังคำตัดสิน" stroke={AFTER} dot={false} strokeWidth={1.5} strokeDasharray="4 3" connectNulls isAnimationActive={false} />
          )}
          {hasControl && (
            <Line type="linear" dataKey="control" name="ซื้อสุ่ม (มัธยฐาน × จำนวนเทรด)" stroke={CONTROL} dot={false} strokeWidth={1.5} strokeDasharray="6 4" connectNulls isAnimationActive={false} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
