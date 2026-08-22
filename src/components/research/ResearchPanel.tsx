"use client";

import { useEffect, useState } from "react";
import { Card, CardTitle, Button, Badge } from "@/components/ui";

interface ResearchStrategyRow {
  id: number;
  label: string;
  code: string;
  status: "proposed" | "approved" | "rejected";
  iterations: string; // JSON
  backtestSummary: string; // JSON
  safetyFlag: boolean;
}
interface ResearchRunRow {
  id: number;
  brief: string;
  symbol: string;
  interval: string;
  range: string;
  status: "running" | "done" | "failed";
  costUsd: number;
  strategies: ResearchStrategyRow[];
}
interface Summary {
  trades: number; wins: number; losses: number; winRate: number; totalPnl: number;
  avgR: number | null; expectancy: number | null;
  profitFactor: number | null; maxDrawdownPct: number | null; sharpeRatio: number | null; sortinoRatio: number | null;
  totalCostsUsd: number;
}

function parseSummary(json: string): Summary | null {
  try { return JSON.parse(json); } catch { return null; }
}

export default function ResearchPanel() {
  const [brief, setBrief] = useState("");
  const [symbol, setSymbol] = useState("AAPL");
  const [interval, setInterval_] = useState("1h");
  const [range, setRange] = useState("3mo");
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<ResearchRunRow | null>(null);
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  // Load the most recent run on mount so results dispatched elsewhere (e.g. by
  // Claude authoring candidates directly in a chat session) show up here too,
  // not just runs dispatched from this exact page load.
  useEffect(() => {
    (async () => {
      const runs = await fetch("/api/research").then((r) => r.json()).catch(() => []);
      if (!Array.isArray(runs) || !runs.length) return;
      const latest = await fetch(`/api/research?id=${runs[0].id}`).then((r) => r.json()).catch(() => null);
      if (latest && !latest.error) setRun(latest);
    })();
  }, []);

  async function dispatch() {
    if (!brief.trim() || !symbol.trim() || running) return;
    setRunning(true);
    setRun(null);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief, symbol, interval, range }),
      });
      const { runId, error } = await res.json();
      if (error) { alert(error); return; }
      const final = await fetch(`/api/research?id=${runId}`).then((r) => r.json());
      setRun(final);
    } finally {
      setRunning(false);
    }
  }

  async function review(strategyId: number, status: "approved" | "rejected") {
    setReviewing(strategyId);
    try {
      const res = await fetch(`/api/research/${strategyId}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const updated = await res.json();
      if (updated.error) { alert(updated.error); return; }
      setRun((prev) => prev && {
        ...prev,
        strategies: prev.strategies.map((s) => (s.id === strategyId ? { ...s, status: updated.status } : s)),
      });
    } finally {
      setReviewing(null);
    }
  }

  return (
    <Card className="mb-5">
      <CardTitle>🧬 QUANT — AI Strategy Research</CardTitle>
      <p className="text-xs text-(--color-muted) mb-3">
        Give QUANT a brief. It proposes 3 novel strategy candidates, safety-scans and sandbox-backtests each for free, then refines them. Nothing goes live until you approve a candidate below.
      </p>
      <textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        placeholder='e.g. "a mean-reversion strategy that only trades during low-ADX chop"'
        rows={2}
        className="w-full rounded-md border border-(--color-border) bg-(--color-background) px-3 py-2 text-sm focus:outline-none focus:border-(--color-accent)/50"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="Symbol"
          className="w-28 rounded-md border border-(--color-border) bg-(--color-background) px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-(--color-accent)/50"
        />
        <select
          value={interval}
          onChange={(e) => setInterval_(e.target.value)}
          className="rounded-md border border-(--color-border) bg-(--color-background) px-2 py-1.5 text-xs"
        >
          {["5m", "15m", "1h", "1d"].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="rounded-md border border-(--color-border) bg-(--color-background) px-2 py-1.5 text-xs"
        >
          {["5d", "1mo", "3mo", "1y"].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <Button onClick={dispatch} disabled={running}>{running ? "Researching…" : "Dispatch QUANT"}</Button>
        {run && <span className="text-xs text-(--color-muted) font-mono">cost ${run.costUsd.toFixed(4)}</span>}
      </div>

      {run && (
        <div className="mt-4 space-y-3">
          <div className="text-xs text-(--color-muted)">Run #{run.id} · {run.status} · {run.symbol} {run.interval}/{run.range}</div>
          {run.strategies.map((s) => {
            const summary = parseSummary(s.backtestSummary);
            const isOpen = expanded === s.id;
            return (
              <div key={s.id} className="rounded-md border border-(--color-border) p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{s.label}</span>
                    <Badge tone={s.status === "approved" ? "positive" : s.status === "rejected" ? "negative" : "neutral"}>{s.status}</Badge>
                    {s.safetyFlag && <Badge tone="warning">safety-flagged</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="text-xs text-(--color-accent) underline" onClick={() => setExpanded(isOpen ? null : s.id)}>
                      {isOpen ? "hide code" : "view code"}
                    </button>
                    <Button
                      variant="outline"
                      disabled={s.status !== "proposed" || reviewing === s.id || s.safetyFlag}
                      onClick={() => review(s.id, "approved")}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      disabled={s.status !== "proposed" || reviewing === s.id}
                      onClick={() => review(s.id, "rejected")}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
                {summary && (
                  <div className="mt-2 flex flex-wrap gap-3 text-xs font-mono text-(--color-muted)">
                    <span>trades {summary.trades}</span>
                    <span>win% {summary.winRate.toFixed(0)}</span>
                    <span>avgR {summary.avgR == null ? "—" : summary.avgR.toFixed(2)}</span>
                    <span>expectancy {summary.expectancy == null ? "—" : summary.expectancy.toFixed(2)}</span>
                    <span>total P/L {summary.totalPnl.toFixed(2)}</span>
                    <span>PF {summary.profitFactor == null ? "—" : summary.profitFactor.toFixed(2)}</span>
                    <span>max DD {summary.maxDrawdownPct == null ? "—" : `${summary.maxDrawdownPct.toFixed(1)}%`}</span>
                    <span>Sharpe {summary.sharpeRatio == null ? "—" : summary.sharpeRatio.toFixed(2)}</span>
                    <span>Sortino {summary.sortinoRatio == null ? "—" : summary.sortinoRatio.toFixed(2)}</span>
                    <span>costs {summary.totalCostsUsd == null ? "—" : summary.totalCostsUsd.toFixed(2)}</span>
                  </div>
                )}
                {isOpen && (
                  <pre className="mt-2 max-h-64 overflow-auto rounded bg-(--color-background) p-2 text-[11px] font-mono whitespace-pre-wrap">{s.code}</pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
