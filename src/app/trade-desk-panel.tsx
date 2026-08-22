"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardTitle, Button, Badge } from "@/components/ui";

interface TickStep { stage: string; note: string }
interface TickResult { symbol: string; outcome: string; steps: TickStep[]; tradeId?: number; costUsd: number }
interface PortfolioOption { id: number; name: string; kind: string; status: string; equity: number; realizedPnl: number; openCount: number; currentDrawdownPct: number; killSwitch: boolean }

/** Trade-tick execution + portfolio create/select — relocated from the former
 *  Command Bridge page so War Room is the one place to actually trade. */
export function TradeDeskPanel() {
  const router = useRouter();
  const [symbol, setSymbol] = useState("AAPL");
  const [tick, setTick] = useState<TickResult | null>(null);
  const [ticking, setTicking] = useState(false);

  const [portfolios, setPortfolios] = useState<PortfolioOption[]>([]);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const loadPortfolios = useCallback(async (selectId?: number) => {
    const list = (await fetch("/api/portfolios").then((r) => r.json())) as PortfolioOption[];
    const active = Array.isArray(list) ? list.filter((p) => p.status === "active") : [];
    setPortfolios(active);
    setSelectedPortfolioId((cur) => {
      if (selectId != null && active.some((p) => p.id === selectId)) return selectId;
      if (cur != null && active.some((p) => p.id === cur)) return cur;
      return active[0]?.id ?? null;
    });
  }, []);
  useEffect(() => { void loadPortfolios(); }, [loadPortfolios]);

  async function createPortfolio() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/portfolios", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, kind: "swing" }),
      });
      const created = await res.json();
      setNewName("");
      await loadPortfolios(created?.id);
      router.refresh();
    } finally { setCreating(false); }
  }

  const selected = portfolios.find((p) => p.id === selectedPortfolioId) ?? null;

  async function runTick() {
    if (!symbol.trim() || ticking || selectedPortfolioId == null) return;
    setTicking(true);
    setTick(null);
    try {
      const res = await fetch("/api/trade-tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, portfolioId: selectedPortfolioId }),
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        setTick(data);
        await loadPortfolios(selectedPortfolioId);
        router.refresh();
      }
    } finally {
      setTicking(false);
    }
  }

  return (
    <>
      <Card>
        <CardTitle>💼 Portfolio</CardTitle>
        {portfolios.length > 0 ? (
          <>
            <select
              value={selectedPortfolioId ?? ""}
              onChange={(e) => setSelectedPortfolioId(Number(e.target.value))}
              className="mt-2 w-full h-9 rounded-md border border-(--color-border) bg-(--color-background) px-3 text-sm focus:outline-none focus:border-(--color-accent)/50"
            >
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.killSwitch ? " · HALTED" : ""}</option>
              ))}
            </select>
            {selected && (
              <>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono text-(--color-muted)">
                  <span>equity ${selected.equity.toFixed(2)}</span>
                  <span>P/L ${selected.realizedPnl.toFixed(2)}</span>
                  <span>open {selected.openCount}</span>
                  <span>dd {selected.currentDrawdownPct.toFixed(1)}%</span>
                </div>
              </>
            )}
          </>
        ) : (
          <p className="mt-2 text-xs text-(--color-muted)">No portfolio yet — create one below to begin.</p>
        )}
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createPortfolio()}
              placeholder="New portfolio name"
              className="flex-1 h-9 rounded-md border border-(--color-border) bg-(--color-background) px-3 text-sm focus:outline-none focus:border-(--color-accent)/50"
            />
            <Button onClick={createPortfolio} disabled={creating} variant="outline" size="sm">
              {creating ? "…" : "Create"}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>📡 Trade Tick (paper)</CardTitle>
        <p className="text-xs text-(--color-muted) mb-3">Run the desk once on a US stock symbol — AAPL, MSFT, NVDA.</p>
        <div className="flex gap-2">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="flex-1 h-9 rounded-md border border-(--color-border) bg-(--color-background) px-3 text-sm font-mono focus:outline-none focus:border-(--color-accent)/50"
          />
          <Button onClick={runTick} disabled={ticking || selectedPortfolioId == null} variant="outline">{ticking ? "…" : "Run"}</Button>
        </div>
        {tick && (
          <div className="mt-4">
            <Badge tone={tick.outcome === "executed" ? "positive" : tick.outcome === "vetoed" ? "warning" : "neutral"}>{tick.outcome}</Badge>
            <ol className="mt-2 space-y-1 text-[11px] font-mono text-(--color-muted)">
              {tick.steps.map((s, i) => (
                <li key={i}><span className="text-(--color-accent)">{s.stage}</span> → {s.note}</li>
              ))}
            </ol>
            <p className="mt-2 text-[11px] text-(--color-muted)">cost ${tick.costUsd.toFixed(4)}</p>
          </div>
        )}
      </Card>
    </>
  );
}
