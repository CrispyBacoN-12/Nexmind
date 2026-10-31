"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge, Button, Card, CardTitle } from "@/components/ui";
import { SCAN_SCORE_FORMULA } from "@/lib/scanAgent/filter";
import { safeHttpUrl } from "@/lib/scanAgent/url";
import {
  SCAN_GAP_TRIGGER_PCT,
  SCAN_MIN_ATR_PCT,
  SCAN_MIN_AVG_VOLUME,
  SCAN_MIN_PRICE,
  SCAN_PREMARKET_VOLUME_TRIGGER_PCT,
  SCAN_RVOL_TRIGGER,
  SCAN_SLOT_BUDGET,
  type MarketPhase,
  type ScanResult,
  type ScanRow,
} from "@/lib/scanAgent/types";
import { cn, colorForChange, fmtMoney, fmtNumber, fmtPct } from "@/lib/utils";

type OkScan = Extract<ScanResult, { ok: true }>;

const PHASE_LABEL: Record<MarketPhase, string> = {
  pre: "ก่อนตลาดเปิด",
  open: "ตลาดเปิด",
  closed: "ตลาดปิด — ตัวเลขของวันทำการล่าสุด",
};

const bangkokFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "31 Oct, 20:12" in Thai time, whatever zone the browser is in. */
function bangkokTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : bangkokFormat.format(d);
}

