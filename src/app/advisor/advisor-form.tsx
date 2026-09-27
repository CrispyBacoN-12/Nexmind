"use client";

import { useState } from "react";

import { Badge, Button, Card, CardTitle, Stat } from "@/components/ui";
import { CHART_SMA_SLOW, type ChartBar } from "@/lib/advisor/chartSeries";
import { earningsPhrase } from "@/lib/advisor/earningsPhrase";
import {
  ADVISOR_ATR_PERIOD,
  ADVISOR_ATR_SL_MULT,
  ADVISOR_COST_BPS,
  type AdvisorCard,
  type AdvisorResult,
} from "@/lib/advisor/types";
import { fmtMoney, fmtNumber, fmtPct } from "@/lib/utils";

import { AdvisorChart } from "./advisor-chart";
import { AdvisorCritique } from "./advisor-critique";
import { PortfolioGates } from "./portfolio-gates";

const CAP_LABEL: Record<string, string> = {
  risk: "งบความเสี่ยง",
  affordability: "กำลังซื้อ",
};

/**
 * The route's 200 body: the AdviceResult with the chart bars beside it.
 *
 * `chart` sits OUTSIDE the card because `advise` is pure and knows nothing
 * about drawing. It is optional and nullable on purpose — the history pull for
 * the chart fails soft, and a card with no picture is still a whole card.
 */
type AdvisorResponse = AdvisorResult & { chart?: ChartBar[] | null };

