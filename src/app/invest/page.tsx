"use client";

import { useState, useEffect, useCallback } from "react";
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

interface InvestPortfolio { id: number; name: string; kind: string; cash: number; maxOpenPositions: number }
interface HeldRow { id: number; symbol: string; shares: number; avgCost: number; price: number | null; marketValue: number; realizedPnl: number }
interface InvestStatsT { cash: number; marketValue: number; equity: number; unrealizedPnl: number; realizedPnl: number; missingPrices: string[] }
interface PlanAction { kind: "buy" | "add" | "trim" | "sell"; symbol: string; shares: number; estPrice: number; reason: string }

const actionTone: Record<PlanAction["kind"], "positive" | "negative" | "warning" | "info"> = {
  buy: "positive", add: "info", trim: "warning", sell: "negative",
};

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

  const [investPortfolios, setInvestPortfolios] = useState<InvestPortfolio[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [held, setHeld] = useState<HeldRow[]>([]);
  const [pstats, setPstats] = useState<InvestStatsT | null>(null);
  const [plan, setPlan] = useState<PlanAction[] | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [actingIdx, setActingIdx] = useState<number | null>(null);

  useEffect(() => {
    void fetch("/api/portfolios").then((r) => r.json()).then((list: InvestPortfolio[]) => {
      const invest = (Array.isArray(list) ? list : []).filter((p) => p.kind === "invest");
      setInvestPortfolios(invest);
      setSelectedId((cur) => cur ?? invest[0]?.id ?? null);
    });
  }, []);

  const loadHoldings = useCallback(async (id: number) => {
    const d = await fetch(`/api/invest/holdings?portfolioId=${id}`).then((r) => r.json());
    setHeld(d.holdings ?? []); setPstats(d.stats ?? null);
  }, []);
  useEffect(() => { if (selectedId != null) void loadHoldings(selectedId); }, [selectedId, loadHoldings]);

  async function generatePlan() {
    if (selectedId == null || planBusy) return;
    setPlanBusy(true); setPlan(null);
    try {
      const d = await fetch("/api/invest/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ portfolioId: selectedId }) }).then((r) => r.json());
      setPlan(d.actions ?? []); if (d.stats) setPstats(d.stats);
    } finally { setPlanBusy(false); }
  }

  async function approve(action: PlanAction, idx: number) {
    if (selectedId == null) return;
    setActingIdx(idx);
    try {
      await fetch("/api/invest/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ portfolioId: selectedId, action }) });
      await loadHoldings(selectedId);
      setPlan((p) => (p ? p.filter((_, i) => i !== idx) : p));
    } finally { setActingIdx(null); }
  }

  async function approveAll() {
    if (selectedId == null || !plan || plan.length === 0) return;
    setPlanBusy(true);
    try {
      await fetch("/api/invest/execute-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ portfolioId: selectedId, actions: plan }) });
      await loadHoldings(selectedId); setPlan(null);
    } finally { setPlanBusy(false); }
  }

  const s = r?.stats;
  const fu = r?.fundamentals;

  return (
    <div>
      <PageHeader title="Long-term Invest" description="Buy-and-hold analysis — fundamentals + the weekly chart, weighed by a growth investor, a value investor, and a skeptic." />

      {investPortfolios.length > 0 && (
        <Card className="mb-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <CardTitle>📈 Invest portfolio</CardTitle>
            <select
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="h-9 rounded-md border border-(--color-border) bg-(--color-background) px-2 text-sm"
            >
              {investPortfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {pstats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Stat label="Equity" value={f(pstats.equity, 0)} />
              <Stat label="Cash" value={f(pstats.cash, 0)} />
              <Stat label="Unrealized P/L" value={f(pstats.unrealizedPnl, 0)} />
              <Stat label="Realized P/L" value={f(pstats.realizedPnl, 0)} />
            </div>
          )}

          {held.length > 0 ? (
            <div className="space-y-1 mb-4">
              {held.map((h) => (
                <div key={h.id} className="flex items-center justify-between text-xs font-mono border-b border-(--color-border) py-1">
                  <span className="font-semibold">{h.symbol}</span>
                  <span className="text-(--color-muted)">{f(h.shares, 4)} @ {f(h.avgCost, 2)}</span>
                  <span>{h.price == null ? "—" : f(h.price, 2)}</span>
                  <span>{f(h.marketValue, 0)}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-(--color-muted) mb-4">No holdings yet — generate a plan to start buying.</p>}

          <div className="flex items-center gap-2">
            <Button onClick={generatePlan} disabled={planBusy}>{planBusy ? "Analyzing…" : "Generate rebalance plan"}</Button>
            {plan && plan.length > 0 && <Button variant="outline" onClick={approveAll} disabled={planBusy}>Approve all</Button>}
          </div>

          {plan && plan.length === 0 && <p className="mt-3 text-xs text-(--color-muted)">No actions — the portfolio is balanced.</p>}
          {plan && plan.length > 0 && (
            <div className="mt-3 space-y-2">
              {plan.map((a, i) => (
                <div key={`${a.kind}-${a.symbol}-${i}`} className="flex items-center justify-between gap-2 rounded-md border border-(--color-border) px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge tone={actionTone[a.kind]}>{a.kind.toUpperCase()}</Badge>
                    <span className="font-mono font-semibold">{a.symbol}</span>
                    <span className="text-(--color-muted) text-xs">{f(a.shares, 4)} @ ~{f(a.estPrice, 2)} · {a.reason}</span>
                  </div>
                  <Button size="sm" disabled={actingIdx === i} onClick={() => approve(a, i)}>{actingIdx === i ? "…" : "Approve"}</Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

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
