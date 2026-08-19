"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardTitle, Button, Badge, PageHeader, Empty, Stat } from "@/components/ui";
import { fmtNumber } from "@/lib/utils";

type Mode = "short" | "long";

const MODE_TABS: { key: Mode; label: string }[] = [
  { key: "short", label: "⚡ ระยะสั้น (Swing)" },
  { key: "long", label: "🏛️ ระยะยาว (Invest)" },
];

interface Fundamentals {
  name: string | null; industry: string | null; marketCapM: number | null; peTTM: number | null; pb: number | null;
  roePct: number | null; netMarginPct: number | null; revenueGrowthPct: number | null; epsGrowthPct: number | null;
  debtToEquity: number | null; dividendYieldPct: number | null; note?: string;
}

const f = (n: number | null, d = 2) => (n == null ? "—" : fmtNumber(n, d));
const pct = (n: number | null, d = 1) => (n == null ? "—" : `${fmtNumber(n, d)}%`);

// ---- short-term (swing) result shape — from /api/analyze ----
type View = "bullish" | "bearish" | "neutral";
interface PersonaView { persona: string; view: View; confidence: number; reason: string }
interface Snapshot { price: number; sma20: number | null; sma50: number | null; rsi: number | null; adx: number | null; plusDI: number | null; minusDI: number | null; macdHist: number | null; atr: number | null }
interface ShortAnalysis {
  symbol: string; price: number; snapshot: Snapshot; scannerNote: string; fundamentals: Fundamentals;
  views: PersonaView[]; overall: { bias: View; confidence: number; summary: string };
  risk: { note: string; suggestedSl: number | null; suggestedTp: number | null };
  newsDigest: string; costUsd: number;
}

const viewTone: Record<View, "positive" | "negative" | "neutral"> = { bullish: "positive", bearish: "negative", neutral: "neutral" };
const viewEmoji: Record<View, string> = { bullish: "📈", bearish: "📉", neutral: "➖" };

// ---- long-term (invest) result shape — from /api/invest ----
type Stance = "buy" | "hold" | "avoid";
type Verdict = "strong-buy" | "buy" | "watch" | "avoid";
interface InvestorView { persona: string; stance: Stance; confidence: number; reason: string }
interface LongTermStats {
  price: number; cagrPct: number | null; change52wPct: number | null; sma40w: number | null;
  priceVsSma40wPct: number | null; drawdownFromHighPct: number; rangePos52wPct: number | null; rsiWeekly: number | null;
}
interface TechLevels {
  price: number; support: number | null; resistance: number | null; stop: number | null; target: number | null; rr: number | null; atr: number | null;
}
interface LongResult {
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

export default function AnalyzePage() {
  return (
    <Suspense fallback={null}>
      <AnalyzeInner />
    </Suspense>
  );
}

function AnalyzeInner() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>(searchParams.get("mode") === "long" ? "long" : "short");
  const [symbol, setSymbol] = useState("NVDA");

  const [a, setA] = useState<ShortAnalysis | null>(null);
  const [busyShort, setBusyShort] = useState(false);
  const [errShort, setErrShort] = useState("");

  const [r, setR] = useState<LongResult | null>(null);
  const [busyLong, setBusyLong] = useState(false);
  const [errLong, setErrLong] = useState("");

