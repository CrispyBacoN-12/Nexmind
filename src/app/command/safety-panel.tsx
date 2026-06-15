"use client";

import { useEffect, useState } from "react";
import { Card, CardTitle, Button, Badge } from "@/components/ui";

interface Settings {
  killSwitch: boolean;
  killSwitchReason: string;
  maxOpenPositions: number;
  startingBalance: number;
  riskPctPerTrade: number;
  drawdownHaltPct: number;
  currentDrawdownPct: number;
  fearGreed: { value: number; label: string } | null;
}

export function SafetyPanel() {
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setS(await fetch("/api/settings").then((r) => r.json()));
  }
  useEffect(() => { void load(); }, []);

  async function update(patch: { killSwitch?: boolean; maxOpenPositions?: number; startingBalance?: number; riskPctPerTrade?: number; drawdownHaltPct?: number }) {
    setBusy(true);
    try {
      setS(await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).then((r) => r.json()));
    } finally {
      setBusy(false);
    }
  }

  if (!s) return null;
  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-1">
        <CardTitle>🛡️ Safety</CardTitle>
        {s.fearGreed && <Badge tone="info">F&G {s.fearGreed.value} · {s.fearGreed.label}</Badge>}
      </div>
      {s.killSwitch && s.killSwitchReason && (
        <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {s.killSwitchReason}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 mt-2">
        <div>
          <div className={`text-sm font-medium ${s.killSwitch ? "text-red-400" : ""}`}>
            {s.killSwitch ? "TRADING HALTED" : "Trading enabled"}
          </div>
          <p className="text-xs text-(--color-muted)">
            Kill switch blocks all new trades. Open positions still close at SL/TP.
          </p>
        </div>
        <Button
          size="sm"
          variant={s.killSwitch ? "outline" : "danger"}
          disabled={busy}
          onClick={() => update({ killSwitch: !s.killSwitch })}
        >
          {s.killSwitch ? "Resume trading" : "EMERGENCY STOP"}
        </Button>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <label className="text-xs text-(--color-muted)">Max open positions</label>
        <input
          type="number"
          min={1}
          value={s.maxOpenPositions}
          disabled={busy}
          onChange={(e) => update({ maxOpenPositions: Number(e.target.value) })}
          className="w-16 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm"
        />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <label className="text-xs text-(--color-muted)">Starting balance ($)</label>
        <input
          type="number"
          min={1}
          value={s.startingBalance}
          disabled={busy}
          onChange={(e) => update({ startingBalance: Number(e.target.value) })}
          className="w-24 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm"
        />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <label className="text-xs text-(--color-muted)">Risk per trade (%)</label>
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={s.riskPctPerTrade}
          disabled={busy}
          onChange={(e) => update({ riskPctPerTrade: Number(e.target.value) })}
          className="w-16 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm"
        />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <label className="text-xs text-(--color-muted)">Max drawdown halt (%)</label>
        <input
          type="number"
          min={1}
          step={1}
          value={s.drawdownHaltPct}
          disabled={busy}
          onChange={(e) => update({ drawdownHaltPct: Number(e.target.value) })}
          className="w-16 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm"
        />
      </div>
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-xs text-(--color-muted)">Current drawdown</span>
        <span className="text-xs font-mono">
          {(() => {
            const ddPct = s.currentDrawdownPct.toFixed(1);
            return ddPct === "0.0" ? "0.0%" : `-${ddPct}%`;
          })()}
        </span>
      </div>
    </Card>
  );
}
