"use client";

// Support/resistance for one searched ticker. Descriptive only: where price
// has turned or traded heavily, never "buy/sell here".

import { useState } from "react";

import { Badge, Button, Card } from "@/components/ui";
import type { ChartBar } from "@/lib/levels/chart";
import type { LevelsResult, Zone } from "@/lib/levels/levels";
import { fmtMoney } from "@/lib/utils";

import { CandleChart } from "./candle-chart";

const FOOTER =
  "แสดงว่าราคาเคยกลับตัวหรือซื้อขายหนาแน่นตรงไหน ไม่ได้บอกว่าแนวจะรับหรือต้านได้ ข้อมูลประกอบการตัดสินใจเท่านั้น · ราคาย้อนหลังปรับปันผลแล้ว";

const inputCls = "rounded-md border border-(--color-border) bg-(--color-card) px-3 py-2 text-sm text-(--color-foreground)";

interface Row {
  ticker: string;
  held: boolean;
  avgCost: number | null;
  result: LevelsResult | { note: "noData" };
  series: ChartBar[];
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

function NoneText({ side, near }: { side: "support" | "resistance"; near: boolean }) {
  const text =
    side === "resistance"
      ? near
        ? "ไม่มีแนวต้านในช่วง 2 ปี (ราคาใกล้จุดสูงสุด)"
        : "ไม่มีโซนที่เข้าเกณฑ์เหนือราคา"
      : near
        ? "ไม่มีแนวรับในช่วง 2 ปี (ราคาใกล้จุดต่ำสุด)"
        : "ไม่มีโซนที่เข้าเกณฑ์ใต้ราคา";
  return <span className="text-(--color-muted)">{text}</span>;
}

function Summary({ row, r }: { row: Row; r: LevelsResult }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
      <div>
        <span className="text-lg font-semibold">{row.ticker}</span> <span className="text-lg">{fmtMoney(r.price)}</span>{" "}
        {r.forming ? <Badge tone="info">ระหว่างวัน</Badge> : <span className="text-xs text-(--color-muted)">{day(r.priceT)}</span>}
        {row.held && <span className="ml-2 text-xs text-(--color-muted)">ถืออยู่ · ทุน {row.avgCost == null ? "—" : fmtMoney(row.avgCost)}</span>}
      </div>
      {r.note === "shortHistory" ? (
        <span className="text-xs text-(--color-muted)">ประวัติราคาไม่พอ</span>
      ) : (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <span>
            <span className="text-(--color-muted)">แนวรับใกล้สุด </span>
            {r.support[0] ? <ZoneText z={r.support[0]} price={r.price} /> : <NoneText side="support" near={r.nearLow} />}
          </span>
          <span>
            <span className="text-(--color-muted)">แนวต้านใกล้สุด </span>
            {r.resistance[0] ? <ZoneText z={r.resistance[0]} price={r.price} /> : <NoneText side="resistance" near={r.nearHigh} />}
          </span>
          {r.inZone && <Badge tone="warning">ราคาอยู่ในโซน</Badge>}
        </div>
      )}
    </div>
  );
}

function ZoneList({ row, r }: { row: Row; r: LevelsResult }) {
  const zones = [...r.allZones].sort((a, b) => b.mid - a.mid);
  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-(--color-muted)">
        <span>MA50 {r.ma50 == null ? "—" : fmtMoney(r.ma50)}</span>
        <span>MA200 {r.ma200 == null ? "—" : fmtMoney(r.ma200)}</span>
        <span>สูงสุด 52 สัปดาห์ {r.high52 == null ? "—" : fmtMoney(r.high52)}</span>
        <span>ต่ำสุด 52 สัปดาห์ {r.low52 == null ? "—" : fmtMoney(r.low52)}</span>
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
      <p className="text-(--color-muted)">แถบสีจาง = โซนที่แตะครั้งล่าสุดเกิน 1 ปี</p>
    </div>
  );
}

export function LevelsPanel() {
  const [row, setRow] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticker, setTicker] = useState("");

  async function lookUp() {
    const t = ticker.trim().toUpperCase();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/levels?ticker=${encodeURIComponent(t)}`);
      const j = (await r.json()) as { ok: boolean; row?: Row; error?: string };
      if (!j.ok || !j.row) throw new Error(j.error ?? `HTTP ${r.status}`);
      setRow(j.row);
      setTicker("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const r = row?.result;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={inputCls}
          value={ticker}
          placeholder="ชื่อหุ้น เช่น NVDA"
          onChange={(e) => setTicker(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && lookUp()}
          autoFocus
        />
        <Button disabled={busy || !ticker.trim()} onClick={lookUp}>
          {busy ? "กำลังคำนวณ…" : "ดูหุ้นตัวนี้"}
        </Button>
      </div>
      {error && <p className="text-xs text-amber-400 mt-2">{error}</p>}
      {row && r && !("price" in r) && (
        <p className="mt-4 text-sm">
          <span className="font-semibold">{row.ticker}</span> <span className="text-(--color-muted)">ไม่พบข้อมูลราคา</span>
        </p>
      )}
      {row && r && "price" in r && (
        <div className="mt-4 space-y-4">
          <Summary row={row} r={r} />
          {row.series.length > 1 && <CandleChart series={row.series} zones={r.allZones} price={r.price} avgCost={row.avgCost} />}
          {r.note !== "shortHistory" && <ZoneList row={row} r={r} />}
        </div>
      )}
      <p className="text-xs text-(--color-muted) mt-4">{FOOTER}</p>
    </Card>
  );
}
