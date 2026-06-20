"use client";

import { useState } from "react";
import { Card, CardTitle, Button, Badge, PageHeader, Empty, Stat } from "@/components/ui";
import { fmtNumber } from "@/lib/utils";

type Stance = "buy" | "hold" | "avoid";
type Verdict = "strong-buy" | "buy" | "watch" | "avoid";
interface InvestorView { persona: string; stance: Stance; confidence: number; reason: string }
interface LongTermStats {
  price: number; cagrPct: number | null; change52wPct: number | null; sma40w: number | null;
  priceVsSma40wPct: number | null; drawdownFromHighPct: number; rangePos52wPct: number | null; rsiWeekly: number | null;
}
interface Fundamentals {
  name: string | null; industry: string | null; marketCapM: number | null; peTTM: number | null; pb: number | null;
  roePct: number | null; netMarginPct: number | null; revenueGrowthPct: number | null; epsGrowthPct: number | null;
  debtToEquity: number | null; dividendYieldPct: number | null; note?: string;
}
interface TechLevels {
  price: number; support: number | null; resistance: number | null; stop: number | null; target: number | null; rr: number | null; atr: number | null;
}
interface InvestResult {
  symbol: string; price: number; stats: LongTermStats; fundamentals: Fundamentals; views: InvestorView[];
  verdict: {
    rating: Verdict; entryLow: number | null; entryHigh: number | null;
    support: number | null; resistance: number | null; target: number | null; stopLoss: number | null;
    horizon: string; thesis: string[]; risks: string[];
  };
  levels: TechLevels;
  costUsd: number;
}

const stanceTone: Record<Stance, "positive" | "neutral" | "negative"> = { buy: "positive", hold: "neutral", avoid: "negative" };
const verdictTone: Record<Verdict, "positive" | "info" | "warning" | "negative"> = {
  "strong-buy": "positive", buy: "positive", watch: "warning", avoid: "negative",
};
const verdictEmoji: Record<Verdict, string> = { "strong-buy": "🏆", buy: "✅", watch: "👀", avoid: "🚫" };
const verdictAdvice: Record<Verdict, string> = {
  "strong-buy": "ทยอยสะสมได้ในโซนเข้า ความมั่นใจสูง",
  buy: "น่าซื้อ — รอราคาในโซนเข้าแล้วทยอยสะสม",
  watch: "ยังไม่ซื้อ — เฝ้าดูให้เข้าโซน/เงื่อนไขดีขึ้นก่อน",
  avoid: "ยังไม่ควรซื้อตอนนี้",
};

const f = (n: number | null, d = 2) => (n == null ? "—" : fmtNumber(n, d));
const pct = (n: number | null, d = 1) => (n == null ? "—" : `${fmtNumber(n, d)}%`);

