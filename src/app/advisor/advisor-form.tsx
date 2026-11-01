"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Badge, Button, Card, CardTitle, Stat } from "@/components/ui";
import { CHART_SMA_SLOW, type ChartBar } from "@/lib/advisor/chartSeries";
import type { StopContext } from "@/lib/advisor/chartStop";
import { earningsPhrase } from "@/lib/advisor/earningsPhrase";
import {
  ADVISOR_ATR_PERIOD,
  ADVISOR_ATR_SL_MULT,
  ADVISOR_COST_BPS,
  type AdvisorCard,
  type AdvisorResult,
} from "@/lib/advisor/types";
import { etClock } from "@/lib/scanAgent/session";
import { fmtMoney, fmtNumber, fmtPct } from "@/lib/utils";

import { AdvisorChart } from "./advisor-chart";
import { AdvisorCritique } from "./advisor-critique";
import { AdvisorStopReading } from "./advisor-stop-reading";
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
 * `stopContext` rides the same way: the 5-minute bars the AI reading is shown,
 * non-null only when the stop came from the chart (swing / pdl).
 */
type AdvisorResponse = AdvisorResult & { chart?: ChartBar[] | null; stopContext?: StopContext | null };

/** Stop label per source, shared by the stat and its structure sub-line. */
const STOP_LABEL: Record<AdvisorCard["stopSource"], string> = {
  given: "จุดตัดขาดทุน (กำหนดมาเอง)",
  swing: "จุดตัดขาดทุน (ใต้ swing low กราฟ 5 นาที)",
  pdl: "จุดตัดขาดทุน (ใต้ low ของวันก่อน)",
  atr: `จุดตัดขาดทุน (${ADVISOR_ATR_SL_MULT} เท่าของ ATR)`,
};

