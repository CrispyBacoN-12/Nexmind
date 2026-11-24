"use client";

// Support/resistance zones for every holding and for any ticker. Descriptive
// only: where price has turned or traded heavily, never "buy/sell here".

import { useState } from "react";

import { Badge, Button, Card, CardTitle } from "@/components/ui";
import type { LevelsResult, Zone } from "@/lib/levels/levels";
import { fmtMoney } from "@/lib/utils";

import { LevelsChart, type SeriesPoint } from "./levels-chart";

const FOOTER =
  "แสดงว่าราคาเคยกลับตัวหรือซื้อขายหนาแน่นตรงไหน ไม่ได้บอกว่าแนวจะรับหรือต้านได้ ข้อมูลประกอบการตัดสินใจเท่านั้น · ราคาย้อนหลังปรับปันผลแล้ว";

const inputCls = "rounded-md border border-(--color-border) bg-(--color-card) px-3 py-2 text-sm text-(--color-foreground)";

interface Row {
  ticker: string;
  held: boolean;
  avgCost: number | null;
  result: LevelsResult | { note: "noData" };
  series?: SeriesPoint[];
}

const day = (t: number | null) => (t == null ? "" : new Date(t * 1000).toISOString().slice(0, 10));
const dist = (z: Zone, price: number) => {
  const ref = z.high < price ? z.high : z.low > price ? z.low : price;
  const pct = ((ref - price) / price) * 100;
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;
};
const range = (z: Zone) => `${fmtMoney(z.low)}–${fmtMoney(z.high)}`;

function ZoneText({ z, price }: { z: Zone; price: number }) {
  return (
    <span>
      {range(z)} <span className="text-(--color-muted)">({dist(z, price)})</span>
    </span>
  );
}

function evidence(z: Zone): string {
  const parts: string[] = [];
  if (z.touches > 0) parts.push(`จุดกลับตัว ${z.touches} ครั้ง · ล่าสุด ${day(z.lastTouch)}`);
  if (z.volumeShare > 0) parts.push(`ซื้อขายหนาแน่น ${(z.volumeShare * 100).toFixed(0)}%`);
  return parts.join(" · ");
}

function NoneText({ side }: { side: "support" | "resistance" }) {
  return (
    <span className="text-(--color-muted)">
      {side === "resistance" ? "ไม่มีแนวต้านในช่วง 2 ปี (ราคาใกล้จุดสูงสุด)" : "ไม่มีแนวรับในช่วง 2 ปี (ราคาใกล้จุดต่ำสุด)"}
    </span>
  );
}

