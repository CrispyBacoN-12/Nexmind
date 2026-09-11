"use client";

// The picture of the same structure the card describes in numbers.
//
// It adds no information. Every line on it — entry, stop, the R ladder, the
// two moving averages — is already a field on the card or a mean over bars the
// card was computed from. The chart exists because a level is easier to judge
// against six months of range than against a dollar figure, and for no other
// reason: it ranks nothing, it recommends nothing, and ADVISOR_NO_EDGE_CLAIM
// stands over it exactly as it stands over the numbers.
//
// Two conventions carry meaning and are worth stating:
//   - A level is FADED across history and SOLID across the empty zone to the
//     right of the last bar, because that is where it applies. A line drawn
//     solid over history would read as something that already happened.
//   - The moving averages are reference, not signal. Nothing in this project
//     has ever tested an SMA cross into profit.

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  withProjection,
  CHART_SMA_FAST,
  CHART_SMA_SLOW,
  type ChartBar,
  type ChartRow,
} from "@/lib/advisor/chartSeries";
import type { AdvisorCard } from "@/lib/advisor/types";
import { fmtMoney, fmtNumber } from "@/lib/utils";

const UP = "#34d399";
const DOWN = "#f43f5e";
const SMA_FAST_COLOR = "#e3bd6a";
const SMA_SLOW_COLOR = "#22d3ee";
const ENTRY_COLOR = "#d8e2ec";
const STOP_COLOR = "#f43f5e";
const TARGET_COLOR = "#34d399";

/** Breathing room above and below the extreme of everything drawn. */
const Y_PADDING = 0.04;

/** Shared between the two panels so hovering one highlights the other. */
const SYNC_ID = "advisor-chart";

interface Level {
  price: number;
  color: string;
  label: string;
  /** Targets are drawn thinner than the two levels the trade actually turns on. */
  minor?: boolean;
}

function levelsOf(card: AdvisorCard): Level[] {
  return [
    { price: card.stop, color: STOP_COLOR, label: `Stop ${fmtMoney(card.stop)}` },
    { price: card.entry, color: ENTRY_COLOR, label: `Entry ${fmtMoney(card.entry)}` },
    ...card.ladder.map((row) => ({
      price: row.price,
      color: TARGET_COLOR,
      label: `${row.r}R ${fmtMoney(row.price)}`,
      minor: true,
    })),
  ];
}

/**
 * A candle, drawn from the props recharts hands a Bar's custom shape.
 *
 * The Bar's dataKey is the bar's HIGH, so `y` is the pixel of the high and
 * `height` is the distance from there down to the axis baseline — which is
 * `domainMin`, since the domain never reaches zero. That gives a price-to-pixel
 * scale, and every other price on the bar follows from it. Deriving it this way
 * rather than assuming a scale means the candle cannot drift out of alignment
 * with the axis it is drawn against.
 */