/** "2026-10-30 10:35 ET" for the bar a structural stop sits under. */
function structureWhen(s: NonNullable<AdvisorCard["stopStructure"]>): string {
  const { minutes } = etClock(s.barT);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${s.sessionDate} ${hh}:${mm} ET`;
}

export function AdvisorForm({
  initialTicker = "",
  initialEntry = "",
  initialStop = "",
}: {
  initialTicker?: string;
  initialEntry?: string;
  initialStop?: string;
}) {
  // Prefilled from /advisor?ticker= (the Scanner's "→ Advisor" link) and from
  // ?entry=&stop= (the chart agent's setup panel). It only fills the fields: the
  // owner still presses submit, nothing runs on arrival. Entry and stop are
  // kept as the strings the URL carried; only the route parses them.
  const [ticker, setTicker] = useState(initialTicker);
  const [entry, setEntry] = useState(initialEntry);
  const [stop, setStop] = useState(initialStop);
  const [capital, setCapital] = useState("2500");
  const [maxSlots, setMaxSlots] = useState("5");
  const [riskPct, setRiskPct] = useState("1");
  const [holdings, setHoldings] = useState("");
  /** The open journal tickers the holdings field was prefilled with, if any. */
  const [holdingsFromJournal, setHoldingsFromJournal] = useState<string | null>(null);
  // Set once the owner types in the field or submits: the prefill must never
  // land on top of their own input or change holdings under a card already shown.
  const holdingsTouched = useRef(false);

  // Default the holdings field to the open journal positions — the same rows
  // the portfolio gates below treat as the book. Fails soft to an empty field.
  useEffect(() => {
    fetch("/api/journal")
      .then((r) => r.json())
      .then((j: { ok: boolean; open?: { ticker: string }[] }) => {
        const tickers = j.ok ? Array.from(new Set((j.open ?? []).map((t) => t.ticker.toUpperCase()))) : [];
        if (tickers.length === 0 || holdingsTouched.current) return;
        const joined = tickers.join(", ");
        setHoldings(joined);
        setHoldingsFromJournal(joined);
      })
      .catch(() => {});
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<AdvisorCard | null>(null);
  const [chart, setChart] = useState<ChartBar[] | null>(null);
  const [stopContext, setStopContext] = useState<StopContext | null>(null);
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

  /**
   * "ใช้ stop ATR แทน": put the ATR stop in the field and ask again, so the next
   * card reads `given`. The value is passed to submit() rather than read back
   * from state: setStop is async, and the request would otherwise carry the old
   * stop. The programmatic setStop does not fire the form's bubbled onChange, so
   * formEpoch is bumped by hand, as pickEntry does.
   */
  function applyAtrStop(value: string) {
    setStop(value);
    setFormEpoch((n) => n + 1);
    void submit(value);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submit(stop);
  }

  async function submit(stopValue: string) {
    holdingsTouched.current = true;
    setLoading(true);
    setError(null);
    setCard(null);
    setChart(null);
    setStopContext(null);
    setPickedFrom(null);
    try {
      const res = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          entry,
          stop: stopValue,
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
        setStopContext(json.stopContext ?? null);
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
          {/* Changing the ticker clears the entry AND the stop.
              An entry typed — or clicked off a candle — for one name is a
              price in that name's range, and carrying it into another turns
              the card into an override nobody asked for: the entry level and
              the whole R ladder float away from the price action, and the
              chart stops showing the latest price as the entry. Blank means
              "use this ticker's last close", which is the right default for a
              ticker whose price has not been read yet. A stop is the same
              kind of price: carried to another name it would be sized as a
              chart stop that was never drawn for it, so a blank stop (the
              1.5 x ATR default) is the only safe thing to leave behind. */}
          <Field
            label="ชื่อหุ้น"
            value={ticker}
            onChange={(v) => {
              if (v !== ticker) {
                setEntry("");
                setStop("");
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
          {/* Always shown: blank now means "find it on the 5-minute chart". */}
          <Field
            label="Stop (เว้นว่าง = หาจากกราฟ 5 นาที)"
            value={stop}
            onChange={setStop}
            placeholder="171.00"
          />
          <Field label="เงินทุน ($)" value={capital} onChange={setCapital} />
          <Field label="จำนวนช่องสูงสุด" value={maxSlots} onChange={setMaxSlots} />
          <Field label="ความเสี่ยงต่อไม้ (%)" value={riskPct} onChange={setRiskPct} />
          <div>
            <Field
              label="ถืออยู่ตอนนี้ (คั่นด้วยจุลภาค)"
              value={holdings}
              onChange={(v) => {
                holdingsTouched.current = true;
                setHoldings(v);
              }}
              placeholder="MSFT, NVDA"
            />
            {holdingsFromJournal != null && holdings === holdingsFromJournal ? (
              <p className="mt-1 text-xs text-(--color-muted)">
                ดึงจากสถานะเปิดใน<Link className="underline" href="/journal">สมุดบันทึกเทรด</Link> · เพิ่มหุ้นที่ถือนอกสมุดได้เอง
              </p>
            ) : null}
          </div>
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
        <ResultCard
          card={card}
          chart={chart}
          stopContext={stopContext}
          onPickEntry={pickEntry}
          onUseAtrStop={applyAtrStop}
          critiqueKey={formEpoch}
        />
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

/**
 * The stop on this card is a PRICE. A fill above the entry keeps that price and
 * so carries more risk per share than the card sized for. Reported, never
 * applied — the share count above is still the one sized at the entry.
 */
function FillGuardCard({ card }: { card: AdvisorCard }) {
  const g = card.fillGuard;
  const over = g.belowStop || g.atQuote?.overWalkAway;
  return (
    <Card className={`p-5 space-y-2 ${over ? "border-amber-500/40" : ""}`}>
      <CardTitle>ถ้าราคาวิ่งขึ้นก่อนส่งคำสั่ง</CardTitle>
      {g.walkAwayPrice != null ? (
        <p className="text-sm">
          ราคาสูงสุดที่ยังซื้อ {fmtNumber(card.sizing.shares, 0)} หุ้นได้:{" "}
          <span className="font-mono font-semibold">{fmtMoney(g.walkAwayPrice)}</span>{" "}
          <span className="text-(--color-muted)">
            (ติดเพดาน{g.walkAwayBoundBy ? CAP_LABEL[g.walkAwayBoundBy] : ""}) · stop ยังอยู่ที่ {fmtMoney(card.stop)}{" "}
            ถ้าได้ราคาสูงกว่านี้ ความเสี่ยงจะเกินแผน ให้กดคำนวณใหม่ด้วยราคาที่ได้จริง
          </span>
        </p>
      ) : (
        <p className="text-sm text-(--color-muted)">ขนาดเป็นศูนย์ จึงไม่มีราคาเพดาน</p>
      )}
      {g.quote?.fresh ? (
        <p className="text-sm">
          ราคาล่าสุด <span className="font-mono">{fmtMoney(g.quote.price)}</span>{" "}
          <span className="text-(--color-muted)">(อายุ {fmtNumber(g.quote.ageMin, 0)} นาที)</span>
          {g.atQuote ? (
            <>
              {" "}
              · ถ้าซื้อ {fmtNumber(card.sizing.shares, 0)} หุ้นตอนนี้ เสี่ยง{" "}
              <span className="font-mono">{fmtMoney(g.atQuote.plannedRiskUsd)}</span> (
              {fmtPct(g.atQuote.plannedRiskPct)} ของเงินทุน) · ขนาดที่ถูกต้องที่ราคานี้{" "}
              <span className="font-mono font-semibold">{fmtNumber(g.atQuote.resized.shares, 0)} หุ้น</span>
            </>
          ) : null}
        </p>
      ) : null}
      <p className="text-xs text-(--color-muted)">{g.quoteNote}</p>
    </Card>
  );
}

/**
 * Everything about HOW the stop was found, under the stop line: the notes on
 * what the chain passed over, the tight / wide flags (disclosed, never moving
 * the stop), the plain 1.5 x ATR alternative, and the AI reading. The reading
 * is remounted with the critique's key, so an edit clears it.
 */
function StopDetail({
  card,
  stopContext,
  onUseAtrStop,
  readingKey,
}: {
  card: AdvisorCard;
  stopContext: StopContext | null;
  onUseAtrStop: (stop: string) => void;
  readingKey: number;
}) {
  const alt = card.atrAlternative;
  return (
    <div className="space-y-2">
      {card.stopNotes.length > 0 ? (
        <p className="text-xs text-(--color-muted)">{card.stopNotes.join(" · ")}</p>
      ) : null}
      {card.stopFlags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {card.stopFlags.map((f) => (
            <Badge key={f} tone="warning">
              {f}
            </Badge>
          ))}
        </div>
      ) : null}
      {alt ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-(--color-muted)">
          <span>
            เทียบ stop แบบ {alt.atrMult}×ATR: <span className="font-mono">{fmtMoney(alt.stop)}</span> · ซื้อได้{" "}
            {fmtNumber(alt.shares, 0)} หุ้น
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => onUseAtrStop(alt.stop.toFixed(2))}>
            ใช้ stop ATR แทน
          </Button>
        </div>
      ) : null}
      <AdvisorStopReading key={readingKey} card={card} context={stopContext} />
    </div>
  );
}

function ResultCard({
  card,
  chart,
  stopContext,
  onPickEntry,
  onUseAtrStop,
  critiqueKey,
}: {
  card: AdvisorCard;
  chart: ChartBar[] | null;
  stopContext: StopContext | null;
  onPickEntry: (price: number, date: string) => void;
  onUseAtrStop: (stop: string) => void;
  /** Changes on any form edit; remounting AdvisorCritique and the stop reading is how they clear. */
  critiqueKey: number;
}) {
  const br = card.baseRate;
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
            label={STOP_LABEL[card.stopSource]}
            value={fmtMoney(card.stop)}
            sub={
              card.stopSource === "atr"
                ? `ห่าง ${fmtMoney(card.slDistance)}`
                : `(${card.stopAtrMult.toFixed(2)}×ATR) · ห่าง ${fmtMoney(card.slDistance)}` +
                  (card.stopStructure ? ` · ${structureWhen(card.stopStructure)}` : "")
            }
          />
          <Stat label={`ATR(${ADVISOR_ATR_PERIOD})`} value={fmtMoney(card.atr)} />
          <Stat
            label="ต้นทุนการซื้อขายไป-กลับ"
            value={`${fmtNumber(card.costR, 3)} R`}
            sub={`สมมติฐาน ${ADVISOR_COST_BPS} bps`}
          />
        </div>
        <StopDetail card={card} stopContext={stopContext} onUseAtrStop={onUseAtrStop} readingKey={critiqueKey} />
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
        <FillGuardCard card={card} />
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
                <th className="py-1 pr-4">กำไร-ขาดทุน จาก {fmtNumber(card.sizing.shares, 0)} หุ้น</th>
                {br ? (
                  <>
                    <th className="py-1 pr-4">ถึงเป้าก่อน</th>
                    <th className="py-1 pr-4">โดน stop ก่อน</th>
                    <th className="py-1 pr-4">ไม่จบใน {br.horizon} วัน</th>
                    <th className="py-1">จุดคุ้มทุน</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody className="font-mono">
              {card.ladder.map((row) => {
                const b = br?.rows.find((x) => x.r === row.r);
                return (
                  <tr key={row.r} className="border-t border-(--color-border)">
                    <td className="py-1 pr-4">{fmtNumber(row.r, 1)}R</td>
                    <td className="py-1 pr-4">{fmtMoney(row.price)}</td>
                    <td className="py-1 pr-4">{fmtPct(row.gainPct)}</td>
                    <td className="py-1 pr-4">{fmtMoney(row.plUsd)}</td>
                    {br ? (
                      b ? (
                        <>
                          <td className="py-1 pr-4">{fmtPct(b.targetFirstPct)}</td>
                          <td className="py-1 pr-4">{fmtPct(b.stopFirstPct)}</td>
                          <td className="py-1 pr-4">{fmtPct(b.openPct)}</td>
                          <td className="py-1 text-(--color-muted)">{fmtPct(b.breakEvenPct)}</td>
                        </>
                      ) : (
                        <td className="py-1" colSpan={4}>—</td>
                      )
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* A zero-information entry on every session: whatever this shows is the
            stock's own drift over the sample, which is why the buy-and-hold move
            sits in the same sentence. */}
        {br ? (
          <p className="text-xs text-(--color-muted)">
            สถิติพื้นฐาน: ถ้าเข้าซื้อที่ราคาปิดของ<span className="font-mono">ทุกวัน</span> ({fmtNumber(br.entries, 0)} วัน,{" "}
            {br.from} ถึง {br.to}) ด้วย stop {fmtNumber(card.stopAtrMult, 2)}×ATR แบบเดียวกับการ์ดนี้ แล้วดูต่อไม่เกิน {br.horizon} วันทำการ ·
            วันที่แท่งเดียวแตะทั้ง stop และเป้า นับเป็นโดน stop ({fmtNumber(br.sameBarBoth, 0)} ครั้ง) · ช่วงนี้หุ้นตัวนี้เปลี่ยนไป{" "}
            <span className="font-mono">{fmtPct(br.buyHoldPct)}</span> ถ้าเกินจุดคุ้มทุน ส่วนใหญ่คือแนวโน้มของหุ้นช่วงนั้น
            ไม่ใช่ความได้เปรียบ · วันที่ติดกันใช้เส้นทางราคาเดียวกัน ตัวอย่างอิสระจริงน้อยกว่าจำนวนวันหลายเท่า ·
            ยังไม่หักต้นทุน {fmtNumber(card.costR, 3)}R ต่อรอบ
          </p>
        ) : (
          <p className="text-xs text-(--color-muted)">สถิติพื้นฐาน: ประวัติราคารายวันไม่พอจะคำนวณ</p>
        )}
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