function Detail({ row }: { row: Row & { result: LevelsResult } }) {
  const r = row.result;
  const zones = [...r.allZones].sort((a, b) => b.mid - a.mid);
  return (
    <div className="mt-2 space-y-3 text-xs">
      {row.series && row.series.length > 1 ? (
        <LevelsChart series={row.series} zones={r.allZones} price={r.price} avgCost={row.avgCost} />
      ) : (
        <p className="text-(--color-muted)">กำลังโหลดกราฟ…</p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-(--color-muted)">
        <span>MA50 {r.ma50 == null ? "—" : fmtMoney(r.ma50)}</span>
        <span>MA200 {r.ma200 == null ? "—" : fmtMoney(r.ma200)}</span>
        <span>สูงสุด 52 สัปดาห์ {r.high52 == null ? "—" : fmtMoney(r.high52)}</span>
        <span>ต่ำสุด 52 สัปดาห์ {r.low52 == null ? "—" : fmtMoney(r.low52)}</span>
        {row.avgCost != null && <span>ทุนของคุณ {fmtMoney(row.avgCost)}</span>}
      </div>
      <ul className="space-y-1">
        {zones.map((z) => {
          const side = z.high < r.price ? "แนวรับ" : z.low > r.price ? "แนวต้าน" : "ราคาอยู่ในโซน";
          return (
            <li key={`${z.low}-${z.high}`} className="flex flex-wrap items-center gap-2">
              <Badge tone={side === "แนวรับ" ? "positive" : side === "แนวต้าน" ? "negative" : "warning"}>{side}</Badge>
              <ZoneText z={z} price={r.price} />
              <span className="text-(--color-muted)">{evidence(z)}</span>
              {z.stale && <Badge>เก่า (ล่าสุด {day(z.lastTouch)})</Badge>}
              {row.avgCost != null && <span className="text-(--color-muted)">{z.mid >= row.avgCost ? "เหนือทุน" : "ใต้ทุน"}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RowView({ row, onExpand, open }: { row: Row; onExpand: () => void; open: boolean }) {
  const r = row.result;
  if (!("price" in r)) {
    return (
      <tr className="border-t border-(--color-border)">
        <td className="pr-3 py-1 font-semibold">{row.ticker}</td>
        <td colSpan={4} className="text-(--color-muted)">
          ไม่พบข้อมูลราคา
        </td>
      </tr>
    );
  }
  return (
    <>
      <tr className="border-t border-(--color-border) align-top cursor-pointer hover:bg-(--color-border)/20" onClick={onExpand}>
        <td className="pr-3 py-1 font-semibold">
          {open ? "▾" : "▸"} {row.ticker}
        </td>
        <td className="pr-3">
          {fmtMoney(r.price)}
          <div className="text-(--color-muted)">{r.forming ? <Badge tone="info">ระหว่างวัน</Badge> : day(r.priceT)}</div>
        </td>
        {r.note === "shortHistory" ? (
          <td colSpan={2} className="pr-3 text-(--color-muted)">
            ประวัติราคาไม่พอ
          </td>
        ) : (
          <>
            <td className="pr-3">{r.support[0] ? <ZoneText z={r.support[0]} price={r.price} /> : <NoneText side="support" />}</td>
            <td className="pr-3">{r.resistance[0] ? <ZoneText z={r.resistance[0]} price={r.price} /> : <NoneText side="resistance" />}</td>
          </>
        )}
        <td>{r.inZone && <Badge tone="warning">ราคาอยู่ในโซน</Badge>}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="pb-3">
            <Detail row={row as Row & { result: LevelsResult }} />
          </td>
        </tr>
      )}
    </>
  );
}

export function LevelsSection() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [ticker, setTicker] = useState("");

  async function load(url: string): Promise<Row[]> {
    const r = await fetch(url);
    const j = (await r.json()) as { ok: boolean; rows?: Row[]; error?: string };
    if (!j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j.rows ?? [];
  }

  async function computeAll() {
    setBusy(true);
    setError(null);
    try {
      setRows(await load("/api/portfolio/levels"));
      setOpen(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function expand(t: string) {
    if (open === t) return setOpen(null);
    setOpen(t);
    const current = rows?.find((x) => x.ticker === t);
    if (current?.series) return;
    try {
      const [withSeries] = await load(`/api/portfolio/levels?ticker=${encodeURIComponent(t)}&series=1`);
      setRows((prev) => (prev ?? []).map((x) => (x.ticker === t ? withSeries : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function lookUp() {
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      const [row] = await load(`/api/portfolio/levels?ticker=${encodeURIComponent(t)}&series=1`);
      setRows((prev) => [row, ...(prev ?? []).filter((x) => x.ticker !== t)]);
      setOpen(t);
      setTicker("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>แนวรับ–แนวต้าน</CardTitle>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={computeAll}>
          {busy ? "กำลังคำนวณ…" : "คำนวณแนวรับแนวต้าน"}
        </Button>
        <input className={inputCls} value={ticker} placeholder="หุ้นตัวอื่น เช่น AAPL" onChange={(e) => setTicker(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lookUp()} />
        <Button variant="outline" disabled={busy || !ticker.trim()} onClick={lookUp}>
          ดูหุ้นตัวนี้
        </Button>
      </div>
      {error && <p className="text-xs text-amber-400 mt-2">{error}</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left text-xs">
            <thead className="text-(--color-muted)">
              <tr>
                <th className="pr-3 py-1">หุ้น</th>
                <th className="pr-3">ราคาล่าสุด</th>
                <th className="pr-3">แนวรับใกล้สุด</th>
                <th className="pr-3">แนวต้านใกล้สุด</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <RowView key={row.ticker} row={row} open={open === row.ticker} onExpand={() => expand(row.ticker)} />
              ))}
            </tbody>
          </table>
          <p className="text-xs text-(--color-muted) mt-2">กดที่หุ้นเพื่อดูทุกโซนและกราฟ · โซนสีจาง = แตะครั้งล่าสุดเกิน 1 ปี</p>
        </div>
      )}
      <p className="text-xs text-(--color-muted) mt-3">{FOOTER}</p>
    </Card>
  );
}
