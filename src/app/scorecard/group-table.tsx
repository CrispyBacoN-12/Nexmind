"use client";

// The group table (spec §9.2): kept / vetoed / unread / guard-stripped / random control.
// Primary exit (hold up to 10 sessions) first; a toggle shows the same-day-close figures.

import { useState } from "react";

import type { GroupStats } from "@/lib/scorecard/groups";
import { SCORECARD_MIN_N, type ExitVariant } from "@/lib/scorecard/types";
import { cn } from "@/lib/utils";

import { fmtFraction, fmtR, rTone } from "./format";

export interface TableRow {
  key: string;
  label: string;
  note?: string;
  stats: Record<ExitVariant, GroupStats>;
  /** Primary-exit status counts, shown under n. */
  counts?: { open: number; notFilled: number; noData: number };
}

const th = "px-3 py-2 text-xs font-medium text-(--color-muted) text-right first:text-left";
const td = "px-3 py-2 text-sm tabular-nums text-right first:text-left";

const VARIANTS: { v: ExitVariant; label: string }[] = [
  { v: "hold", label: "ตัวชี้ขาด: ถือจนชน stop/T1 (สูงสุด 10 วัน)" },
  { v: "sameDay", label: "ตัวประกอบ: ขายตอนปิดวันนั้น" },
];

function countsNote(c: NonNullable<TableRow["counts"]>): string {
  return [
    c.open > 0 ? `ถืออยู่ ${c.open}` : null,
    c.notFilled > 0 ? `ไม่ได้เข้า ${c.notFilled}` : null,
    c.noData > 0 ? `ไม่มีข้อมูล ${c.noData}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** `controlMedian`: the frozen verdict's random-control median R (hold), or null until it exists. */
export function GroupTable({ rows, controlMedian }: { rows: TableRow[]; controlMedian: number | null }) {
  const [variant, setVariant] = useState<ExitVariant>("hold");

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-3" role="group" aria-label="วิธีออก">
        {VARIANTS.map(({ v, label }) => (
          <button
            key={v}
            type="button"
            onClick={() => setVariant(v)}
            aria-pressed={variant === v}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs transition cursor-pointer",
              variant === v
                ? "border-(--color-accent) bg-(--color-accent)/10 text-(--color-accent)"
                : "border-(--color-border) text-(--color-muted) hover:bg-(--color-border)/40",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-(--color-border)">
              <th className={th}>กลุ่ม</th>
              <th className={th}>จำนวน (ปิดแล้ว)</th>
              <th className={th}>เฉลี่ย R</th>
              <th className={th}>ชนะ %</th>
              <th className={th}>ถึง T1 ก่อน stop</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const s = row.stats[variant];
              const tooFew = s.n > 0 && s.n < SCORECARD_MIN_N;
              const note = variant === "hold" && row.counts ? countsNote(row.counts) : "";
              return (
                <tr key={row.key} className="border-b border-(--color-border)/60">
                  <td className={td}>
                    <div>{row.label}</div>
                    {row.note && <div className="text-xs text-(--color-muted)">{row.note}</div>}
                  </td>
                  <td className={td}>
                    <div>{s.n}</div>
                    {note && <div className="text-xs text-(--color-muted)">{note}</div>}
                  </td>
                  {s.n === 0 ? (
                    <td colSpan={3} className={cn(td, "text-(--color-muted)")}>
                      {"—"}
                    </td>
                  ) : tooFew ? (
                    <td colSpan={3} className={cn(td, "bg-(--color-border)/30 text-(--color-muted) text-center")}>
                      ยังน้อยเกินไป (ต้องมี {SCORECARD_MIN_N} ขึ้นไป)
                    </td>
                  ) : (
                    <>
                      <td className={cn(td, rTone(s.meanR))}>{fmtR(s.meanR)}</td>
                      <td className={td}>{fmtFraction(s.winPct)}</td>
                      <td className={td}>{fmtFraction(s.t1Pct)}</td>
                    </>
                  )}
                </tr>
              );
            })}
            <tr>
              <td className={td}>
                <div>ซื้อสุ่ม (ตัวเทียบ)</div>
                <div className="text-xs text-(--color-muted)">มัธยฐานของรอบสุ่ม ตรึงไว้ตอนตัดสิน</div>
              </td>
              <td className={cn(td, "text-(--color-muted)")}>{"—"}</td>
              {variant === "hold" && controlMedian !== null ? (
                <td className={cn(td, rTone(controlMedian))}>{fmtR(controlMedian)}</td>
              ) : (
                <td className={cn(td, "text-(--color-muted) text-xs")}>
                  {variant === "hold" ? "ตัวเทียบซื้อสุ่มคำนวณตอนครบ 300" : "—"}
                </td>
              )}
              <td className={cn(td, "text-(--color-muted)")}>{"—"}</td>
              <td className={cn(td, "text-(--color-muted)")}>{"—"}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-(--color-muted) mt-2">นับเฉพาะเทรดที่ปิดแล้ว เฉลี่ย R หักต้นทุนแล้ว ชนะ % = ปิดบวก</p>
    </div>
  );
}
