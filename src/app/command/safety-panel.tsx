"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardTitle, Button, Badge } from "@/components/ui";

interface Portfolio {
  id: number; name: string; kind: string; status: string;
  killSwitch: boolean; killSwitchReason: string;
  maxOpenPositions: number; startingBalance: number; riskPctPerTrade: number;
  drawdownHaltPct: number; currentDrawdownPct: number;
  scanInterval: string; scanRange: string; strategy: string;
}

// Entry strategies selectable for swing portfolios (keys mirror the registry).
const STRATEGY_OPTIONS: { key: string; label: string }[] = [
  { key: "trend-pullback", label: "Trend-pullback (default)" },
  { key: "ema-cross", label: "EMA Cross (9/21)" },
  { key: "orb", label: "Opening Range Breakout" },
  { key: "fvg", label: "Fair Value Gap (ICT)" },
  { key: "mean-rev", label: "Mean Reversion (RSI 30/70)" },
  { key: "combo-or", label: "Combo OR (Trend+ORB+FVG)" },
  { key: "combo-vote", label: "Combo Vote≥2 (Trend+ORB+FVG)" },
];

// Scanner timeframe presets (interval|range). Day trade uses short intraday
// bars; swing/position widen out.
const TIMEFRAME_PRESETS: { label: string; interval: string; range: string }[] = [
  { label: "Day trade · 15m / 5d", interval: "15m", range: "5d" },
  { label: "Swing · 1h / 3mo", interval: "1h", range: "3mo" },
  { label: "Position · 1d / 1y", interval: "1d", range: "1y" },
];
interface Global { globalTradingHalt: boolean; fearGreed: { value: number; label: string } | null }

export function SafetyPanel({ portfolioId, onChanged }: { portfolioId: number; onChanged?: () => void }) {
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
      onChanged?.();
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
      onChanged?.();
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
      {p.kind === "swing" && (
        <div className="flex items-center gap-2 mt-2">
          <label className="text-xs text-(--color-muted)">Scan timeframe</label>
          <select
            value={`${p.scanInterval}|${p.scanRange}`}
            disabled={busy}
            onChange={(e) => {
              const [interval, range] = e.target.value.split("|");
              patch({ scanInterval: interval, scanRange: range });
            }}
            className="rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm"
          >
            {TIMEFRAME_PRESETS.some((t) => t.interval === p.scanInterval && t.range === p.scanRange) ? null : (
              <option value={`${p.scanInterval}|${p.scanRange}`}>{p.scanInterval} / {p.scanRange}</option>
            )}
            {TIMEFRAME_PRESETS.map((t) => (
              <option key={t.label} value={`${t.interval}|${t.range}`}>{t.label}</option>
            ))}
          </select>
        </div>
      )}
      {p.kind === "swing" && (
        <div className="flex items-center gap-2 mt-2">
          <label className="text-xs text-(--color-muted)">Entry strategy</label>
          <select
            value={p.strategy}
            disabled={busy}
            onChange={(e) => patch({ strategy: e.target.value })}
            className="rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm"
          >
            {STRATEGY_OPTIONS.some((s) => s.key === p.strategy) ? null : <option value={p.strategy}>{p.strategy}</option>}
            {STRATEGY_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
      )}
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
