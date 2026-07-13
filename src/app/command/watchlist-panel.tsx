"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardTitle, Button, Badge } from "@/components/ui";
import { SECONDARY_PASSES } from "@/lib/trading/secondaryPasses";

interface Item { id: number; symbol: string; label: string | null; enabled: boolean }
interface ScanRow { symbol: string; outcome: string; costUsd: number; tradeId?: number; error?: string; pass: string }

const outcomeTone: Record<string, "positive" | "warning" | "negative" | "neutral" | "info"> = {
  executed: "positive", vetoed: "warning", "rules-blocked": "warning",
  "no-consensus": "neutral", "no-setup": "neutral", "already-open": "info", error: "negative",
};

export function WatchlistPanel({ portfolioId }: { portfolioId: number }) {
  const [items, setItems] = useState<Item[]>([]);
  const [sym, setSym] = useState("");
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<ScanRow[] | null>(null);
  const [summary, setSummary] = useState("");

  const load = useCallback(async () => {
    const data = await fetch(`/api/watchlist?portfolioId=${portfolioId}`).then((r) => r.json());
    setItems(Array.isArray(data) ? data : []);
  }, [portfolioId]);
  useEffect(() => { void load(); }, [load]);

  async function add() {
    const symbol = sym.trim();
    if (!symbol) return;
    await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ portfolioId, symbol }) });
    setSym(""); void load();
  }

  async function remove(id: number) {
    await fetch(`/api/watchlist?id=${id}&portfolioId=${portfolioId}`, { method: "DELETE" });
    void load();
  }

  async function scanAll() {
    if (scanning) return;
    setScanning(true); setResults(null); setSummary("");
    try {
      const passes = [
        { body: { portfolioId }, label: "default" },
        ...SECONDARY_PASSES.filter((sp) => sp.portfolioId === portfolioId).map((sp) => ({
          body: { portfolioId, strategy: sp.strategy, interval: sp.interval, range: sp.range },
          label: sp.label,
        })),
      ];
      const all: ScanRow[] = [];
      let scanned = 0, executed = 0, cost = 0;
      for (const p of passes) {
        const data = await fetch("/api/scan-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p.body) }).then((r) => r.json());
        for (const r of data.results ?? []) all.push({ ...r, pass: p.label });
        scanned += data.scanned ?? 0; executed += data.executed ?? 0; cost += data.totalCostUsd ?? 0;
      }
      setResults(all);
      const passSummary = passes.length > 1 ? ` across ${passes.length} strategy passes` : "";
      setSummary(`scanned ${scanned} · ${executed} executed · cost $${cost.toFixed(4)}${passSummary}`);
    } finally { setScanning(false); }
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-1">
        <CardTitle>📡 Watchlist</CardTitle>
        <Button size="sm" onClick={scanAll} disabled={scanning || items.length === 0}>
          {scanning ? "Scanning…" : "Scan all"}
        </Button>
      </div>
      <p className="text-xs text-(--color-muted) mb-3">Symbols the Scanner watches (Yahoo). Scan all runs the desk on each.</p>

      <div className="flex gap-2 mb-3">
        <input
          value={sym}
          onChange={(e) => setSym(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="add symbol e.g. TSLA, GC=F"
          className="flex-1 h-9 rounded-md border border-(--color-border) bg-(--color-background) px-3 text-sm font-mono focus:outline-none focus:border-(--color-accent)/50"
        />
        <Button onClick={add} variant="outline" size="sm">Add</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {items.map((it) => {
          const rows = results?.filter((x) => x.symbol === it.symbol) ?? [];
          const multi = rows.length > 1;
          return (
            <span key={it.id} className="inline-flex items-center gap-1.5 rounded-md border border-(--color-border) bg-(--color-card-2) pl-2 pr-1 py-1 text-xs">
              <span className="font-mono">{it.symbol}</span>
              {it.label && <span className="text-(--color-muted)">{it.label}</span>}
              {rows.map((r, i) => (
                <Badge key={i} tone={outcomeTone[r.outcome] ?? "neutral"}>
                  {multi ? `${r.pass}: ${r.outcome}` : r.outcome}
                </Badge>
              ))}
              <button onClick={() => remove(it.id)} className="text-(--color-muted) hover:text-rose-400 px-1" title="remove">×</button>
            </span>
          );
        })}
        {items.length === 0 && <span className="text-xs text-(--color-muted)">loading…</span>}
      </div>

      {summary && <p className="mt-3 text-[11px] font-mono text-(--color-accent)">{summary}</p>}
      {results && results.some((r) => r.outcome === "executed") && (
        <p className="mt-1 text-[11px] text-(--color-muted)">✓ new trades opened — see the War Room feed.</p>
      )}
    </Card>
  );
}
