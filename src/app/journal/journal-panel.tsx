"use client";

import { useEffect, useState } from "react";

import { Badge, Button, Card, CardTitle, Empty, Stat } from "@/components/ui";
import { readNav } from "@/lib/portfolio/evaluate";
import { realizedR } from "@/lib/portfolio/journalInput";
import { DEFAULT_PORTFOLIO_CONFIG } from "@/lib/portfolio/types";
import { fmtMoney, fmtNumber } from "@/lib/utils";

interface TradeRow {
  id: number;
  ticker: string;
  sector: string;
  shares: number;
  entryPrice: number;
  entryDate: string;
  stop: number;
  worstLossR: number | null;
  exitPrice: number | null;
  exitDate: string | null;
  note: string;
}
interface NavRow {
  date: string;
  nav: number;
  cash: number | null;
  note: string;
}
interface OverrideRow {
  id: number;
  ticker: string;
  gate: string;
  severity: string;
  message: string;
  reason: string;
  createdAt: string;
}
interface Snapshot {
  open: TradeRow[];
  closed: TradeRow[];
  nav: NavRow[];
  overrides: OverrideRow[];
}

/** Local calendar date, YYYY-MM-DD. The module never reads a clock; the page supplies it. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const inputCls = "w-full rounded-md border border-(--color-border) bg-(--color-card) px-3 py-2 text-sm text-(--color-foreground)";

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-(--color-muted)">{label}</span>
      <input className={inputCls} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function JournalPanel() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = localToday();

  const [navDate, setNavDate] = useState(today);
  const [nav, setNav] = useState("");
  const [cash, setCash] = useState("");

  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [stop, setStop] = useState("");
  const [entryDate, setEntryDate] = useState(today);
  const [note, setNote] = useState("");

  const [closing, setClosing] = useState<Record<number, { exitPrice: string; exitDate: string }>>({});

  useEffect(() => {
    fetch("/api/journal")
      .then((r) => r.json())
      .then((j) => (j.ok ? setData(j) : setError(j.error)))
      .catch((e) => setError(String(e)));
  }, []);

  async function post(payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/journal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error);
        return false;
      }
      setData(j);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const navState = data ? readNav(data.nav, today, DEFAULT_PORTFOLIO_CONFIG.navStaleDays) : null;
  const cfg = DEFAULT_PORTFOLIO_CONFIG;

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-rose-400 border border-rose-500/30 rounded-md px-4 py-2">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="มูลค่าพอร์ตล่าสุด (NAV)"
          value={navState?.nav != null ? fmtMoney(navState.nav) : "ไม่ทราบ"}
          sub={navState?.unknownReason ?? (data?.nav.length ? `บันทึกล่าสุด ${data.nav[data.nav.length - 1].date}` : undefined)}
          subColor={navState?.unknownReason ? "text-amber-400" : undefined}
        />
        <Stat
          label="Drawdown จากจุดสูงสุด"
          value={navState?.peakDrawdownPct != null ? `${fmtNumber(navState.peakDrawdownPct, 1)}%` : "—"}
          sub={`ลดขนาดครึ่งที่ ${cfg.drawdownHalfSizePct}% · หยุดเปิดใหม่ที่ ${cfg.drawdownSafeModePct}%`}
          subColor={
            navState?.peakDrawdownPct != null && navState.peakDrawdownPct >= cfg.drawdownHalfSizePct ? "text-rose-400" : undefined
          }
        />
        <Stat
          label="เปลี่ยนจากบันทึกก่อนหน้า"
          value={navState?.dailyDropPct != null ? `-${fmtNumber(navState.dailyDropPct, 1)}%` : "—"}
          sub={`หยุดเปิดใหม่วันนั้นถ้าลด ≥ ${cfg.dailyDrawdownStopPct}%`}
        />
      </div>

      <Card>
        <CardTitle>บันทึกมูลค่าพอร์ตวันนี้</CardTitle>
        <p className="text-xs text-(--color-muted) mb-3">
          กรอกวันละครั้งจากยอดใน Webull · บันทึกซ้ำวันเดิมจะแทนที่ค่าเก่า · ถ้าไม่บันทึกเกิน {cfg.navStaleDays} วัน gate drawdown จะขึ้น &quot;ไม่ทราบ&quot;
        </p>
        <div className="grid gap-3 sm:grid-cols-4 items-end">
          <Field label="วันที่" type="date" value={navDate} onChange={setNavDate} />
          <Field label="NAV (USD)" value={nav} onChange={setNav} placeholder="2500" />
          <Field label="เงินสด (ไม่บังคับ)" value={cash} onChange={setCash} />
          <Button disabled={busy} onClick={async () => (await post({ action: "nav", date: navDate, nav, cash })) && setNav("")}>
            บันทึก NAV
          </Button>
        </div>
      </Card>

      <Card>
        <CardTitle>บันทึกการเปิดสถานะ (ซื้อด้วยมือ)</CardTitle>
        <p className="text-xs text-(--color-muted) mb-3">
          ระบบดึง sector (ยุบเป็น 11 กลุ่ม GICS) และค่า gap-through แย่สุดย้อนหลัง 2 ปีให้เองตอนบันทึก ถ้าดึงไม่ได้จะเก็บเป็น &quot;ไม่ทราบ&quot;
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="หุ้น" value={ticker} onChange={setTicker} placeholder="NVDA" />
          <Field label="จำนวนหุ้น" value={shares} onChange={setShares} />
          <Field label="ราคาเข้า" value={entryPrice} onChange={setEntryPrice} />
          <Field label="จุดตัดขาดทุน (stop)" value={stop} onChange={setStop} />
          <Field label="วันที่เข้า" type="date" value={entryDate} onChange={setEntryDate} />
          <Field label="หมายเหตุ" value={note} onChange={setNote} />
        </div>
        <Button
          className="mt-3"
          disabled={busy}
          onClick={async () => {
            if (await post({ action: "open", ticker, shares, entryPrice, stop, entryDate, note })) {
              setTicker("");
              setShares("");
              setEntryPrice("");
              setStop("");
              setNote("");
            }
          }}
        >
          {busy ? "กำลังบันทึก…" : "บันทึกการเปิดสถานะ"}
        </Button>
      </Card>

      <Card>
        <CardTitle>สถานะที่ถืออยู่ ({data?.open.length ?? 0} / {cfg.maxSlots} ช่อง)</CardTitle>
        {!data ? (
          <p className="text-sm text-(--color-muted)">กำลังโหลด…</p>
        ) : data.open.length === 0 ? (
          <Empty title="ยังไม่มีสถานะเปิด" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-xs text-(--color-muted) text-left">
                <tr>
                  <th className="py-2 pr-3">หุ้น</th>
                  <th className="pr-3">Sector</th>
                  <th className="pr-3">หุ้น × ราคาเข้า</th>
                  <th className="pr-3">Stop</th>
                  <th className="pr-3">ความเสี่ยง 1R</th>
                  <th className="pr-3">Gap แย่สุด</th>
                  <th>ปิดสถานะ</th>
                </tr>
              </thead>
              <tbody>
                {data.open.map((t) => {
                  const c = closing[t.id] ?? { exitPrice: "", exitDate: today };
                  const set = (patch: Partial<typeof c>) => setClosing((s) => ({ ...s, [t.id]: { ...c, ...patch } }));
                  return (
                    <tr key={t.id} className="border-t border-(--color-border) align-top">
                      <td className="py-2 pr-3 font-medium">{t.ticker}<div className="text-xs text-(--color-muted)">{t.entryDate}</div></td>
                      <td className="pr-3">{t.sector === "Other" ? <Badge tone="warning">ไม่ทราบ</Badge> : t.sector}</td>
                      <td className="pr-3">{t.shares} × {fmtMoney(t.entryPrice)}</td>
                      <td className="pr-3">{fmtMoney(t.stop)}</td>
                      <td className="pr-3">{fmtMoney((t.entryPrice - t.stop) * t.shares)}</td>
                      <td className="pr-3">{t.worstLossR != null ? `${fmtNumber(t.worstLossR, 2)} R` : <Badge tone="warning">ไม่ได้วัด</Badge>}</td>
                      <td>
                        <div className="flex flex-wrap gap-2 items-center">
                          <input className={`${inputCls} w-24`} placeholder="ราคาออก" value={c.exitPrice} onChange={(e) => set({ exitPrice: e.target.value })} />
                          <input className={`${inputCls} w-36`} type="date" value={c.exitDate} onChange={(e) => set({ exitDate: e.target.value })} />
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => post({ action: "close", id: t.id, ...c })}>ปิด</Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busy}
                            onClick={() => window.confirm(`ลบ ${t.ticker} ออกจากสมุด? (ใช้เฉพาะกรณีกรอกผิด)`) && post({ action: "delete", id: t.id })}
                          >
                            ลบ
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>ปิดแล้ว (50 รายการล่าสุด)</CardTitle>
        {!data || data.closed.length === 0 ? (
          <p className="text-sm text-(--color-muted)">ยังไม่มี</p>
        ) : (
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-(--color-muted) text-left">
              <tr><th className="py-2 pr-3">หุ้น</th><th className="pr-3">เข้า → ออก</th><th className="pr-3">ผลลัพธ์</th><th>P&amp;L</th></tr>
            </thead>
            <tbody>
              {data.closed.map((t) => {
                const r = realizedR({ entryPrice: t.entryPrice, stop: t.stop, exitPrice: t.exitPrice! });
                return (
                  <tr key={t.id} className="border-t border-(--color-border)">
                    <td className="py-2 pr-3 font-medium">{t.ticker}</td>
                    <td className="pr-3">{t.entryDate} {fmtMoney(t.entryPrice)} → {t.exitDate} {fmtMoney(t.exitPrice)}</td>
                    <td className={`pr-3 ${r >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{r >= 0 ? "+" : ""}{fmtNumber(r, 2)} R</td>
                    <td>{fmtMoney((t.exitPrice! - t.entryPrice) * t.shares)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <CardTitle>บันทึกการ override gate</CardTitle>
        {!data || data.overrides.length === 0 ? (
          <p className="text-sm text-(--color-muted)">ยังไม่มี</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.overrides.map((o) => (
              <li key={o.id} className="border-t border-(--color-border) pt-2">
                <Badge tone={o.severity === "CRITICAL" ? "negative" : "warning"}>{o.gate}</Badge> <span className="font-medium">{o.ticker}</span>{" "}
                <span className="text-(--color-muted)">{o.message}</span>
                <div className="text-xs mt-1">เหตุผล: {o.reason} · {new Date(o.createdAt).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
