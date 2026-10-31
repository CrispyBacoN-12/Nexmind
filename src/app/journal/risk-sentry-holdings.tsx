"use client";

import { useEffect, useState } from "react";

import { Button, Card, CardTitle } from "@/components/ui";

/**
 * Names Risk Sentry watches on top of the open journal positions — stocks held
 * outside this journal. They get the earnings, 8-K, gate and correlation
 * checks, but no stop check, because nothing here records a stop for them.
 */
export function RiskSentryHoldings() {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/risk-sentry/holdings")
      .then((r) => r.json())
      .then((j: { holdings?: string[] }) => {
        setSaved(j.holdings ?? []);
        setText((j.holdings ?? []).join(", "));
      })
      .catch((e) => setError(String(e)));
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/risk-sentry/holdings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdings: text.split(/[\s,]+/).filter(Boolean) }),
      });
      const j = (await res.json()) as { holdings?: string[]; error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setSaved(j.holdings ?? []);
      setText((j.holdings ?? []).join(", "));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 space-y-2">
      <CardTitle>หุ้นที่ Risk Sentry เฝ้าเพิ่ม</CardTitle>
      <p className="text-xs text-(--color-muted)">
        สถานะเปิดในสมุดนี้ถูกเฝ้าอัตโนมัติอยู่แล้ว ใส่เฉพาะหุ้นที่ถือนอกสมุด (คั่นด้วยจุลภาค) · ได้การเตือนงบ, 8-K,
        ประตูตลาด และสหสัมพันธ์ แต่ไม่มีการเช็ค stop เพราะไม่มี stop บันทึกไว้
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="AAPL, MSFT"
        className="w-full rounded-md border border-(--color-border) bg-(--color-card) px-3 py-2 text-sm font-mono"
      />
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" disabled={busy || saved == null} onClick={save}>
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </Button>
        {saved != null ? (
          <span className="text-xs text-(--color-muted)">บันทึกไว้ {saved.length} ตัว{saved.length ? `: ${saved.join(", ")}` : ""}</span>
        ) : null}
        {error ? <span className="text-xs text-rose-400">{error}</span> : null}
      </div>
    </Card>
  );
}
