"use client";

// The portfolio gates on the advisor card: does THIS ticket fit the book in
// the journal? It fires on mount (remounted per card, like AdvisorCritique)
// and is decoration in the same sense: if it fails, the card above is still
// correct. A red gate can be passed only with a written reason, and pressing
// confirm writes each reason to the GateOverride audit log.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Badge, Button, Card, CardTitle, Stat } from "@/components/ui";
import type { AdvisorCard } from "@/lib/advisor/types";
import type { GateName, GateSeverity, PortfolioEvaluationOutput } from "@/lib/portfolio/types";
import { fmtMoney, fmtNumber, fmtPct } from "@/lib/utils";

type Evaluation = PortfolioEvaluationOutput & {
  ok: true;
  sector: string;
  committed: number;
};

const GATE_LABEL: Record<GateName, string> = {
  CAPACITY: "จำนวนสล็อต",
  SECTOR: "กระจุกตัวในเซกเตอร์",
  CORRELATION: "สหสัมพันธ์กับของที่ถืออยู่",
  REGIME: "สภาวะตลาด (SPY เทียบ SMA200)",
  DRAWDOWN: "Drawdown ของพอร์ต",
  GAP_HEAT: "ความเสี่ยงหางจาก gap ข้ามคืน",
};

const SEVERITY_TONE: Record<GateSeverity, "positive" | "warning" | "negative"> = {
  OK: "positive",
  WARN: "warning",
  CRITICAL: "negative",
};

const fmtValue = (v: number | string) => (typeof v === "number" ? fmtNumber(v, 2) : v);

