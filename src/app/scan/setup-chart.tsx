"use client";

// The 5-minute picture behind one chart-agent setup: previous session,
// pre-market and today's bars, with every level the code found, the entry,
// stop and targets as lines, and a dot under the bar that swept the level.
//
// It adds no information the numbers beside it do not already carry. The
// drawing approach (a Bar whose custom shape paints the candle, reference
// lines for prices) is the one in advisor/advisor-chart.tsx. The x axis is the
// bar INDEX, not the time: the session gap and the pre-market hours would
// otherwise stretch the axis, and times repeat across sessions so they could
// not serve as category keys. Ticks are labelled with New York HH:MM, and a
// vertical line marks where today starts.

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { Candle } from "@/lib/indicators";
import type { LevelName, Setup } from "@/lib/chartAgent/types";
import { fmtMoney, fmtNumber } from "@/lib/utils";

const UP = "#34d399";
const DOWN = "#f43f5e";
const TARGET_COLOR = "#34d399";
const STOP_COLOR = "#f43f5e";
const ENTRY_COLOR = "var(--color-accent)";
const LEVEL_COLOR = "var(--color-muted)";

/** Breathing room above and below the extreme of everything drawn. */
const Y_PADDING = 0.04;

const etFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function etParts(epochSec: number): { date: string; hhmm: string } {
  const p: Record<string, string> = {};
  for (const part of etFormat.formatToParts(new Date(epochSec * 1000))) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
}

interface Row extends Candle {
  i: number;
  label: string;
  date: string;
}

function toRows(bars: Candle[]): Row[] {
  return bars.map((c, i) => {
    const { date, hhmm } = etParts(c.t);
    return { ...c, i, label: hhmm, date };
  });
}

/** Index of the first bar of the last ET date, or null when every bar shares one date. */
function todayStart(rows: Row[]): number | null {
  for (let i = rows.length - 1; i > 0; i--) {
    if (rows[i].date !== rows[i - 1].date) return i;
  }
  return null;
}

interface Line {
  key: string;
  price: number;
  color: string;
  label: string;
  dashed: boolean;
  /** Targets, entry and stop get the right-hand label; plain levels the left. */
  side: "left" | "right";
}

function linesOf(setup: Setup): Line[] {
  const lines: Line[] = [];
  for (const [name, price] of Object.entries(setup.levels) as [LevelName, number | null][]) {
    if (price === null) continue;
    lines.push({ key: `lv-${name}`, price, color: LEVEL_COLOR, label: `${name} ${fmtMoney(price)}`, dashed: true, side: "left" });
  }
  lines.push(
    { key: "entry", price: setup.entry, color: ENTRY_COLOR, label: `Entry ${fmtMoney(setup.entry)}`, dashed: false, side: "right" },
    { key: "stop", price: setup.stop, color: STOP_COLOR, label: `Stop ${fmtMoney(setup.stop)}`, dashed: false, side: "right" },
    { key: "t1", price: setup.t1.price, color: TARGET_COLOR, label: `T1 ${fmtMoney(setup.t1.price)}`, dashed: false, side: "right" },
  );
  if (setup.t2) {
    lines.push({ key: "t2", price: setup.t2.price, color: TARGET_COLOR, label: `T2 ${fmtMoney(setup.t2.price)}`, dashed: false, side: "right" });
  }
  return lines;
}

