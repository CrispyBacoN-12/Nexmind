"use client";

import { useEffect, useState } from "react";
import { Card, CardTitle, Button, Badge } from "@/components/ui";

interface Settings {
  killSwitch: boolean;
  maxOpenPositions: number;
  fearGreed: { value: number; label: string } | null;
}

export function SafetyPanel() {
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setS(await fetch("/api/settings").then((r) => r.json()));
  }
  useEffect(() => { void load(); }, []);

  async function update(patch: Partial<Settings>) {
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
    </Card>
  );
}
