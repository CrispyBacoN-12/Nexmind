"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardTitle, Button, Badge } from "@/components/ui";

interface Portfolio {
  id: number; name: string; kind: string; status: string;
  killSwitch: boolean; killSwitchReason: string;
  maxOpenPositions: number; startingBalance: number; riskPctPerTrade: number;
  drawdownHaltPct: number; currentDrawdownPct: number;
}
interface Global { globalTradingHalt: boolean; fearGreed: { value: number; label: string } | null }

export function SafetyPanel({ portfolioId }: { portfolioId: number }) {
  const [p, setP] = useState<Portfolio | null>(null);
  const [g, setG] = useState<Global | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [list, glob] = await Promise.all([
      fetch("/api/portfolios?includeArchived=1").then((r) => r.json()) as Promise<Portfolio[]>,
      fetch("/api/settings").then((r) => r.json()) as Promise<Global>,
    ]);
    setP(list.find((x) => x.id === portfolioId) ?? null);
    setG(glob);
  }, [portfolioId]);
  useEffect(() => { void load(); }, [load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/portfolios/${portfolioId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      await load();
    } finally { setBusy(false); }
  }

  async function toggleGlobalHalt(next: boolean) {
    setBusy(true);
    try {
      await fetch("/api/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ globalTradingHalt: next }),
      });
      await load();
    } finally { setBusy(false); }
  }

  if (!p || !g) return null;
  const dd = p.currentDrawdownPct.toFixed(1);
  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-1">
        <CardTitle>🛡️ Safety · {p.name}</CardTitle>
        {g.fearGreed && <Badge tone="info">F&G {g.fearGreed.value} · {g.fearGreed.label}</Badge>}
      </div>

      {g.globalTradingHalt && (
        <div className="mt-2 rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          GLOBAL TRADING HALT is ON — every portfolio is blocked from new trades.
        </div>
      )}
      <div className="flex items-center justify-between gap-3 mt-2">
        <div className="text-sm font-medium">Global emergency halt</div>
        <Button size="sm" variant={g.globalTradingHalt ? "outline" : "danger"} disabled={busy}
          onClick={() => toggleGlobalHalt(!g.globalTradingHalt)}>
          {g.globalTradingHalt ? "Lift global halt" : "HALT ALL"}
        </Button>
      </div>

      {p.killSwitch && p.killSwitchReason && (
        <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {p.killSwitchReason}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 mt-2">
        <div className={`text-sm font-medium ${p.killSwitch ? "text-red-400" : ""}`}>
          {p.killSwitch ? "PORTFOLIO HALTED" : "Portfolio trading enabled"}
        </div>
        <Button size="sm" variant={p.killSwitch ? "outline" : "danger"} disabled={busy}
          onClick={() => patch({ killSwitch: !p.killSwitch })}>
          {p.killSwitch ? "Resume" : "STOP"}
        </Button>
      </div>

      <div className="flex items-center gap-2 mt-3">
        <label className="text-xs text-(--color-muted)">Max open positions</label>
        <input type="number" min={1} value={p.maxOpenPositions} disabled={busy}
          onChange={(e) => patch({ maxOpenPositions: Number(e.target.value) })}
          className="w-16 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm" />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <label className="text-xs text-(--color-muted)">Starting balance ($)</label>
        <input type="number" min={1} value={p.startingBalance} disabled={busy}
          onChange={(e) => patch({ startingBalance: Number(e.target.value) })}
          className="w-24 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm" />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <label className="text-xs text-(--color-muted)">Risk per trade (%)</label>
        <input type="number" min={0.1} step={0.1} value={p.riskPctPerTrade} disabled={busy}
          onChange={(e) => patch({ riskPctPerTrade: Number(e.target.value) })}
          className="w-16 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm" />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <label className="text-xs text-(--color-muted)">Max drawdown halt (%)</label>
        <input type="number" min={1} step={1} value={p.drawdownHaltPct} disabled={busy}
          onChange={(e) => patch({ drawdownHaltPct: Number(e.target.value) })}
          className="w-16 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm" />
      </div>
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-xs text-(--color-muted)">Current drawdown</span>
        <span className="text-xs font-mono">{dd === "0.0" ? "0.0%" : `-${dd}%`}</span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-3">
        <span className="text-xs text-(--color-muted)">Status: {p.status}</span>
        <Button size="sm" variant="outline" disabled={busy}
          onClick={() => patch({ status: p.status === "archived" ? "active" : "archived" })}>
          {p.status === "archived" ? "Unarchive" : "Archive"}
        </Button>
      </div>
    </Card>
  );
}