/** A candle painted from the props recharts hands a Bar's custom shape (same derivation as advisor-chart). */
function CandleShape(props: { x?: number; y?: number; width?: number; height?: number; domainMin?: number; payload?: Row }) {
  const { x = 0, y = 0, width = 0, height = 0, domainMin = 0, payload } = props;
  if (!payload) return null;
  const { o, h, l, c } = payload;
  const span = h - domainMin;
  if (span <= 0 || height <= 0) return null;
  const pxPerPrice = height / span;
  const yOf = (price: number) => y + (h - price) * pxPerPrice;

  const rising = c >= o;
  const color = rising ? UP : DOWN;
  const bodyTop = yOf(Math.max(o, c));
  const bodyBottom = yOf(Math.min(o, c));
  const bodyHeight = Math.max(1, bodyBottom - bodyTop);
  const mid = x + width / 2;
  const bodyWidth = Math.max(1, width * 0.72);

  return (
    <g>
      <line x1={mid} x2={mid} y1={yOf(h)} y2={yOf(l)} stroke={color} strokeWidth={1} />
      <rect
        x={mid - bodyWidth / 2}
        y={bodyTop}
        width={bodyWidth}
        height={bodyHeight}
        fill={rising ? "none" : color}
        stroke={color}
        strokeWidth={1}
      />
    </g>
  );
}

function BarTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const rising = row.c >= row.o;
  return (
    <div className="rounded-md border border-(--color-border) bg-(--color-card) px-3 py-2 text-xs shadow-lg space-y-0.5">
      <div className="font-mono text-(--color-muted)">
        {row.date} {row.label} ET
      </div>
      <div className="font-mono tabular-nums" style={{ color: rising ? UP : DOWN }}>
        O {fmtMoney(row.o)} · H {fmtMoney(row.h)} · L {fmtMoney(row.l)} · C {fmtMoney(row.c)}
      </div>
      <div className="font-mono tabular-nums text-(--color-muted)">ปริมาณ {fmtNumber(row.v, 0)}</div>
    </div>
  );
}

export function SetupChart({ setup, bars }: { setup: Setup; bars: Candle[] }) {
  const rows = toRows(bars);
  if (rows.length === 0) return null;

  const lines = linesOf(setup);
  const prices = [...rows.flatMap((r) => [r.h, r.l]), ...lines.map((l) => l.price), setup.sweepBar.l];
  const rawMin = Math.min(...prices);
  const rawMax = Math.max(...prices);
  const pad = (rawMax - rawMin) * Y_PADDING || rawMax * Y_PADDING || 1;
  const domainMin = rawMin - pad;
  const domainMax = rawMax + pad;

  const sweepRow = rows.find((r) => r.t === setup.sweepBar.t);
  const startOfToday = todayStart(rows);

  return (
    <div className="h-[300px] -mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="i"
            stroke="var(--color-muted)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            minTickGap={36}
            tickFormatter={(i: number) => rows[i]?.label ?? ""}
          />
          <YAxis
            domain={[domainMin, domainMax]}
            tickFormatter={(v: number) => fmtMoney(v)}
            stroke="var(--color-muted)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            width={64}
          />

          {lines.map((ln) => (
            <ReferenceLine
              key={ln.key}
              y={ln.price}
              stroke={ln.color}
              strokeWidth={ln.dashed ? 1 : 1.5}
              strokeOpacity={ln.dashed ? 0.7 : 1}
              strokeDasharray={ln.dashed ? "4 4" : undefined}
              label={{
                value: ln.label,
                position: ln.side === "left" ? "insideTopLeft" : "insideTopRight",
                fill: ln.color,
                fontSize: 10,
              }}
            />
          ))}

          {startOfToday !== null ? (
            <ReferenceLine
              x={startOfToday}
              stroke="var(--color-border)"
              strokeWidth={1}
              label={{ value: "วันนี้", position: "insideTopRight", fill: "var(--color-muted)", fontSize: 10 }}
            />
          ) : null}

          <Bar dataKey="h" isAnimationActive={false} shape={<CandleShape domainMin={domainMin} />} />

          {sweepRow ? (
            <ReferenceDot
              x={sweepRow.i}
              y={setup.sweepBar.l}
              r={4}
              fill={ENTRY_COLOR}
              stroke="var(--color-card)"
              strokeWidth={1}
              label={{ value: "sweep", position: "bottom", fill: "var(--color-muted)", fontSize: 10 }}
            />
          ) : null}

          <Tooltip content={<BarTooltip />} cursor={{ stroke: "var(--color-border)" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