export function AdvisorForm() {
  const [ticker, setTicker] = useState("");
  const [entry, setEntry] = useState("");
  const [capital, setCapital] = useState("2500");
  const [maxSlots, setMaxSlots] = useState("5");
  const [riskPct, setRiskPct] = useState("1");
  const [holdings, setHoldings] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<AdvisorCard | null>(null);
  const [chart, setChart] = useState<ChartBar[] | null>(null);
  /** Set when the entry field was filled by clicking a candle, cleared on submit. */
  const [pickedFrom, setPickedFrom] = useState<string | null>(null);
  // Bumped by any keystroke in the form. Used as AdvisorCritique's key, so an
  // edit unmounts a critique that was argued against numbers that no longer
  // match the card. React's onChange bubbles, so one handler covers every field.
  const [formEpoch, setFormEpoch] = useState(0);

  /**
   * A clicked candle fills the Entry field and stops there.
   *
   * It deliberately does NOT re-submit: recharts fires onClick for any click
   * inside the plot area, and a request per stray click would be both a fetch
   * storm and a card that changes under the owner without them asking. The
   * note below the field is what makes the click visible instead.
   */
  function pickEntry(price: number, date: string) {
    setEntry(price.toFixed(2));
    setPickedFrom(date);
    // setEntry above is a programmatic controlled-input change: React does not
    // fire the form's bubbled onChange for it, so formEpoch (AdvisorCritique's
    // remount key) would not otherwise bump and a stale critique — argued
    // against the OLD entry — would keep rendering under the new card.
    setFormEpoch((n) => n + 1);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setCard(null);
    setChart(null);
    setPickedFrom(null);
    try {
      const res = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          entry,
          capital,
          maxSlots,
          riskPct,
          holdings: holdings.split(/[\s,]+/).filter(Boolean),
        }),
      });
      // res.ok is not enough on its own and neither is res.json(): an error
      // body that is not this route's JSON (a proxy 502 page, say) would
      // otherwise surface to the owner as a JSON parse error.
      const json = (await res.json().catch(() => null)) as AdvisorResponse | null;
      if (json && json.ok) {
        setCard(json.card);
        setChart(json.chart ?? null);
      } else if (json && !json.ok) setError(json.error);
      else setError(`The server answered HTTP ${res.status} with a response this page could not read.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <form
          onSubmit={onSubmit}
          onChange={() => setFormEpoch((n) => n + 1)}
          className="grid gap-4 sm:grid-cols-3"
        >
          {/* Changing the ticker clears the entry.
              An entry typed — or clicked off a candle — for one name is a
              price in that name's range, and carrying it into another turns
              the card into an override nobody asked for: the entry level and
              the whole R ladder float away from the price action, and the
              chart stops showing the latest price as the entry. Blank means
              "use this ticker's last close", which is the right default for a
              ticker whose price has not been read yet. */}
          <Field
            label="ชื่อหุ้น"
            value={ticker}
            onChange={(v) => {
              if (v !== ticker) {
                setEntry("");
                setPickedFrom(null);
              }
              setTicker(v);
            }}
            placeholder="AAPL"
            required
          />
          <div>
            <Field
              label="ราคาเข้า (เว้นว่าง = ราคาปิดล่าสุด)"
              value={entry}
              onChange={(v) => {
                setEntry(v);
                setPickedFrom(null);
              }}
              placeholder="180.00"
            />
            {pickedFrom ? (
              <p className="mt-1 text-xs text-(--color-accent)">
                ดึงมาจากแท่งเทียนวันที่ {pickedFrom} กด "อ่านโครงสร้าง" อีกครั้งเพื่อคำนวณขนาดใหม่
              </p>
            ) : null}
          </div>
          <Field label="เงินทุน ($)" value={capital} onChange={setCapital} />
          <Field label="จำนวนช่องสูงสุด" value={maxSlots} onChange={setMaxSlots} />
          <Field label="ความเสี่ยงต่อไม้ (%)" value={riskPct} onChange={setRiskPct} />
          <Field
            label="ถืออยู่ตอนนี้ (คั่นด้วยจุลภาค)"
            value={holdings}
            onChange={setHoldings}
            placeholder="MSFT, NVDA"
          />
          <div className="sm:col-span-3">
            <Button type="submit" disabled={loading}>
              {loading ? "กำลังอ่าน…" : "อ่านโครงสร้าง"}
            </Button>
          </div>
        </form>
      </Card>

      {error ? (
        <Card className="p-5 border-rose-500/40">
          <CardTitle className="text-rose-400">ไม่มีอะไรให้แสดง</CardTitle>
          <p className="text-sm mt-2">{error}</p>
        </Card>
      ) : null}

      {card ? (
        <ResultCard card={card} chart={chart} onPickEntry={pickEntry} critiqueKey={formEpoch} />
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-xs text-(--color-muted) space-y-1">
      <span>{label}</span>
      <input
        className="w-full rounded-md border border-(--color-border) bg-(--color-card) px-3 py-2 text-sm text-(--color-foreground)"
        value={value}
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function ResultCard({
  card,
  chart,
  onPickEntry,
  critiqueKey,
}: {
  card: AdvisorCard;
  chart: ChartBar[] | null;
  onPickEntry: (price: number, date: string) => void;
  /** Changes on any form edit; remounting AdvisorCritique is how it clears. */
  critiqueKey: number;
}) {
  return (
    <div className="space-y-4">
      {/* The already-held banner stays above the chart: it changes how every
          number AND every line below it should be read, so it cannot sit
          420px further down where it can be scrolled past. */}
      {card.alreadyHeld ? (
        <Card className="p-4 border-amber-500/40">
          <p className="text-sm">
            <Badge tone="warning">ถืออยู่แล้ว</Badge>{" "}
            คุณระบุว่าถือ {card.ticker} อยู่แล้ว ตัวเลขด้านล่างทั้งหมดคือการคำนวณขนาดของโพซิชันใหม่ที่จะเพิ่มเข้าไป
          </p>
        </Card>
      ) : null}

      {chart && chart.length > 0 ? (
        <Card className="p-5 space-y-3">
          <div className="flex items-baseline justify-between">
            <CardTitle>
              {card.ticker} · ย้อนหลังหกเดือน พร้อมระดับราคาสำคัญ
            </CardTitle>
            <span className="text-xs text-(--color-muted) font-mono">
              SMA{CHART_SMA_SLOW} คำนวณจากข้อมูลสองปี
            </span>
          </div>
          <AdvisorChart bars={chart} card={card} onPickEntry={onPickEntry} />
        </Card>
      ) : null}

      {/* Stat already renders its own Card, so these grids are NOT wrapped in one. */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            {card.ticker} · {fmtMoney(card.lastClose)}
          </h2>
          <span className="text-xs text-(--color-muted) font-mono">as of {card.asOf}</span>
        </div>
        {/* Reported, never acted on — the 2026-09-08 screen found earnings timing
            worthless as an entry in both directions, so nothing below this line
            sizes or stops differently because of it. It is here because RAVEN
            argues about this exact string, and the owner has to be able to see
            what RAVEN is arguing about. */}
        <p className="text-xs text-(--color-muted)">
          ประกาศผลประกอบการครั้งถัดไป: <span className="font-mono">{earningsPhrase(card.earnings, card.asOf)}</span>
        </p>
        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="ราคาเข้า" value={fmtMoney(card.entry)} sub={card.entrySource} />
          <Stat
            label={`จุดตัดขาดทุน (${ADVISOR_ATR_SL_MULT} เท่าของ ATR)`}
            value={fmtMoney(card.stop)}
            sub={`ห่าง ${fmtMoney(card.slDistance)}`}
          />
          <Stat label={`ATR(${ADVISOR_ATR_PERIOD})`} value={fmtMoney(card.atr)} />
          <Stat
            label="ต้นทุนการซื้อขายไป-กลับ"
            value={`${fmtNumber(card.costR, 3)} R`}
            sub={`สมมติฐาน ${ADVISOR_COST_BPS} bps`}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">ขนาดโพซิชัน</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="จำนวนหุ้น" value={fmtNumber(card.sizing.shares, 0)} />
          <Stat
            label="เงินทุนที่ใช้"
            value={fmtMoney(card.deployedUsd)}
            sub={`งบต่อช่อง ${fmtMoney(card.sizing.slotBudget)}`}
          />
          <Stat
            label="ความเสี่ยงจริง"
            value={fmtMoney(card.sizing.actualRiskUsd)}
            sub={`${fmtPct(card.sizing.actualRiskPct)} ของเงินทุน`}
          />
          <Stat label="ถูกจำกัดโดย" value={card.sizing.boundBy.map((b) => CAP_LABEL[b] ?? b).join(" + ") || "—"} />
        </div>
        <Card className="p-5 space-y-2">
          <p className="text-sm text-(--color-muted)">{card.sizing.reason}</p>
          <p className="text-sm text-(--color-muted)">
            ตามกฎสหสัมพันธ์ของเดสก์ (ตัวคูณ {fmtNumber(card.corrMultiplier, 2)}):{" "}
            {fmtNumber(card.corrAdjustedShares, 0)} หุ้น เป็นการรายงานเท่านั้น ไม่ได้นำไปปรับใช้ — ตัวเลขด้านบนยังไม่ถูกปรับ
          </p>
          {/* Gap-through: the "actual risk" above assumes the stop fills AT the stop.
              This is the sample's worst night against that assumption — disclosed,
              never folded into the share count. */}
          <p className="text-sm text-(--color-muted)">
            {card.gapRisk ? (
              <>
                ความเสี่ยงเปิดกระโดดข้ามจุดตัดขาดทุน (Gap-through): แย่สุดใน {fmtNumber(card.gapRisk.sessions, 0)} วันทำการ
                ({card.gapRisk.from} ถึง {card.gapRisk.to}) เปิดต่ำกว่าราคาปิดวันก่อน{" "}
                <span className="font-mono">{fmtNumber(card.gapRisk.worstStops, 2)}</span> เท่าของระยะ stop
                {card.gapRisk.worstDate ? ` (${card.gapRisk.worstDate})` : ""} — ถ้าเกิดตอนราคาอยู่ใกล้ stop จะขาดทุนได้ถึง{" "}
                <span className="font-mono">{fmtNumber(card.gapRisk.worstLossR, 2)} R</span>
                {card.gapWorstLossUsd != null ? ` ≈ ${fmtMoney(card.gapWorstLossUsd)}` : ""} แทนที่จะเป็น 1R ·
                เปิดกระโดด ≥ 1 stop {card.gapRisk.overOneStop} ครั้ง, ≥ ครึ่ง stop {card.gapRisk.overHalfStop} ครั้ง ·
                เป็นสถิติย้อนหลัง ไม่ใช่เพดานของความเสี่ยง และไม่ได้นำไปปรับจำนวนหุ้น
              </>
            ) : (
              "ความเสี่ยงเปิดกระโดดข้ามจุดตัดขาดทุน (Gap-through): ข้อมูลรายวันไม่พอจะวัด — ขาดทุน -1R ข้างบนยังไม่ได้ตรวจกับการเปิดกระโดด"
            )}
          </p>
        </Card>
      </section>

      <Card className="p-5 space-y-3">
        <CardTitle>บันได R</CardTitle>
        <p className="text-xs text-(--color-muted)">
          เครื่องมือนี้ไม่ได้เลือกเป้าหมายให้ รูปแบบการออกทั้งสามแบบในโปรเจกต์นี้ให้ผลไม่ตรงกัน
          และไม่มีแบบไหนผ่านการทดสอบ deep hold-out
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-(--color-muted) text-left">
              <tr>
                <th className="py-1 pr-4">R</th>
                <th className="py-1 pr-4">ราคา</th>
                <th className="py-1 pr-4">กำไร</th>
                <th className="py-1">กำไร-ขาดทุน จาก {fmtNumber(card.sizing.shares, 0)} หุ้น</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {card.ladder.map((row) => (
                <tr key={row.r} className="border-t border-(--color-border)">
                  <td className="py-1 pr-4">{fmtNumber(row.r, 1)}R</td>
                  <td className="py-1 pr-4">{fmtMoney(row.price)}</td>
                  <td className="py-1 pr-4">{fmtPct(row.gainPct)}</td>
                  <td className="py-1">{fmtMoney(row.plUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">ช่องและสภาวะตลาด</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="ช่องว่าง"
            value={fmtNumber(card.freeSlots, 0)}
            sub={
              card.alreadyHeld
                ? `${card.ticker} ครองช่องหนึ่งอยู่แล้ว`
                : `${card.ticker} จะเป็นหนึ่งในนั้น`
            }
          />
          <Stat
            label="ประตูตลาด"
            value={card.gate.benchAbove == null ? "มองไม่เห็น" : card.gate.benchAbove ? "เหนือแนวโน้ม" : "ต่ำกว่าแนวโน้ม"}
            sub={`อนุญาต ${fmtNumber(card.gate.slots, 0)} ช่อง`}
          />
          <Stat
            label="สหสัมพันธ์เฉลี่ยกับที่ถืออยู่"
            value={card.avgCorrelation == null ? "—" : fmtNumber(card.avgCorrelation, 2)}
          />
        </div>
        <Card className="p-5 space-y-2">
          <p className="text-sm text-(--color-muted)">{card.gate.note}</p>
          <p className="text-xs text-(--color-muted)">
            นี่คือข้อมูลประกอบการตัดสินใจเท่านั้น เครื่องมือนี้ไม่ได้ปิดกั้นอะไร — การตัดสินใจเป็นของคุณ
          </p>
          {card.correlations.length > 0 ? (
            <ul className="text-sm space-y-1">
              {card.correlations.map((c) => (
                <li key={c.ticker} className="font-mono">
                  {c.ticker}: {c.correlation == null ? `ไม่ทราบ (${c.note})` : fmtNumber(c.correlation, 2)}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </section>

      {card.warnings.length > 0 ? (
        <Card className="p-5 space-y-2 border-amber-500/40">
          <CardTitle>สิ่งที่ผิดพลาดแต่ไม่ได้ทำให้การ์ดหยุดแสดงผล</CardTitle>
          <ul className="text-sm space-y-1 list-disc pl-5">
            {card.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <PortfolioGates key={`gates-${critiqueKey}`} card={card} />

      <AdvisorCritique key={critiqueKey} card={card} chart={chart} />

      <p className="text-xs text-(--color-muted) border-l-2 border-(--color-border) pl-4">{card.noEdgeClaim}</p>
    </div>
  );
}