function CandleShape(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  domainMin?: number;
  payload?: ChartRow;
}) {
  const { x = 0, y = 0, width = 0, height = 0, domainMin = 0, payload } = props;
  if (!payload || !payload.real) return null;
  const { o, h, l, c } = payload;
  if (o == null || h == null || l == null || c == null) return null;

  const span = h - domainMin;
  // A bar whose high sits exactly on the axis floor has no scale to derive.
  if (span <= 0 || height <= 0) return null;
  const pxPerPrice = height / span;
  const yOf = (price: number) => y + (h - price) * pxPerPrice;

  const rising = c >= o;
  const color = rising ? UP : DOWN;
  const bodyTop = yOf(Math.max(o, c));
  const bodyBottom = yOf(Math.min(o, c));
  // A doji has a zero-height body; 1px keeps it visible as a line.
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

function VolumeShape(props: { x?: number; y?: number; width?: number; height?: number; payload?: ChartRow }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  if (!payload || !payload.real || payload.v == null) return null;
  const rising = payload.c != null && payload.o != null && payload.c >= payload.o;
  const w = Math.max(1, width * 0.72);
  return (
    <rect
      x={x + (width - w) / 2}
      y={y}
      width={w}
      height={Math.max(0, height)}
      fill={rising ? UP : DOWN}
      fillOpacity={0.35}
    />
  );
}

function BarTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  if (!row.real || row.o == null || row.h == null || row.l == null || row.c == null) return null;
  const rising = row.c >= row.o;
  return (
    <div className="rounded-md border border-(--color-border) bg-(--color-card) px-3 py-2 text-xs shadow-lg space-y-0.5">
      <div className="font-mono text-(--color-muted)">{row.d}</div>
      <div className="font-mono tabular-nums" style={{ color: rising ? UP : DOWN }}>
        O {fmtMoney(row.o)} · H {fmtMoney(row.h)} · L {fmtMoney(row.l)} · C {fmtMoney(row.c)}
      </div>
      {row.v != null ? (
        <div className="font-mono tabular-nums text-(--color-muted)">Vol {fmtNumber(row.v, 0)}</div>
      ) : null}
      {row.sma50 != null ? (
        <div className="font-mono tabular-nums" style={{ color: SMA_FAST_COLOR }}>
          SMA{CHART_SMA_FAST} {fmtMoney(row.sma50)}
        </div>
      ) : null}
      {row.sma200 != null ? (
        <div className="font-mono tabular-nums" style={{ color: SMA_SLOW_COLOR }}>
          SMA{CHART_SMA_SLOW} {fmtMoney(row.sma200)}
        </div>
      ) : null}
    </div>
  );
}

function LegendChip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-(--color-muted)">
      <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

