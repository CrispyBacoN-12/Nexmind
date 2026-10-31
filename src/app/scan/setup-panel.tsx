"use client";

// The chart agent's pop-up on /scan: at most five long liquidity-sweep setups,
// each with its 5-minute chart, the levels, the code-computed entry/stop/
// targets and the AI's Thai reading. Everything numeric comes from code; the
// reading is the only AI text, and a setup with no reading says why.
//
// Import discipline: runChartAgent.ts and review.ts pull server code (Prisma,
// the AI subprocess), so only their TYPES are imported here.

import Link from "next/link";
import { useEffect, useRef } from "react";

import { Badge, Button, Card } from "@/components/ui";
import type { ChartAgentResult, ShownSetup } from "@/lib/chartAgent/runChartAgent";
import type { Review } from "@/lib/chartAgent/review";
import type { Setup } from "@/lib/chartAgent/types";
import { fmtMoney, fmtNumber } from "@/lib/utils";

import { PHASE_LABEL, bangkokTime } from "./format";
import { SetupChart } from "./setup-chart";

/** Fixed copy: the rule is untested on stocks, and its nearest relative lost money. */
export const NO_BACKTEST_LINE =
  "กฎ sweep นี้ยังไม่เคยทดสอบย้อนหลังกับหุ้น และกฎใกล้เคียงที่สุด (sweep + volume profile บนทองคำกราฟ 1 ชั่วโมง) ขาดทุนทุกช่วงที่ทดสอบ — ใช้ดูประกอบ ไม่ใช่เหตุผลให้ซื้อ";

const TITLE_ID = "setup-panel-title";

export function SetupPanel({ result, onClose }: { result: ChartAgentResult; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // The latest callback, so the effect below runs once per open and not on
  // every parent render (it would steal focus and re-lock the scroll).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        className="w-full max-w-5xl rounded-xl border border-(--color-border) bg-(--color-background) shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-(--color-border) p-4">
          <div className="space-y-1 min-w-0">
            <h2 id={TITLE_ID} className="text-lg font-semibold tracking-tight">
              Setup จากกราฟ 5 นาที
            </h2>
            <Header result={result} />
          </div>
          <Button ref={closeRef} variant="outline" size="sm" onClick={onClose} aria-label="ปิด">
            ปิด ✕
          </Button>
        </div>

        <div className="space-y-4 p-4">
          {result.ok ? <Body result={result} /> : <ErrorBody error={result.error} />}
        </div>

        {result.ok && <Footer result={result} />}
      </div>
    </div>
  );
}

function Header({ result }: { result: ChartAgentResult }) {
  return (
    <div className="space-y-1 text-xs text-(--color-muted)">
      {result.ok && (
        <p>
          อ่านเมื่อ {bangkokTime(result.ranAt)} เวลาไทย
          {result.dataAsOf ? ` · ข้อมูลถึง ${bangkokTime(result.dataAsOf)} เวลาไทย` : ""} · {PHASE_LABEL[result.phase]} ·
          แท่งช้า 15 นาที
        </p>
      )}
      <p className="text-amber-400">{NO_BACKTEST_LINE}</p>
    </div>
  );
}

function ErrorBody({ error }: { error: string }) {
  return (
    <Card className="border-rose-500/40 bg-rose-500/5">
      <p className="text-sm font-medium text-rose-400">อ่านกราฟไม่สำเร็จ</p>
      <p className="text-sm break-words">{error}</p>
    </Card>
  );
}

function Body({ result }: { result: Extract<ChartAgentResult, { ok: true }> }) {
  if (result.shown.length === 0) {
    return (
      <Card>
        <p className="text-sm font-medium">วันนี้ไม่มี setup</p>
        {/* Out of hours every ticker carries the same reason; say it once up here. */}
        {result.none.length > 0 && result.phase !== "open" && (
          <p className="mt-1 text-xs text-(--color-muted)">{result.none[0].reason}</p>
        )}
      </Card>
    );
  }
  return (
    <>
      {result.shown.map((s) => (
        <SetupCard key={s.setup.ticker} shown={s} />
      ))}
    </>
  );
}

