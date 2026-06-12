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
interface InvestResult {
  symbol: string; price: number; stats: LongTermStats; fundamentals: Fundamentals; views: InvestorView[];
  verdict: { rating: Verdict; entryLow: number | null; entryHigh: number | null; horizon: string; thesis: string[]; risks: string[] };
  costUsd: number;
}

const stanceTone: Record<Stance, "positive" | "neutral" | "negative"> = { buy: "positive", hold: "neutral", avoid: "negative" };
const verdictTone: Record<Verdict, "positive" | "info" | "warning" | "negative"> = {
  "strong-buy": "positive", buy: "positive", watch: "warning", avoid: "negative",
};
const verdictEmoji: Record<Verdict, string> = { "strong-buy": "🏆", buy: "✅", watch: "👀", avoid: "🚫" };

const f = (n: number | null, d = 1) => (n == null ? "—" : fmtNumber(n, d));
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

  return (
    <div>
      <PageHeader title="Long-term Invest" description="Buy-and-hold analysis — fundamentals + the weekly chart, weighed by a growth investor, a value investor, and a skeptic." />

      <Card className="mb-5">
        <div className="flex gap-2">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="symbol — AAPL, MSFT, PTT.BK"
            className="flex-1 h-10 rounded-md border border-(--color-border) bg-(--color-background) px-3 text-sm font-mono focus:outline-none focus:border-(--color-accent)/50"
          />
          <Button onClick={run} disabled={busy}>{busy ? "Researching…" : "Analyze"}</Button>
        </div>
        {err && <p className="mt-2 text-xs text-amber-400">{err}</p>}
        {busy && <p className="mt-2 text-xs text-(--color-muted)">Committee is deliberating (3 analysts + chair) — this can take a minute…</p>}
      </Card>

      {!r && !busy && <Empty title="No research yet" hint="Enter a symbol and let the investment committee weigh in." />}

      {r && (
        <div className="space-y-5">
          {/* verdict */}
          <Card className="border-(--color-accent)/30">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="font-mono text-lg font-semibold">{r.symbol}</span>
                <span className="text-2xl">{verdictEmoji[r.verdict.rating]}</span>
                <Badge tone={verdictTone[r.verdict.rating]}>{r.verdict.rating.toUpperCase()}</Badge>
                <span className="text-xs text-(--color-muted)">horizon: {r.verdict.horizon}</span>
              </div>
              <span className="text-[11px] font-mono text-(--color-muted)">price {f(r.price, 2)}</span>
            </div>
            {(r.verdict.entryLow != null || r.verdict.entryHigh != null) && (
              <div className="mt-3 text-sm">
                <span className="text-(--color-muted)">Accumulation zone: </span>
                <span className="font-mono text-emerald-400">
                  {f(r.verdict.entryLow, 2)} – {f(r.verdict.entryHigh, 2)}
                </span>
                {r.verdict.entryHigh != null && r.price > r.verdict.entryHigh && (
                  <span className="ml-2 text-xs text-amber-400">price is above the zone — patience</span>
                )}
              </div>
            )}
            <ul className="mt-3 space-y-1 text-sm list-disc list-inside">
              {r.verdict.thesis.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </Card>

          {/* long-term technicals */}
          {s && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="CAGR (5y)" value={pct(s.cagrPct)} sub="per year" />
              <Stat label="52w change" value={pct(s.change52wPct)} sub={`range pos ${f(s.rangePos52wPct, 0)}/100`} />
              <Stat label="vs 40-week MA" value={pct(s.priceVsSma40wPct)} sub={`MA ${f(s.sma40w, 2)}`} />
              <Stat label="Off 5y high" value={pct(s.drawdownFromHighPct)} sub={`weekly RSI ${f(s.rsiWeekly, 0)}`} />
            </div>
          )}

          {/* fundamentals */}
          <div>
            <CardTitle>🏛️ Fundamentals {fu?.name ? `— ${fu.name}${fu.industry ? ` · ${fu.industry}` : ""}` : ""}</CardTitle>
            {fu?.note ? (
              <Card className="p-4"><p className="text-sm text-(--color-muted)">{fu.note}</p></Card>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="P/E (TTM)" value={f(fu?.peTTM ?? null)} sub={`P/B ${f(fu?.pb ?? null)}`} />
                <Stat label="ROE" value={pct(fu?.roePct ?? null)} sub={`net margin ${pct(fu?.netMarginPct ?? null)}`} />
                <Stat label="Growth" value={pct(fu?.revenueGrowthPct ?? null)} sub={`EPS ${pct(fu?.epsGrowthPct ?? null)}`} />
                <Stat label="D/E" value={f(fu?.debtToEquity ?? null, 2)} sub={`div yield ${pct(fu?.dividendYieldPct ?? null)}`} />
              </div>
            )}
          </div>

          {/* committee */}
          <div>
            <CardTitle>🧑‍⚖️ Investment committee</CardTitle>
            <div className="grid sm:grid-cols-3 gap-3">
              {r.views.map((v) => (
                <Card key={v.persona} className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-(--color-accent-2)">{v.persona}</span>
                    <Badge tone={stanceTone[v.stance]}>{v.stance}</Badge>
                  </div>
                  <div className="text-[11px] text-(--color-muted) mt-1">confidence {Math.round(v.confidence * 100)}%</div>
                  <p className="text-sm mt-2">{v.reason}</p>
                </Card>
              ))}
            </div>
          </div>

          {/* risks */}
          <Card className="border-amber-500/30">
            <CardTitle>⚠️ Key risks</CardTitle>
            <ul className="space-y-1 text-sm list-disc list-inside">
              {r.verdict.risks.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </Card>

          <p className="text-[11px] text-(--color-muted)">Research only — nothing is bought. The trading desk and this page are independent.</p>
        </div>
      )}
    </div>
  );
}
