"use client";

// The owner's holdings and an on-demand risk analysis. Risk display only:
// nothing here says to buy, sell, trim or rebalance.

import { useEffect, useState } from "react";

import { Badge, Button, Card, CardTitle, Empty, Stat } from "@/components/ui";
import { earningsPhrase } from "@/lib/advisor/earningsPhrase";
import type { PortfolioAnalysis } from "@/lib/portfolioRisk/analysis";
import type { HoldingRow } from "@/lib/portfolioRisk/store";
import { fmtMoney, fmtNumber } from "@/lib/utils";


const FOOTER = "ข้อมูลความเสี่ยงเท่านั้น ไม่ใช่คำแนะนำให้ซื้อหรือขาย";

const inputCls = "w-full rounded-md border border-(--color-border) bg-(--color-card) px-3 py-2 text-sm text-(--color-foreground)";

const pct = (f: number | null | undefined, digits = 1) => (f == null || !Number.isFinite(f) ? "—" : `${(f * 100).toFixed(digits)}%`);
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${fmtMoney(Math.abs(n))}`;

function ictTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? `${d.toLocaleString("sv-SE", { timeZone: "Asia/Bangkok" }).slice(0, 16)} ICT` : "";
}

const MISSING_LABEL: Record<PortfolioAnalysis["missing"][number]["what"], string> = {
  price: "ไม่มีราคา",
  profile: "ไม่ทราบกลุ่ม",
  earnings: "ดึงวันประกาศงบไม่ได้",
  beta: "คำนวณ beta ไม่ได้",
};

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-(--color-muted)">{label}</span>
      <input className={inputCls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function PortfolioPanel() {
  const [holdings, setHoldings] = useState<HoldingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ ticker: "", shares: "", avgCost: "", note: "" });
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/portfolio/holdings")
      .then((r) => r.json())
      .then((j: { ok: boolean; holdings?: HoldingRow[]; error?: string }) => (j.ok ? setHoldings(j.holdings ?? []) : setError(j.error ?? "error")))
      .catch((e) => setError(String(e)));
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/portfolio/holdings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const j = (await r.json()) as { ok: boolean; holdings?: HoldingRow[]; error?: string };
      if (!j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setHoldings(j.holdings ?? []);
      setForm({ ticker: "", shares: "", avgCost: "", note: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(ticker: string) {
    if (!window.confirm(`ลบ ${ticker} ออกจากพอร์ต?`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/portfolio/holdings?ticker=${encodeURIComponent(ticker)}`, { method: "DELETE" });
      const j = (await r.json()) as { ok: boolean; holdings?: HoldingRow[]; error?: string };
      if (!j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setHoldings(j.holdings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function analyse() {
    setAnalysing(true);
    setAnalysisError(null);
    try {
      const r = await fetch("/api/portfolio/analysis");
      const j = (await r.json()) as { ok: boolean; analysis?: PortfolioAnalysis | null; error?: string };
      if (!j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setAnalysis(j.analysis ?? null);
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalysing(false);
    }
  }

  const costBasis = (holdings ?? []).reduce((s, h) => s + h.shares * h.avgCost, 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>หุ้นที่ถืออยู่ ({holdings?.length ?? 0} ตัว · ทุนรวม {fmtMoney(costBasis)})</CardTitle>
        {error && <p className="text-xs text-amber-400 mb-2">{error}</p>}
        {holdings == null ? (
          <p className="text-xs text-(--color-muted)">กำลังโหลด…</p>
        ) : holdings.length === 0 ? (
          <Empty title="ยังไม่มีหุ้นในพอร์ต" hint="เพิ่มจากฟอร์มด้านล่าง" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-(--color-muted)">
                <tr>
                  <th className="pr-3 py-1">หุ้น</th>
                  <th className="pr-3">จำนวนหุ้น</th>
                  <th className="pr-3">ทุนต่อหุ้น</th>
                  <th className="pr-3">ทุนรวม</th>
                  <th className="pr-3">หมายเหตุ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => (
                  <tr key={h.ticker} className="border-t border-(--color-border)">
                    <td className="pr-3 py-1 font-semibold">{h.ticker}</td>
                    <td className="pr-3">{fmtNumber(h.shares, 7)}</td>
                    <td className="pr-3">{fmtMoney(h.avgCost)}</td>
                    <td className="pr-3">{fmtMoney(h.shares * h.avgCost)}</td>
                    <td className="pr-3 text-(--color-muted)">{h.note}</td>
                    <td className="text-right space-x-2 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setForm({ ticker: h.ticker, shares: String(h.shares), avgCost: String(h.avgCost), note: h.note })}
                      >
                        แก้
                      </Button>
                      <Button size="sm" variant="danger" disabled={busy} onClick={() => remove(h.ticker)}>
                        ลบ
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
          <Field label="หุ้น" value={form.ticker} onChange={(v) => setForm({ ...form, ticker: v })} placeholder="NVDA" />
          <Field label="จำนวนหุ้น (เศษหุ้นได้)" value={form.shares} onChange={(v) => setForm({ ...form, shares: v })} />
          <Field label="ทุนต่อหุ้น (USD)" value={form.avgCost} onChange={(v) => setForm({ ...form, avgCost: v })} />
          <Field label="หมายเหตุ" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />
        </div>
        <p className="text-xs text-(--color-muted) mt-2">ใส่หุ้นที่มีอยู่แล้วจะเป็นการแก้ตัวเลขของตัวนั้น</p>
        <Button className="mt-3" disabled={busy || !form.ticker} onClick={save}>
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </Button>
      </Card>

      {holdings && holdings.length > 0 && (
        <Card>
          <CardTitle>วิเคราะห์ความเสี่ยงของพอร์ต</CardTitle>
          <Button disabled={analysing} onClick={analyse}>
            {analysing ? "กำลังวิเคราะห์ อาจใช้เวลาประมาณ 1 นาที…" : "วิเคราะห์ความเสี่ยง"}
          </Button>
          {analysisError && <p className="text-xs text-amber-400 mt-2">วิเคราะห์ไม่สำเร็จ: {analysisError}</p>}
          {analysis && <AnalysisView a={analysis} />}
        </Card>
      )}

    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function AnalysisView({ a }: { a: PortfolioAnalysis }) {
  const cost = a.rows.reduce((s, r) => s + r.cost, 0);
  const pnl = a.total - cost;
  return (
    <div className="mt-4 space-y-6 text-sm">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="มูลค่าพอร์ต" value={fmtMoney(a.total)} />
        <Stat label="กำไร/ขาดทุนยังไม่ขาย" value={signed(pnl)} sub={pct(cost > 0 ? pnl / cost : null)} />
        <Stat label="3 ตัวใหญ่สุดรวมกัน" value={pct(a.top3Share)} />
        <Stat label="beta ของพอร์ต (เทียบ SPY)" value={a.market.beta == null ? "—" : fmtNumber(a.market.beta, 2)} />
      </div>

      <Section title="1. น้ำหนักแต่ละตัว">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-(--color-muted)">
              <tr>
                <th className="pr-3 py-1">หุ้น</th>
                <th className="pr-3">ราคา</th>
                <th className="pr-3">มูลค่า</th>
                <th className="pr-3">กำไร/ขาดทุน</th>
                <th className="pr-3">% ของพอร์ต</th>
                <th className="pr-3">beta</th>
                <th className="pr-3">กลุ่ม</th>
              </tr>
            </thead>
            <tbody>
              {a.rows.map((r) => (
                <tr key={r.ticker} className="border-t border-(--color-border) align-top">
                  <td className="pr-3 py-1 font-semibold">{r.ticker}</td>
                  <td className="pr-3">
                    {fmtMoney(r.price)}
                    <div className="text-(--color-muted)">
                      {r.priceSource === "live" ? ictTime(r.priceAt) : `ราคาปิด ${r.priceAt?.slice(0, 10) ?? ""}`}
                    </div>
                  </td>
                  <td className="pr-3">{fmtMoney(r.value)}</td>
                  <td className={`pr-3 ${r.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {signed(r.pnl)} ({pct(r.pnlPct)})
                  </td>
                  <td className="pr-3">{r.flagged ? <Badge tone="warning">{pct(r.weight)}</Badge> : pct(r.weight)}</td>
                  <td className="pr-3">{r.beta == null ? "—" : fmtNumber(r.beta, 2)}</td>
                  <td className="pr-3 text-(--color-muted)">{r.kind === "etf" ? "ETF / กองทุน" : (r.industry ?? "ยังไม่ทราบกลุ่ม")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {a.unpriced.length > 0 && <p className="text-xs text-amber-400">ไม่มีราคา จึงไม่ได้นับ: {a.unpriced.join(", ")}</p>}
        <p className="text-xs text-(--color-muted)">ป้ายสีเหลือง = ตัวเดียวตั้งแต่ 20% ของพอร์ตขึ้นไป</p>
      </Section>

      <Section title="2. กลุ่มอุตสาหกรรม">
        <ul className="space-y-1 text-xs">
          {a.industries.map((b) => (
            <li key={`${b.kind}|${b.label}`} className="flex flex-wrap gap-2 items-center">
              {b.flagged ? <Badge tone="warning">{pct(b.weight)}</Badge> : <span className="w-12">{pct(b.weight)}</span>}
              <span className="font-medium">{b.label}</span>
              <span className="text-(--color-muted)">{b.tickers.join(", ")}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-(--color-muted)">ป้ายสีเหลือง = กลุ่มเดียวตั้งแต่ 30% ขึ้นไป (ไม่นับกลุ่ม ETF / กองทุน)</p>
      </Section>

      <Section title="3. หุ้นที่ขึ้นลงไปด้วยกัน (60 วัน, ความสัมพันธ์ ≥ 0.75)">
        {a.clusters.length === 0 ? (
          <p className="text-xs text-(--color-muted)">ไม่มีกลุ่มที่ขึ้นลงไปด้วยกันแรงถึงเกณฑ์</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {a.clusters.map((c) => (
              <li key={c.members.join(",")} className="flex flex-wrap gap-2 items-center">
                {c.flagged ? <Badge tone="warning">{pct(c.weight)}</Badge> : <span className="w-12">{pct(c.weight)}</span>}
                <span className="font-medium">{c.members.join(", ")}</span>
                <span className="text-(--color-muted)">
                  คู่ที่ไปด้วยกันมากสุด {c.strongest.a}–{c.strongest.b} ({fmtNumber(c.strongest.r, 2)})
                  {c.weakest && c.members.length > 2 && ` · คู่ที่ห่างที่สุดในกลุ่ม ${c.weakest.a}–${c.weakest.b} (${fmtNumber(c.weakest.r, 2)})`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-(--color-muted)">
          ป้ายสีเหลือง = กลุ่มรวมกันตั้งแต่ 30% ของพอร์ตขึ้นไป · ไม่นับ ETF / กองทุน (กองทุนขึ้นลงตามตลาดอยู่แล้ว ดูในหัวข้อ 4) · หุ้นในกลุ่มเดียวกันเชื่อมกันเป็นทอด ๆ ไม่ใช่ทุกคู่จะไปด้วยกันแรงเท่ากัน
        </p>
      </Section>

      <Section title="4. ถ้าตลาดลง">
        {a.market.scenarioPct == null ? (
          <p className="text-xs text-amber-400">คำนวณไม่ได้: ไม่มีหุ้นตัวไหนมีประวัติราคาพอคำนวณ beta</p>
        ) : (
          <p>
            ถ้า S&amp;P 500 ลง 10%{" "}
            {a.market.coverage != null && a.market.coverage < 0.999 ? `ส่วนที่วัดได้ (${pct(a.market.coverage)} ของพอร์ต)` : "พอร์ต"}{" "}
            น่าจะลงประมาณ <span className="font-semibold">{pct(Math.abs(a.market.scenarioPct))}</span> (≈{" "}
            {fmtMoney(Math.abs(a.market.scenarioUsd))})
          </p>
        )}
        {a.market.excluded.length > 0 && (
          <p className="text-xs text-amber-400">
            ไม่ได้นับ (ประวัติราคาไม่พอคำนวณ beta): {a.market.excluded.join(", ")} · มูลค่า {fmtMoney(a.market.excludedValue)}
          </p>
        )}
        <p className="text-xs text-(--color-muted)">ประมาณจากความผันผวนเทียบ SPY ย้อนหลัง 1 ปี ไม่ใช่การทำนาย</p>
      </Section>

      <Section title="5. ประกาศงบใน 14 วันข้างหน้า">
        {a.earnings.length === 0 ? (
          <p className="text-xs text-(--color-muted)">ไม่มีหุ้นในพอร์ตที่ประกาศงบใน 14 วันข้างหน้า</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {a.earnings.map((e) => (
              <li key={e.ticker}>
                <span className="font-semibold">{e.ticker}</span> · {earningsPhrase({ date: e.date, hour: e.hour }, a.asOf)} · เคยเปิดกระโดดลงแรงสุดในรอบปี{" "}
                {e.worstGapPct == null ? "— (ข้อมูลไม่พอ)" : `−${pct(e.worstGapPct)}`}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {a.missing.length > 0 && (
        <Section title="ข้อมูลที่ดึงไม่ได้">
          <ul className="space-y-0.5 text-xs text-amber-400">
            {a.missing.map((m) => (
              <li key={`${m.ticker}|${m.what}`}>
                {m.ticker}: {MISSING_LABEL[m.what]} — {m.reason}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="text-xs text-(--color-muted)">
        {FOOTER} · ข้อมูล ณ {a.asOf} (เวลานิวยอร์ก)
      </p>
    </div>
  );
}