export default function InvestPage() {
  const [symbol, setSymbol] = useState("AAPL");
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<InvestResult | null>(null);
  const [err, setErr] = useState("");

  async function run() {
    if (!symbol.trim() || busy) return;
    setBusy(true); setR(null); setErr("");
    try {
      const res = await fetch("/api/invest", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol }),
      });
      const data = await res.json();
      if (data.error) setErr(data.error);
      else setR(data);
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  const s = r?.stats;
  const fu = r?.fundamentals;
  const v = r?.verdict;
  const lv = r?.levels;

  return (
    <div>
      <PageHeader
        title="Stock Advisor"
        description="พิมพ์ชื่อหุ้น → AI สรุปพื้นฐาน + จุดเข้า-ออก + แนวรับ-ต้าน + ความเสี่ยง + คำแนะนำซื้อ (วิเคราะห์อย่างเดียว ไม่ซื้อจริง)."
      />

      <Card className="mb-5">
        <div className="flex gap-2">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="symbol — AAPL, NVDA, BTC-USD, PTT.BK"
            className="flex-1 h-10 rounded-md border border-(--color-border) bg-(--color-background) px-3 text-sm font-mono focus:outline-none focus:border-(--color-accent)/50"
          />
          <Button onClick={run} disabled={busy}>{busy ? "กำลังวิเคราะห์…" : "วิเคราะห์"}</Button>
        </div>
        {err && <p className="mt-2 text-xs text-amber-400">{err}</p>}
        {busy && <p className="mt-2 text-xs text-(--color-muted)">คณะกรรมการกำลังพิจารณา (3 นักวิเคราะห์ + ประธาน) — อาจใช้เวลาสักครู่…</p>}
      </Card>

      {!r && !busy && <Empty title="ยังไม่มีผลวิเคราะห์" hint="พิมพ์ชื่อหุ้นแล้วกดวิเคราะห์" />}

      {r && v && (
        <div className="space-y-5">
          {/* recommendation banner */}
          <Card className="border-(--color-accent)/30">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="font-mono text-lg font-semibold">{r.symbol}</span>
                <span className="text-2xl">{verdictEmoji[v.rating]}</span>
                <Badge tone={verdictTone[v.rating]}>{v.rating.toUpperCase()}</Badge>
                <span className="text-xs text-(--color-muted)">{verdictAdvice[v.rating]}</span>
              </div>
              <span className="text-[11px] font-mono text-(--color-muted)">ราคา {f(r.price)} · horizon {v.horizon}</span>
            </div>
            <ul className="mt-3 space-y-1 text-sm list-disc list-inside">
              {v.thesis.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </Card>

          {/* trade plan — chart-derived vs AI */}
          <div>
            <CardTitle>🎯 แผนเทรด — จุดเข้า/ออก · แนวรับ-ต้าน</CardTitle>
            <div className="grid sm:grid-cols-2 gap-3">
              <Card className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase tracking-wide text-(--color-accent-2)">📐 จากกราฟ (เทคนิคอล)</span>
                  {lv?.rr != null && <Badge tone={lv.rr >= 1.5 ? "positive" : "warning"}>R:R {f(lv.rr, 1)}</Badge>}
                </div>
                <dl className="text-sm font-mono space-y-1">
                  <Row k="แนวต้าน / เป้า" val={f(lv?.resistance ?? null)} tone="up" />
                  <Row k="ราคาปัจจุบัน" val={f(r.price)} />
                  <Row k="แนวรับ" val={f(lv?.support ?? null)} tone="down" />
                  <Row k="Stop (ใต้แนวรับ)" val={f(lv?.stop ?? null)} tone="down" />
                </dl>
              </Card>
              <Card className="p-4">
                <span className="text-xs uppercase tracking-wide text-(--color-accent-2)">🤖 จาก AI (ประธานกรรมการ)</span>
                <dl className="text-sm font-mono space-y-1 mt-2">
                  <Row k="โซนเข้าสะสม" val={v.entryLow != null || v.entryHigh != null ? `${f(v.entryLow)} – ${f(v.entryHigh)}` : "—"} tone="down" />
                  <Row k="เป้าหมาย" val={f(v.target)} tone="up" />
                  <Row k="แนวต้าน" val={f(v.resistance)} />
                  <Row k="แนวรับ" val={f(v.support)} />
                  <Row k="Stop-loss" val={f(v.stopLoss)} tone="down" />
                </dl>
              </Card>
            </div>
            {v.entryHigh != null && r.price > v.entryHigh && (
              <p className="mt-2 text-xs text-amber-400">ราคาปัจจุบันสูงกว่าโซนเข้า — รอย่อก่อน (อย่าไล่ราคา)</p>
            )}
          </div>

          {/* long-term technicals */}
          {s && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="CAGR (5y)" value={pct(s.cagrPct)} sub="ต่อปี" />
              <Stat label="52w change" value={pct(s.change52wPct)} sub={`range pos ${f(s.rangePos52wPct, 0)}/100`} />
              <Stat label="vs 40-week MA" value={pct(s.priceVsSma40wPct)} sub={`MA ${f(s.sma40w)}`} />
              <Stat label="ห่างจากจุดสูงสุด 5y" value={pct(s.drawdownFromHighPct)} sub={`weekly RSI ${f(s.rsiWeekly, 0)}`} />
            </div>
          )}

          {/* fundamentals */}
          <div>
            <CardTitle>🏛️ พื้นฐาน {fu?.name ? `— ${fu.name}${fu.industry ? ` · ${fu.industry}` : ""}` : ""}</CardTitle>
            {fu?.note ? (
              <Card className="p-4"><p className="text-sm text-(--color-muted)">{fu.note}</p></Card>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="P/E (TTM)" value={f(fu?.peTTM ?? null)} sub={`P/B ${f(fu?.pb ?? null)}`} />
                <Stat label="ROE" value={pct(fu?.roePct ?? null)} sub={`net margin ${pct(fu?.netMarginPct ?? null)}`} />
                <Stat label="การเติบโต" value={pct(fu?.revenueGrowthPct ?? null)} sub={`EPS ${pct(fu?.epsGrowthPct ?? null)}`} />
                <Stat label="D/E" value={f(fu?.debtToEquity ?? null)} sub={`div yield ${pct(fu?.dividendYieldPct ?? null)}`} />
              </div>
            )}
          </div>

          {/* committee */}
          <div>
            <CardTitle>🧑‍⚖️ คณะกรรมการลงทุน</CardTitle>
            <div className="grid sm:grid-cols-3 gap-3">
              {r.views.map((view) => (
                <Card key={view.persona} className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-(--color-accent-2)">{view.persona}</span>
                    <Badge tone={stanceTone[view.stance]}>{view.stance}</Badge>
                  </div>
                  <div className="text-[11px] text-(--color-muted) mt-1">confidence {Math.round(view.confidence * 100)}%</div>
                  <p className="text-sm mt-2">{view.reason}</p>
                </Card>
              ))}
            </div>
          </div>

          {/* risks */}
          <Card className="border-amber-500/30">
            <CardTitle>⚠️ ความเสี่ยงสำคัญ</CardTitle>
            <ul className="space-y-1 text-sm list-disc list-inside">
              {v.risks.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </Card>

          <p className="text-[11px] text-(--color-muted)">วิเคราะห์เพื่อการศึกษาเท่านั้น ไม่ใช่คำแนะนำการลงทุน และไม่มีการซื้อขายจริงจากหน้านี้</p>
        </div>
      )}
    </div>
  );
}

function Row({ k, val, tone }: { k: string; val: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-emerald-400" : tone === "down" ? "text-rose-400" : "";
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-(--color-muted)">{k}</dt>
      <dd className={color}>{val}</dd>
    </div>
  );
}