  async function runShort() {
    if (!symbol.trim() || busyShort) return;
    setBusyShort(true); setA(null); setErrShort("");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol }),
      });
      const data = await res.json();
      if (data.error) setErrShort(data.error);
      else setA(data);
    } catch (e) { setErrShort(String(e)); }
    finally { setBusyShort(false); }
  }

  async function runLong() {
    if (!symbol.trim() || busyLong) return;
    setBusyLong(true); setR(null); setErrLong("");
    try {
      const res = await fetch("/api/invest", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol }),
      });
      const data = await res.json();
      if (data.error) setErrLong(data.error);
      else setR(data);
    } catch (e) { setErrLong(String(e)); }
    finally { setBusyLong(false); }
  }

  function run() { void (mode === "short" ? runShort() : runLong()); }

  const busy = mode === "short" ? busyShort : busyLong;
  const err = mode === "short" ? errShort : errLong;
  const s = a?.snapshot;
  const stats = r?.stats;
  const fu = r?.fundamentals;
  const v = r?.verdict;
  const lv = r?.levels;

  return (
    <div>
      <PageHeader
        title="AI Analysis"
        description="HAWK×3 + SAGE อ่านหุ้นให้ทั้งมุมสั้นและมุมยาว — indicators, พื้นฐาน, ข่าว ในหน้าเดียว (วิเคราะห์อย่างเดียว ไม่ซื้อจริง)."
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {MODE_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setMode(t.key)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === t.key
                ? "border-(--color-accent) bg-(--color-accent)/10 text-(--color-foreground)"
                : "border-(--color-border) text-(--color-muted) hover:text-(--color-foreground)"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card className="mb-5">
        <div className="flex gap-2">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="symbol — NVDA, AAPL, PTT.BK, GC=F, BTC-USD"
            className="flex-1 h-10 rounded-md border border-(--color-border) bg-(--color-background) px-3 text-sm font-mono focus:outline-none focus:border-(--color-accent)/50"
          />
          <Button onClick={run} disabled={busy}>{busy ? "กำลังวิเคราะห์…" : "วิเคราะห์"}</Button>
        </div>
        {err && <p className="mt-2 text-xs text-amber-400">{err}</p>}
        {mode === "long" && busyLong && <p className="mt-2 text-xs text-(--color-muted)">คณะกรรมการกำลังพิจารณา (3 นักวิเคราะห์ + ประธาน) — อาจใช้เวลาสักครู่…</p>}
      </Card>

      {mode === "short" && (
        <>
          {!a && !busyShort && <Empty title="No analysis yet" hint="Enter a symbol and let the desk weigh in." />}
          {a && (
            <div className="space-y-5">
              <Card className="border-(--color-accent)/30">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-lg font-semibold">{a.symbol}</span>
                    <span className="text-2xl">{viewEmoji[a.overall.bias]}</span>
                    <Badge tone={viewTone[a.overall.bias]}>{a.overall.bias.toUpperCase()}</Badge>
                    <span className="text-xs text-(--color-muted)">confidence {Math.round(a.overall.confidence * 100)}%</span>
                  </div>
                  <span className="text-[11px] font-mono text-(--color-muted)">price {fmtNumber(a.price, 2)} · cost ${a.costUsd.toFixed(4)}</span>
                </div>
                <p className="mt-3 text-sm whitespace-pre-wrap">{a.overall.summary}</p>
              </Card>

              {s && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Stat label="RSI" value={fmtNumber(s.rsi, 1)} />
                  <Stat label="ADX" value={fmtNumber(s.adx, 1)} sub={`+DI ${fmtNumber(s.plusDI, 0)} / -DI ${fmtNumber(s.minusDI, 0)}`} />
                  <Stat label="SMA 20 / 50" value={`${fmtNumber(s.sma20, 2)} / ${fmtNumber(s.sma50, 2)}`} />
                  <Stat label="ATR" value={fmtNumber(s.atr, 2)} sub={`MACD ${fmtNumber(s.macdHist, 3)}`} />
                </div>
              )}

              <div>
                <CardTitle>🏛️ Fundamentals {a.fundamentals.name ? `— ${a.fundamentals.name}${a.fundamentals.industry ? ` · ${a.fundamentals.industry}` : ""}` : ""}</CardTitle>
                {a.fundamentals.note ? (
                  <Card className="p-4"><p className="text-sm text-(--color-muted)">{a.fundamentals.note}</p></Card>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Stat label="P/E (TTM)" value={f(a.fundamentals.peTTM)} sub={`P/B ${f(a.fundamentals.pb)}`} />
                    <Stat label="ROE" value={pct(a.fundamentals.roePct)} sub={`net margin ${pct(a.fundamentals.netMarginPct)}`} />
                    <Stat label="Growth" value={pct(a.fundamentals.revenueGrowthPct)} sub={`EPS ${pct(a.fundamentals.epsGrowthPct)}`} />
                    <Stat label="D/E" value={f(a.fundamentals.debtToEquity, 2)} sub={`div yield ${pct(a.fundamentals.dividendYieldPct)}`} />
                  </div>
                )}
              </div>

              <div>
                <CardTitle>🦅 HAWK — three perspectives</CardTitle>
                <div className="grid sm:grid-cols-3 gap-3">
                  {a.views.map((view) => (
                    <Card key={view.persona} className="p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs uppercase tracking-wide text-(--color-accent-2)">{view.persona}</span>
                        <Badge tone={viewTone[view.view]}>{view.view}</Badge>
                      </div>
                      <div className="text-[11px] text-(--color-muted) mt-1">confidence {Math.round(view.confidence * 100)}%</div>
                      <p className="text-sm mt-2">{view.reason}</p>
                    </Card>
                  ))}
                </div>
              </div>

              <Card className="border-amber-500/30">
                <CardTitle>🛡️ SAGE — risk read</CardTitle>
                <p className="text-sm">{a.risk.note}</p>
                {(a.risk.suggestedSl != null || a.risk.suggestedTp != null) && (
                  <div className="mt-2 flex gap-4 text-xs font-mono">
                    {a.risk.suggestedSl != null && <span className="text-rose-400/80">SL {fmtNumber(a.risk.suggestedSl, 2)}</span>}
                    {a.risk.suggestedTp != null && <span className="text-emerald-400/80">TP {fmtNumber(a.risk.suggestedTp, 2)}</span>}
                  </div>
                )}
              </Card>

              {a.newsDigest && (
                <Card>
                  <CardTitle>🛰️ Intel considered</CardTitle>
                  <p className="text-xs text-(--color-muted)">{a.newsDigest}</p>
                </Card>
              )}

              <p className="text-[11px] text-(--color-muted)">Analysis only — no order placed. Head to War Room to actually place a trade.</p>
            </div>
          )}
        </>
      )}

      {mode === "long" && (
        <>
          {!r && !busyLong && <Empty title="ยังไม่มีผลวิเคราะห์" hint="พิมพ์ชื่อหุ้นแล้วกดวิเคราะห์" />}
          {r && v && (
            <div className="space-y-5">
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

              {stats && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Stat label="CAGR (5y)" value={pct(stats.cagrPct)} sub="ต่อปี" />
                  <Stat label="52w change" value={pct(stats.change52wPct)} sub={`range pos ${f(stats.rangePos52wPct, 0)}/100`} />
                  <Stat label="vs 40-week MA" value={pct(stats.priceVsSma40wPct)} sub={`MA ${f(stats.sma40w)}`} />
                  <Stat label="ห่างจากจุดสูงสุด 5y" value={pct(stats.drawdownFromHighPct)} sub={`weekly RSI ${f(stats.rsiWeekly, 0)}`} />
                </div>
              )}

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

              <Card className="border-amber-500/30">
                <CardTitle>⚠️ ความเสี่ยงสำคัญ</CardTitle>
                <ul className="space-y-1 text-sm list-disc list-inside">
                  {v.risks.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </Card>

              <p className="text-[11px] text-(--color-muted)">วิเคราะห์เพื่อการศึกษาเท่านั้น ไม่ใช่คำแนะนำการลงทุน และไม่มีการซื้อขายจริงจากหน้านี้</p>
            </div>
          )}
        </>
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
