"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardTitle, Button, Badge, PageHeader, Empty, Stat } from "@/components/ui";
import { fmtNumber } from "@/lib/utils";

interface OptionsPortfolio { id: number; name: string; kind: string; cash: number; maxOpenPositions: number }

interface HoldingRow {
  id: number;
  underlying: string;
  type: "call" | "put";
  strike: number;
  expiry: string;
  contracts: number;
  premiumPaid: number;
  premium: number | null;
  marketValue: number;
  delta: number | null;
  theta: number | null;
}

interface OptionStatsT {
  cash: number;
  marketValue: number;
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number;
  missingPremiums: string[];
}

interface OptionsRunSummary {
  settled: string[];
  closed: string[];
  opened: string[];
  errors: string[];
}

const f = (n: number | null | undefined, d = 2) => (n == null ? "—" : fmtNumber(n, d));

function daysLeft(expiry: string): number {
  return Math.ceil((new Date(expiry).getTime() - Date.now()) / 86_400_000);
}

function pnlColor(n: number | null | undefined): string {
  if (n == null) return "";
  if (n > 0) return "text-emerald-400";
  if (n < 0) return "text-rose-400";
  return "";
}

export default function OptionsPage() {
  const [portfolios, setPortfolios] = useState<OptionsPortfolio[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [held, setHeld] = useState<HoldingRow[]>([]);
  const [stats, setStats] = useState<OptionStatsT | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [runSummary, setRunSummary] = useState<OptionsRunSummary | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    void fetch("/api/portfolios").then((r) => r.json()).then((list: OptionsPortfolio[]) => {
      const opts = (Array.isArray(list) ? list : []).filter((p) => p.kind === "options");
      setPortfolios(opts);
      setSelectedId((cur) => cur ?? opts[0]?.id ?? null);
    });
  }, []);

  const loadHoldings = useCallback(async (id: number) => {
    const d = await fetch(`/api/options/holdings?portfolioId=${id}`).then((r) => r.json());
    setHeld(d.holdings ?? []);
    setStats(d.stats ?? null);
  }, []);

  useEffect(() => {
    setRunSummary(null);
    if (selectedId != null) void loadHoldings(selectedId);
  }, [selectedId, loadHoldings]);

  async function runDesk() {
    if (selectedId == null || runBusy) return;
    setRunBusy(true); setRunSummary(null); setErr("");
    try {
      const res = await fetch("/api/options/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolioId: selectedId }),
      });
      const data = await res.json();
      if (data.error) { setErr(data.error); }
      else {
        setRunSummary(data as OptionsRunSummary);
        await loadHoldings(selectedId);
      }
    } catch (e) { setErr(String(e)); }
    finally { setRunBusy(false); }
  }

  if (portfolios.length === 0) {
    return (
      <div>
        <PageHeader
          title="Options Desk"
          description="Autonomous delta-targeted call/put positions — settle, roll, and open by conviction."
          action={<Badge tone="warning">PAPER MODE</Badge>}
        />
        <Empty
          title="No options portfolio"
          hint="Create a portfolio with kind = options to get started."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Options Desk"
        description="Autonomous delta-targeted call/put positions — settle, roll, and open by conviction."
        action={<Badge tone="warning">PAPER MODE</Badge>}
      />

      <Card className="mb-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <CardTitle>🎯 Options portfolio</CardTitle>
          <select
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(Number(e.target.value))}
            className="h-9 rounded-md border border-(--color-border) bg-(--color-background) px-2 text-sm"
          >
            {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Stat label="Equity" value={f(stats.equity, 0)} />
            <Stat label="Cash" value={f(stats.cash, 0)} />
            <Stat label="Unrealized P/L" value={<span className={pnlColor(stats.unrealizedPnl)}>{f(stats.unrealizedPnl, 0)}</span>} />
            <Stat label="Realized P/L" value={<span className={pnlColor(stats.realizedPnl)}>{f(stats.realizedPnl, 0)}</span>} />
          </div>
        )}

        {held.length > 0 ? (
          <div className="mb-4 overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-(--color-muted) border-b border-(--color-border)">
                  <th className="text-left py-1 pr-3">Underlying</th>
                  <th className="text-left py-1 pr-3">Type</th>
                  <th className="text-right py-1 pr-3">Strike</th>
                  <th className="text-right py-1 pr-3">Expiry</th>
                  <th className="text-right py-1 pr-3">Days</th>
                  <th className="text-right py-1 pr-3">Contracts</th>
                  <th className="text-right py-1 pr-3">Paid</th>
                  <th className="text-right py-1 pr-3">Current</th>
                  <th className="text-right py-1 pr-3">Mkt Val</th>
                  <th className="text-right py-1 pr-3">Delta</th>
                  <th className="text-right py-1">Theta</th>
                </tr>
              </thead>
              <tbody>
                {held.map((h) => {
                  const days = daysLeft(h.expiry);
                  return (
                    <tr key={h.id} className="border-b border-(--color-border)/50 hover:bg-(--color-border)/10">
                      <td className="py-1 pr-3 font-semibold">{h.underlying}</td>
                      <td className="py-1 pr-3">
                        <Badge tone={h.type === "call" ? "positive" : "negative"}>{h.type.toUpperCase()}</Badge>
                      </td>
                      <td className="py-1 pr-3 text-right">{f(h.strike, 2)}</td>
                      <td className="py-1 pr-3 text-right text-(--color-muted)">{new Date(h.expiry).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}</td>
                      <td className={`py-1 pr-3 text-right ${days <= 7 ? "text-amber-400" : ""}`}>{days}d</td>
                      <td className="py-1 pr-3 text-right">{h.contracts}</td>
                      <td className="py-1 pr-3 text-right text-(--color-muted)">{f(h.premiumPaid, 2)}</td>
                      <td className="py-1 pr-3 text-right">{h.premium == null ? "—" : f(h.premium, 2)}</td>
                      <td className="py-1 pr-3 text-right">{f(h.marketValue, 0)}</td>
                      <td className="py-1 pr-3 text-right">{f(h.delta, 3)}</td>
                      <td className="py-1 text-right">{f(h.theta, 3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-(--color-muted) mb-4">No open positions — run the options desk to open new ones.</p>
        )}

        <div className="flex items-center gap-2">
          <Button onClick={runDesk} disabled={runBusy}>{runBusy ? "Running desk…" : "Run options desk"}</Button>
        </div>
        {err && <p className="mt-2 text-xs text-amber-400">{err}</p>}
        {runBusy && <p className="mt-2 text-xs text-(--color-muted)">Settling expired, rolling near-expiry, opening new positions…</p>}
      </Card>

      {runSummary && (
        <Card>
          <CardTitle>📋 Run summary</CardTitle>
          {runSummary.settled.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-(--color-muted) uppercase tracking-wide mb-1">Settled</p>
              <ul className="space-y-1">
                {runSummary.settled.map((s, i) => <li key={i} className="text-xs text-cyan-300">{s}</li>)}
              </ul>
            </div>
          )}
          {runSummary.closed.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-(--color-muted) uppercase tracking-wide mb-1">Closed</p>
              <ul className="space-y-1">
                {runSummary.closed.map((s, i) => <li key={i} className="text-xs text-amber-400">{s}</li>)}
              </ul>
            </div>
          )}
          {runSummary.opened.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-(--color-muted) uppercase tracking-wide mb-1">Opened</p>
              <ul className="space-y-1">
                {runSummary.opened.map((s, i) => <li key={i} className="text-xs text-emerald-400">{s}</li>)}
              </ul>
            </div>
          )}
          {runSummary.errors.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-(--color-muted) uppercase tracking-wide mb-1">Errors</p>
              <ul className="space-y-1">
                {runSummary.errors.map((s, i) => <li key={i} className="text-xs text-rose-400">{s}</li>)}
              </ul>
            </div>
          )}
          {runSummary.settled.length === 0 && runSummary.closed.length === 0 && runSummary.opened.length === 0 && runSummary.errors.length === 0 && (
            <p className="text-xs text-(--color-muted)">No actions taken — nothing to do.</p>
          )}
        </Card>
      )}
    </div>
  );
}