export function AdvisorChart({
  bars,
  card,
  onPickEntry,
}: {
  bars: ChartBar[];
  card: AdvisorCard;
  /** Called with a candle's close, and the date it came from, when clicked. */
  onPickEntry: (price: number, date: string) => void;
}) {
  const rows = withProjection(bars);
  if (rows.length === 0) return null;

  const levels = levelsOf(card);
  const lows = rows.filter((r) => r.l != null).map((r) => r.l as number);
  const highs = rows.filter((r) => r.h != null).map((r) => r.h as number);
  if (lows.length === 0 || highs.length === 0) return null;

  // The domain has to hold the bars AND every level, or a stop below the
  // six-month low would be clipped off the bottom and silently not drawn.
  const rawMin = Math.min(...lows, ...levels.map((v) => v.price));
  const rawMax = Math.max(...highs, ...levels.map((v) => v.price));
  const pad = (rawMax - rawMin) * Y_PADDING || rawMax * Y_PADDING || 1;
  const domainMin = rawMin - pad;
  const domainMax = rawMax + pad;

  const firstD = rows[0].d;
  const lastD = rows[rows.length - 1].d;
  const lastRealIndex = rows.reduce((acc, r, i) => (r.real ? i : acc), 0);
  const lastRealD = rows[lastRealIndex].d;

  const maxVolume = Math.max(...rows.map((r) => r.v ?? 0), 1);

  // recharts 3 hands the click the active CATEGORY, not the datum — so the row
  // is looked up by date rather than read off a payload that no longer exists.
  // Clicking the empty projection zone finds a row with no close and does
  // nothing, which is the right answer: there is no price there to pick.
  function handleClick(state: { activeLabel?: string | number }) {
    const row = rows.find((r) => r.d === state?.activeLabel);
    if (row?.real && row.c != null) onPickEntry(row.c, row.d);
  }

  return (
    <div className="space-y-1">
      <div className="h-[340px] -mx-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            syncId={SYNC_ID}
            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
            onClick={handleClick}
          >
            <CartesianGrid stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="d"
              stroke="var(--color-muted)"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              minTickGap={48}
              tickFormatter={(d: string) => d.slice(5)}
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

            {/* Entry to stop: the money actually at risk, as an area rather than
                a number, across the whole width because it is true throughout. */}
            <ReferenceArea
              x1={firstD}
              x2={lastD}
              y1={Math.min(card.entry, card.stop)}
              y2={Math.max(card.entry, card.stop)}
              fill={STOP_COLOR}
              fillOpacity={0.07}
              stroke="none"
            />

            {levels.map((lv) => (
              <ReferenceLine
                key={`hist-${lv.label}`}
                segment={[
                  { x: firstD, y: lv.price },
                  { x: lastRealD, y: lv.price },
                ]}
                stroke={lv.color}
                strokeOpacity={lv.minor ? 0.16 : 0.28}
                strokeDasharray="3 4"
                strokeWidth={1}
              />
            ))}
            {levels.map((lv) => (
              <ReferenceLine
                key={`live-${lv.label}`}
                segment={[
                  { x: lastRealD, y: lv.price },
                  { x: lastD, y: lv.price },
                ]}
                stroke={lv.color}
                strokeWidth={lv.minor ? 1 : 1.5}
                label={{
                  value: lv.label,
                  position: "insideTopRight",
                  fill: lv.color,
                  fontSize: 10,
                  opacity: lv.minor ? 0.75 : 1,
                }}
              />
            ))}

            {/* Where the projection zone begins — the last bar that exists. */}
            <ReferenceLine x={lastRealD} stroke="var(--color-border)" strokeWidth={1} />

            <Bar
              dataKey="h"
              isAnimationActive={false}
              shape={<CandleShape domainMin={domainMin} />}
            />
            <Line
              type="monotone"
              dataKey="sma50"
              stroke={SMA_FAST_COLOR}
              strokeWidth={1.25}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="sma200"
              stroke={SMA_SLOW_COLOR}
              strokeWidth={1.25}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
            {/* The entry as a POINT, on the last bar that exists.
                A horizontal line alone cannot say where the entry was struck,
                so "the entry is the latest price" had to be taken on trust.
                The dot puts it on the bar the card was computed from: when
                entry is the last close it lands exactly on that candle's
                close, and when it is an override it visibly does not — which
                is the honest report, not a defect to hide. */}
            <ReferenceDot
              x={lastRealD}
              y={card.entry}
              r={3.5}
              fill={ENTRY_COLOR}
              stroke="var(--color-card)"
              strokeWidth={1}
            />
            {card.entry !== card.lastClose ? (
              <ReferenceDot
                x={lastRealD}
                y={card.lastClose}
                r={3}
                fill="none"
                stroke={ENTRY_COLOR}
                strokeOpacity={0.55}
                strokeWidth={1}
                label={{
                  value: `Last close ${fmtMoney(card.lastClose)}`,
                  position: "insideBottomRight",
                  fill: ENTRY_COLOR,
                  fontSize: 10,
                  opacity: 0.7,
                }}
              />
            ) : null}

            <Tooltip content={<BarTooltip />} cursor={{ stroke: "var(--color-border)" }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="h-[74px] -mx-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} syncId={SYNC_ID} margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
            <XAxis dataKey="d" hide />
            {/* NOT `hide`: a hidden axis reserves no width, and the volume bars
                would then start 64px left of the candles they belong to. The
                axis is drawn with nothing on it instead, so both plot areas
                begin at the same pixel. */}
            <YAxis
              domain={[0, maxVolume]}
              width={64}
              tick={false}
              tickLine={false}
              axisLine={false}
            />
            <Bar dataKey="v" isAnimationActive={false} shape={<VolumeShape />} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pt-1">
        <LegendChip color={ENTRY_COLOR}>Entry</LegendChip>
        <LegendChip color={STOP_COLOR}>Stop · risk zone</LegendChip>
        <LegendChip color={TARGET_COLOR}>R targets</LegendChip>
        <LegendChip color={SMA_FAST_COLOR}>SMA{CHART_SMA_FAST}</LegendChip>
        <LegendChip color={SMA_SLOW_COLOR}>SMA{CHART_SMA_SLOW}</LegendChip>
        <span className="text-xs text-(--color-muted)">
          Levels are faded over history and solid where they apply. The filled dot is the entry, on
          the last bar the card was computed from — {card.entrySource === "override"
            ? "an override, so it sits off that bar's close, which is drawn hollow beside it"
            : "the close of that bar"}
          . Click a candle to use its close as the entry. The moving averages are reference, not
          signal.
        </span>
      </div>
    </div>
  );
}