export function PortfolioGates({ card }: { card: AdvisorCard }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Evaluation | null>(null);
  const [reasons, setReasons] = useState<Partial<Record<GateName, string>>>({});
  const firedRef = useRef(false);

  async function run(commit: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: card.ticker,
          entry: card.entry,
          stop: card.stop,
          baseShares: card.sizing.shares,
          worstLossR: card.gapRisk?.worstLossR ?? null,
          overrides: reasons,
          commit,
        }),
      });
      const json = (await res.json().catch(() => null)) as Evaluation | { ok: false; error: string } | null;
      if (json === null) setError(`เซิร์ฟเวอร์ตอบกลับ HTTP ${res.status} ด้วยข้อมูลที่หน้านี้อ่านไม่ได้`);
      else if (!json.ok) setError(json.error);
      else setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const failed = result?.gates.filter((g) => !g.passed) ?? [];
  const reasonsFilled = failed.every((g) => reasons[g.gate]?.trim());

  return (
    <div className="space-y-3">
      <Card className="p-5 space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle>ด่านตรวจพอร์ต · ไม้นี้เข้ากับพอร์ตใน Journal ได้ไหม</CardTitle>
          <Button type="button" variant="ghost" onClick={() => void run(false)} disabled={loading}>
            {loading ? "กำลังตรวจ…" : "ตรวจอีกครั้ง"}
          </Button>
        </div>

        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        {!result && loading ? <p className="text-sm text-(--color-muted)">กำลังอ่าน Journal, NAV และราคาตลาด…</p> : null}
      </Card>

      {result ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="NAV ล่าสุด" value={result.nav != null ? fmtMoney(result.nav) : "ไม่มีข้อมูล"} sub={`เซกเตอร์: ${result.sector}`} />
            <Stat
              label="Heat หลังเข้าไม้นี้"
              value={result.nominalHeatPctAfter != null ? fmtPct(result.nominalHeatPctAfter) : "—"}
              sub={result.nominalHeatRAfter != null ? `${fmtNumber(result.nominalHeatRAfter, 1)}R ถ้าทุกตัวโดนสต็อป` : undefined}
            />
            <Stat
              label="Tail heat (gap แย่สุด)"
              value={result.tailRiskGapHeatPctAfter != null ? fmtPct(result.tailRiskGapHeatPctAfter) : "—"}
              sub={
                result.tailRiskGapHeatRAfter != null ? `${fmtNumber(result.tailRiskGapHeatRAfter, 1)}R ถ้าทุกตัว gap พร้อมกัน` : undefined
              }
            />
            <Stat
              label="จำนวนหุ้นที่แนะนำ"
              value={fmtNumber(result.suggestedShares, 0)}
              sub={
                result.sizeMultiplier < 1
                  ? `ลดจาก ${card.sizing.shares} (×${result.sizeMultiplier} จาก drawdown)`
                  : `ตามการ์ด ${card.sizing.shares}`
              }
              subColor={result.sizeMultiplier < 1 ? "text-amber-500" : undefined}
            />
          </div>

          <Card className="p-5 space-y-4">
            {result.gapUnmeasured.length > 0 ? (
              <p className="text-xs text-(--color-muted)">
                วัด gap ไม่ได้สำหรับ {result.gapUnmeasured.join(", ")} — นับเป็น 1R ซึ่งเป็นค่าต่ำสุด tail heat จริงอาจสูงกว่านี้
              </p>
            ) : null}

            <ul className="space-y-3">
              {result.gates.map((g) => (
                <li key={g.gate} className="rounded-md border border-(--color-border) p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone={SEVERITY_TONE[g.severity]}>
                      {g.passed ? "ผ่าน" : g.severity === "CRITICAL" ? "ไม่ผ่าน" : "ไม่ผ่าน (ข้อมูลไม่พอ)"}
                    </Badge>
                    {g.overridden ? <Badge tone="info">override แล้ว</Badge> : null}
                    <span className="font-medium">{GATE_LABEL[g.gate]}</span>
                    <span className="text-(--color-muted)">
                      ค่าปัจจุบัน {fmtValue(g.currentValue)} · เกณฑ์ {fmtValue(g.threshold)}
                    </span>
                  </div>
                  <p className="text-xs text-(--color-muted)">{g.message}</p>
                  {!g.passed ? (
                    <textarea
                      className="w-full rounded-md border border-(--color-border) bg-(--color-card) px-3 py-2 text-sm"
                      rows={2}
                      placeholder="เหตุผลที่จะเข้าไม้นี้ทั้งที่ด่านนี้ไม่ผ่าน (จะถูกบันทึกไว้ตรวจย้อนหลัง)"
                      value={reasons[g.gate] ?? ""}
                      onChange={(e) => setReasons((r) => ({ ...r, [g.gate]: e.target.value }))}
                    />
                  ) : null}
                  {!g.passed && g.gate === "DRAWDOWN" && result.sizeMultiplier < 1 ? (
                    <p className="text-xs text-amber-500">override ด่านนี้ไม่ยกเลิกการลดขนาดครึ่งหนึ่ง — จำนวนหุ้นยังถูกลดอยู่</p>
                  ) : null}
                </li>
              ))}
            </ul>

            {result.canExecute && failed.length === 0 ? (
              <p className="text-sm">
                <Badge tone="positive">พร้อมส่งคำสั่ง</Badge> ทุกด่านผ่าน · เข้าแล้วบันทึกไม้ใน{" "}
                <Link className="underline" href="/journal">
                  Journal
                </Link>
              </p>
            ) : result.committed > 0 ? (
              <p className="text-sm">
                <Badge tone="positive">ปลดล็อกแล้ว</Badge> บันทึก override {result.committed} ด่าน · เข้าแล้วบันทึกไม้ใน{" "}
                <Link className="underline" href="/journal">
                  Journal
                </Link>
              </p>
            ) : result.suggestedShares === 0 ? (
              <p className="text-sm text-(--color-muted)">จำนวนหุ้นเป็น 0 — ไม่มีอะไรให้ปลดล็อก</p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => void run(true)} disabled={loading || !reasonsFilled}>
                  ยืนยันเข้าไม้และบันทึกเหตุผล
                </Button>
                <span className="text-xs text-(--color-muted)">
                  {reasonsFilled ? "ทุกด่านที่ไม่ผ่านมีเหตุผลแล้ว" : `ต้องเขียนเหตุผลให้ครบ ${failed.length} ด่านก่อน`}
                </span>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