function advisorHref(setup: Setup): string {
  const q = new URLSearchParams({
    ticker: setup.ticker,
    entry: setup.entry.toFixed(2),
    stop: setup.stop.toFixed(2),
  });
  return `/advisor?${q.toString()}`;
}

function SetupCard({ shown }: { shown: ShownSetup }) {
  const { setup, review, bars } = shown;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-base font-semibold">{setup.ticker}</span>
          <span className="text-xs text-(--color-muted)">กวาด {setup.sweptLevels.join(", ")}</span>
        </div>
        <Link href={advisorHref(setup)} className="text-xs text-(--color-accent) hover:underline">
          → Advisor
        </Link>
      </div>

      <SetupChart setup={setup} bars={bars} />

      <PriceTable setup={setup} />

      {setup.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {setup.tags.map((t) => (
            <Badge key={t} tone="neutral">
              {t}
            </Badge>
          ))}
        </div>
      )}

      <Reading review={review} />
    </Card>
  );
}

function PriceTable({ setup }: { setup: Setup }) {
  const rows: { label: string; price: number; names: string; r: string }[] = [
    { label: "Entry", price: setup.entry, names: "", r: "—" },
    { label: "Stop", price: setup.stop, names: "", r: "—" },
    { label: "T1", price: setup.t1.price, names: setup.t1.names.join(" + "), r: fmtNumber(setup.t1.r, 2) },
  ];
  if (setup.t2) {
    rows.push({ label: "T2", price: setup.t2.price, names: setup.t2.names.join(" + "), r: fmtNumber(setup.t2.r, 2) });
  }
  return (
    <table className="w-full max-w-md text-sm">
      <thead>
        <tr className="text-left text-xs text-(--color-muted) border-b border-(--color-border)">
          <th className="py-1 pr-3 font-medium" />
          <th className="py-1 pr-3 font-medium text-right">ราคา</th>
          <th className="py-1 pr-3 font-medium">ระดับ</th>
          <th className="py-1 font-medium text-right">R</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-b border-(--color-border) last:border-b-0">
            <td className="py-1 pr-3 font-medium">{r.label}</td>
            <td className="py-1 pr-3 text-right font-mono tabular-nums">{fmtMoney(r.price)}</td>
            <td className="py-1 pr-3 text-xs text-(--color-muted)">{r.names || "—"}</td>
            <td className="py-1 text-right font-mono tabular-nums">{r.r}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Reading({ review }: { review: Review }) {
  if (review.status === "kept" && review.reading) {
    return <p className="text-sm leading-relaxed whitespace-pre-line">{review.reading}</p>;
  }
  const reason = review.reason ?? (review.status === "kept" ? "AI ไม่ได้ให้คำอ่าน" : "AI ไม่ได้อ่าน");
  return <p className="text-xs text-(--color-muted)">{reason}</p>;
}

function Footer({ result }: { result: Extract<ChartAgentResult, { ok: true }> }) {
  const hasContent =
    result.rejected.length > 0 || result.none.length > 0 || result.aiNote !== null || result.logNote !== null;
  if (!hasContent) return null;
  return (
    <details className="border-t border-(--color-border) p-4 text-xs text-(--color-muted)">
      <summary className="cursor-pointer select-none">
        รายละเอียดที่ไม่ได้แสดง (ตัดออก {result.rejected.length} · ไม่มี setup {result.none.length})
      </summary>
      <div className="mt-3 space-y-3">
        {result.rejected.length > 0 && (
          <div className="space-y-1">
            <p className="font-medium">ตัดออก</p>
            <ul className="space-y-0.5">
              {result.rejected.map((r) => (
                <li key={r.ticker}>
                  <span className="font-mono">{r.ticker}</span> — {r.review.reason ?? "—"}
                </li>
              ))}
            </ul>
          </div>
        )}
        {result.none.length > 0 && (
          <div className="space-y-1">
            <p className="font-medium">ไม่มี setup</p>
            <ul className="space-y-0.5">
              {result.none.map((n) => (
                <li key={n.ticker}>
                  <span className="font-mono">{n.ticker}</span> — {n.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        {result.aiNote !== null && <p>{result.aiNote}</p>}
        {result.logNote !== null && <p>{result.logNote}</p>}
      </div>
    </details>
  );
}
