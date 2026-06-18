"use client";

import { useState } from "react";
import { Card, CardTitle, Button, Badge, PageHeader, Empty, Stat } from "@/components/ui";
import { fmtNumber } from "@/lib/utils";

type View = "bullish" | "bearish" | "neutral";
interface PersonaView { persona: string; view: View; confidence: number; reason: string }
interface Snapshot { price: number; sma20: number | null; sma50: number | null; rsi: number | null; adx: number | null; plusDI: number | null; minusDI: number | null; macdHist: number | null; atr: number | null }
interface Fundamentals {
  name: string | null; industry: string | null; marketCapM: number | null; peTTM: number | null; pb: number | null;
  roePct: number | null; netMarginPct: number | null; revenueGrowthPct: number | null; epsGrowthPct: number | null;
  debtToEquity: number | null; dividendYieldPct: number | null; note?: string;
}
interface Analysis {
  symbol: string; price: number; snapshot: Snapshot; scannerNote: string; fundamentals: Fundamentals;
  views: PersonaView[]; overall: { bias: View; confidence: number; summary: string };
  risk: { note: string; suggestedSl: number | null; suggestedTp: number | null };
  newsDigest: string; costUsd: number;
}

const viewTone: Record<View, "positive" | "negative" | "neutral"> = { bullish: "positive", bearish: "negative", neutral: "neutral" };
const viewEmoji: Record<View, string> = { bullish: "📈", bearish: "📉", neutral: "➖" };

const f = (n: number | null, d = 1) => (n == null ? "—" : fmtNumber(n, d));
const pct = (n: number | null, d = 1) => (n == null ? "—" : `${fmtNumber(n, d)}%`);

export default function AnalyzePage() {
  const [symbol, setSymbol] = useState("NVDA");
  const [busy, setBusy] = useState(false);
  const [a, setA] = useState<Analysis | null>(null);
  const [err, setErr] = useState("");

  async function run() {
    if (!symbol.trim() || busy) return;
    setBusy(true); setA(null); setErr("");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol }),
      });
      const data = await res.json();
      if (data.error) setErr(data.error);
      else setA(data);
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  const s = a?.snapshot;

  return (
    <div>
      <PageHeader title="AI Stock Analysis" description="HAWK's 3 analysts + SAGE's risk read on any symbol — indicators + news, no trade placed." />

      <Card className="mb-5">
        <div className="flex gap-2">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="symbol — NVDA, PTT.BK, GC=F, BTC-USD"
            className="flex-1 h-10 rounded-md border border-(--color-border) bg-(--color-background) px-3 text-sm font-mono focus:outline-none focus:border-(--color-accent)/50"
          />
          <Button onClick={run} disabled={busy}>{busy ? "Analyzing…" : "Analyze"}</Button>
        </div>
        {err && <p className="mt-2 text-xs text-amber-400">{err}</p>}
      </Card>

      {!a && !busy && <Empty title="No analysis yet" hint="Enter a symbol and let the desk weigh in." />}

      {a && (
        <div className="space-y-5">
          {/* verdict */}
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

          {/* indicators */}
          {s && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="RSI" value={fmtNumber(s.rsi, 1)} />
              <Stat label="ADX" value={fmtNumber(s.adx, 1)} sub={`+DI ${fmtNumber(s.plusDI, 0)} / -DI ${fmtNumber(s.minusDI, 0)}`} />
              <Stat label="SMA 20 / 50" value={`${fmtNumber(s.sma20, 2)} / ${fmtNumber(s.sma50, 2)}`} />
              <Stat label="ATR" value={fmtNumber(s.atr, 2)} sub={`MACD ${fmtNumber(s.macdHist, 3)}`} />
            </div>
          )}

          {/* fundamentals */}
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

          {/* HAWK 3 perspectives */}
          <div>
            <CardTitle>🦅 HAWK — three perspectives</CardTitle>
            <div className="grid sm:grid-cols-3 gap-3">
              {a.views.map((v) => (
                <Card key={v.persona} className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-(--color-accent-2)">{v.persona}</span>
                    <Badge tone={viewTone[v.view]}>{v.view}</Badge>
                  </div>
                  <div className="text-[11px] text-(--color-muted) mt-1">confidence {Math.round(v.confidence * 100)}%</div>
                  <p className="text-sm mt-2">{v.reason}</p>
                </Card>
              ))}
            </div>
          </div>

          {/* SAGE risk */}
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

          <p className="text-[11px] text-(--color-muted)">Analysis only — no order placed. Use the Command Bridge to actually trade.</p>
        </div>
      )}
    </div>
  );
}
