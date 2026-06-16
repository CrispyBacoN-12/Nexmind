"use client";

import { useState } from "react";
import { Card, CardTitle, Button, Badge } from "@/components/ui";

interface SetupRow { symbol: string; outcome: string; tradeId?: number }
interface ScanResp {
  source?: string; scanned?: number; executed?: number;
  setups?: SetupRow[]; totalCostUsd?: number;
  managed?: { checked: number; closed: number }; error?: string;
}

const PRESETS = [
  { id: "us-mega", label: "US Mega" },
  { id: "dow30", label: "Dow 30" },
  { id: "nasdaq100", label: "NASDAQ-100" },
];

const tone: Record<string, "positive" | "warning" | "neutral"> = {
  executed: "positive", vetoed: "warning", "rules-blocked": "warning", "no-consensus": "neutral",
};

export function MarketScanPanel({ portfolioId }: { portfolioId: number }) {
  const [busy, setBusy] = useState<"" | "scan" | "discover" | "manage">("");
  const [resp, setResp] = useState<ScanResp | null>(null);

  async function scan(body: object, kind: "scan" | "discover") {
    if (busy) return;
    setBusy(kind); setResp(null);
    try {
      const data = await fetch("/api/scan-universe", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, portfolioId }),
      }).then((r) => r.json());
      setResp(data);
    } finally { setBusy(""); }
  }

  async function manage() {
    if (busy) return;
    setBusy("manage"); setResp(null);
    try {
      const d = await fetch("/api/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ portfolioId }) }).then((r) => r.json());
      setResp({ managed: { checked: d.checked, closed: d.closed?.length ?? 0 }, setups: [] });
    } finally { setBusy(""); }
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-1">
        <CardTitle>🌎 Market Scan (US)</CardTitle>
        <Button size="sm" variant="outline" onClick={manage} disabled={!!busy} title="Close positions that hit TP/SL">
          {busy === "manage" ? "…" : "↻ Update positions"}
        </Button>
      </div>
      <p className="text-xs text-(--color-muted) mb-3">Scan a whole US universe or today&apos;s movers — symbols you never typed. Scanner filters free; AI only on setups.</p>

      <div className="flex flex-wrap gap-2 mb-2">
        {PRESETS.map((p) => (
          <Button key={p.id} size="sm" variant="outline" disabled={!!busy} onClick={() => scan({ preset: p.id }, "scan")}>
            {busy === "scan" ? "…" : p.label}
          </Button>
        ))}
        <Button size="sm" disabled={!!busy} onClick={() => scan({ discover: true }, "discover")}>
          {busy === "discover" ? "Discovering…" : "🔥 Today's movers"}
        </Button>
      </div>

      {resp && (
        <div className="mt-3 text-xs">
          {resp.error && <p className="text-amber-400">{resp.error}</p>}
          {resp.managed && (
            <p className="text-(--color-muted)">positions checked {resp.managed.checked} · closed {resp.managed.closed}</p>
          )}
          {resp.scanned != null && (
            <p className="text-(--color-accent) font-mono">
              {resp.source}: scanned {resp.scanned} · {resp.executed} executed · cost ${(resp.totalCostUsd ?? 0).toFixed(4)}
            </p>
          )}
          {resp.setups && resp.setups.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {resp.setups.map((s) => (
                <span key={s.symbol} className="inline-flex items-center gap-1.5 rounded border border-(--color-border) bg-(--color-card-2) px-2 py-0.5">
                  <span className="font-mono">{s.symbol}</span>
                  <Badge tone={tone[s.outcome] ?? "neutral"}>{s.outcome}</Badge>
                </span>
              ))}
            </div>
          ) : resp.scanned != null ? (
            <p className="mt-2 text-(--color-muted)">No setups found this pass — the desk stayed flat.</p>
          ) : null}
        </div>
      )}
    </Card>
  );
}