export function ScanPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<OkScan | null>(null);

  async function runScan() {
    setLoading(true);
    setError(null);
    setScan(null);
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      // An error body that is not this route's JSON (a platform 504 page, say)
      // must not surface as a JSON parse error.
      const json = (await res.json().catch(() => null)) as ScanResult | null;
      if (json && json.ok) setScan(json);
      else if (json && !json.ok) setError(json.error);
      else setError(`The server answered HTTP ${res.status} with a response this page could not read.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={runScan} disabled={loading}>
          {loading ? "กำลังสแกน…" : "สแกนตอนนี้"}
        </Button>
        {scan ? (
          <span className="text-xs text-(--color-muted)">
            สแกนล่าสุด {bangkokTime(scan.scannedAt)} เวลาไทย · {PHASE_LABEL[scan.phase]} · ผ่านชั้นแรก {scan.passed} จาก{" "}
            {scan.covered} ตัว
          </span>
        ) : (
          !loading &&
          !error && (
            <span className="text-xs text-(--color-muted)">
              ยังไม่ได้สแกน — ใช้เวลาประมาณหนึ่งนาที ส่วนใหญ่หมดไปกับขั้นตอนให้ AI สรุป
            </span>
          )
        )}
      </div>

      {error && (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardTitle className="text-rose-400">สแกนไม่สำเร็จ</CardTitle>
          <p className="text-sm break-words">{error}</p>
        </Card>
      )}

      {scan && <ScanResultView scan={scan} />}

      <Footer />
    </div>
  );
}

function ScanResultView({ scan }: { scan: OkScan }) {
  return (
    <div className="space-y-4">
      <EconBanner scan={scan} />
      <SourcesStrip scan={scan} />
      {scan.rows.length === 0 ? (
        <Card>
          <p className="text-sm text-(--color-muted)">ไม่มีหุ้นผ่านชั้นแรกในรอบนี้ (ไม่ใช่ความผิดพลาด)</p>
        </Card>
      ) : (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-(--color-muted) border-b border-(--color-border)">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">หุ้น</th>
                <th className="px-3 py-2 font-medium text-right">ราคา</th>
                <th className="px-3 py-2 font-medium text-right">Gap</th>
                <th className="px-3 py-2 font-medium text-right">วอลุ่มเทียบปกติ</th>
                <th className="px-3 py-2 font-medium text-right">ATR%</th>
                <th className="px-3 py-2 font-medium">ข่าว</th>
                <th className="px-3 py-2 font-medium">AI สรุป</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {scan.rows.map((row) => (
                <RowView key={row.ticker} row={row} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function EconBanner({ scan }: { scan: OkScan }) {
  if (scan.econ === null) {
    return (
      <div className="rounded-lg border border-dashed border-(--color-border) px-4 py-2 text-sm text-(--color-muted)">
        ปฏิทินเศรษฐกิจใช้ไม่ได้
      </div>
    );
  }
  if (scan.econ.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-(--color-border) px-4 py-2 text-sm text-(--color-muted)">
        ไม่มีตัวเลขเศรษฐกิจสำคัญของสหรัฐในวันทำการนี้ ({scan.sessionDate})
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm space-y-1">
      {scan.econ.map((e) => (
        <p key={`${e.at}-${e.title}`}>
          ⚠ {e.thaiTime} เวลาไทย: {e.title} — ทั้งตลาดอาจเหวี่ยงแรงช่วงตัวเลขออก
        </p>
      ))}
    </div>
  );
}

function SourcesStrip({ scan }: { scan: OkScan }) {
  if (scan.sources.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-(--color-muted)">แหล่งข้อมูล</span>
      {scan.sources.map((s) => (
        <Badge key={s.name} tone={s.ok ? "neutral" : "warning"} title={s.note}>
          {s.ok ? "✓" : "⚠"} {s.name}
          {!s.ok && ` — ${s.note}`}
        </Badge>
      ))}
    </div>
  );
}

function RowView({ row }: { row: ScanRow }) {
  return (
    <tr className="border-b border-(--color-border) last:border-b-0 align-top">
      <td className="px-3 py-2 text-(--color-muted) tabular-nums">{row.rank}</td>
      <td className="px-3 py-2 font-mono font-medium">{row.ticker}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtMoney(row.price)}</td>
      <td className={cn("px-3 py-2 text-right font-mono tabular-nums", colorForChange(row.gapPct))}>
        {row.gapPct === null ? "—" : `${row.gapPct > 0 ? "+" : ""}${fmtPct(row.gapPct)}`}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">
        <VolumeCell row={row} />
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPct(row.atrPct)}</td>
      <td className="px-3 py-2">
        <Tags row={row} />
      </td>
      <td className="px-3 py-2 text-xs max-w-xs">
        <NoteCell row={row} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <Link
          href={`/advisor?ticker=${encodeURIComponent(row.ticker)}`}
          className="text-xs text-(--color-accent) hover:underline"
        >
          → Advisor
        </Link>
      </td>
    </tr>
  );
}

function VolumeCell({ row }: { row: ScanRow }) {
  const { kind, value } = row.volume;
  if (value === null) return <>—</>;
  if (kind === "rvol") return <>{fmtNumber(value, 1)}×</>;
  return (
    <>
      {fmtNumber(value, 0)}%<span className="block text-[10px] text-(--color-muted) font-sans">ของวันปกติ</span>
    </>
  );
}

function Tags({ row }: { row: ScanRow }) {
  const tags: React.ReactNode[] = [];
  if (row.earnings === "reported") {
    tags.push(
      <Badge key="earn" tone="info">
        งบเพิ่งออก
      </Badge>,
    );
  } else if (row.earnings === "tonight") {
    tags.push(
      <Badge key="earn" tone="warning">
        งบออกคืนนี้
      </Badge>,
    );
  }
  for (const f of row.filings) {
    for (const item of f.items) {
      tags.push(
        <a key={`${f.url}-${item.code}`} href={f.url} target="_blank" rel="noreferrer" title={`${f.form} · ${f.acceptedAt}`}>
          <Badge tone={item.tier === "red" ? "negative" : "warning"}>
            8-K {item.code}: {item.label}
          </Badge>
        </a>,
      );
    }
  }
  if (row.filingsUnchecked) {
    tags.push(
      <Badge key="unchecked" tone="neutral" title="ดึงข้อมูล 8-K จาก SEC ไม่สำเร็จ ไม่ได้แปลว่าไม่มี 8-K">
        8-K ตรวจไม่ได้
      </Badge>,
    );
  }
  if (row.fractional) {
    tags.push(
      <Badge key="frac" tone="neutral" title={`ราคาเกิน ${fmtMoney(SCAN_SLOT_BUDGET)} ต่อช่อง ซื้อเป็นหุ้นเต็มไม่ได้`}>
        เศษหุ้น · ตั้ง stop ไม่ได้ ต้องเฝ้าเอง
      </Badge>,
    );
  }
  if (tags.length === 0) return <span className="text-xs text-(--color-muted)">—</span>;
  return <div className="flex flex-wrap gap-1">{tags}</div>;
}

function NoteCell({ row }: { row: ScanRow }) {
  return (
    <div className="space-y-1">
      <NoteText row={row} />
      <Headlines row={row} />
    </div>
  );
}

function NoteText({ row }: { row: ScanRow }) {
  if (row.note !== null) return <span>{row.note}</span>;
  if (row.noteReason !== null) return <span className="text-(--color-muted)">{row.noteReason}</span>;
  // Both null: the row sat outside the AI's top 30. That is not a failure.
  return <span className="text-(--color-muted)">ไม่ได้สรุป (นอก 30 อันดับแรก)</span>;
}

/** Up to 3 headlines. Third-party text, rendered as React text only; only http(s) URLs become links. */
function Headlines({ row }: { row: ScanRow }) {
  if (row.headlines.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-[11px] leading-snug text-(--color-muted)">
      {row.headlines.slice(0, 3).map((h, i) => {
        const href = safeHttpUrl(h.url);
        const label = `${h.headline} (${h.source}, ${h.date})`;
        return (
          <li key={`${i}-${h.url}`} className="break-words">
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" className="hover:underline">
                {label}
              </a>
            ) : (
              <span>{label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Footer() {
  return (
    <div className="text-xs text-(--color-muted) border-l-2 border-(--color-border) pl-4 space-y-1 max-w-3xl">
      <p>เรียงตามความคึกคัก ไม่ใช่โอกาสขึ้น · ไม่มีกฎไหนในโปรเจกต์นี้ผ่านการทดสอบย้อนหลัง</p>
      <p>{SCAN_SCORE_FORMULA}</p>
      <p>
        ชั้นแรกกรอง: ราคา ≥ {fmtMoney(SCAN_MIN_PRICE)} · วอลุ่มเฉลี่ย 10 วัน ≥ {fmtNumber(SCAN_MIN_AVG_VOLUME, 0)} หุ้น ·
        ATR ≥ {fmtNumber(SCAN_MIN_ATR_PCT, 1)}% ของราคา · ติดเมื่อมี gap ≥ {fmtNumber(SCAN_GAP_TRIGGER_PCT, 0)}% หรือ
        rvol ≥ {fmtNumber(SCAN_RVOL_TRIGGER, 0)}× หรือวอลุ่มพรีมาร์เก็ต ≥ {fmtNumber(SCAN_PREMARKET_VOLUME_TRIGGER_PCT, 0)}%
        ของวันปกติ หรืองบเพิ่งออก
      </p>
      <p>ข้อมูลช้า 15 นาที · ไม่รู้วันหยุดตลาดสหรัฐ</p>
    </div>
  );
}
