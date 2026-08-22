"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardTitle, Button, Badge, PageHeader, Empty } from "@/components/ui";
import { WatchlistPanel } from "./watchlist-panel";
import { SafetyPanel } from "./safety-panel";
import { MarketScanPanel } from "./market-scan-panel";

const HANDOFF_KEY = "nexmind:buildRequest";

interface Step { id: number; order: number; agent: string; task: string; status: string; output: string | null; model: string | null; costUsd: number }
interface Pipeline { id: number; command: string; status: string; summary: string | null; costUsd: number; steps: Step[] }
interface TickStep { stage: string; note: string }
interface TickResult { symbol: string; outcome: string; steps: TickStep[]; tradeId?: number; costUsd: number }
interface PortfolioOption { id: number; name: string; kind: string; status: string; equity: number; realizedPnl: number; openCount: number; currentDrawdownPct: number; killSwitch: boolean }

export default function CommandBridge() {
  const router = useRouter();
  const [command, setCommand] = useState("");
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [running, setRunning] = useState(false);

  // Hand the command + the team's work over to the Builder to turn into real files.
  function sendToBuilder() {
    if (!pipeline) return;
    const brief = [
      pipeline.command,
      "",
      "Team brief (turn this into real Next.js files):",
      ...pipeline.steps.map((s) => `[${s.agent}] ${s.output ?? ""}`),
    ]
      .join("\n")
      .slice(0, 4000);
    sessionStorage.setItem(HANDOFF_KEY, brief);
    router.push("/build");
  }

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
    } finally { setCreating(false); }
  }

  const selected = portfolios.find((p) => p.id === selectedPortfolioId) ?? null;

  async function submit() {
    if (!command.trim() || running) return;
    setRunning(true);
    setPipeline(null);
    try {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const { pipelineId, error } = await res.json();
      if (error) { alert(error); return; }
      // The pipeline runs server-side before responding; fetch the final state.
      const final = await fetch(`/api/pipeline?id=${pipelineId}`).then((r) => r.json());
      setPipeline(final);
    } finally {
      setRunning(false);
    }
  }

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
      else setTick(data);
    } finally {
      setTicking(false);
    }
  }

  return (
    <div>
      <PageHeader title="Command Bridge" description="Give ARIA a command — she routes it to the right team, runs each step, and reports back." />

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardTitle>🗝️ ARIA — Secretary Pipeline</CardTitle>
            <textarea
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder='เช่น "ออกแบบหน้า dashboard โดยคำนึงถึงความสวยงามเป็นหลัก"'
              rows={3}
              className="w-full rounded-md border border-(--color-border) bg-(--color-background) px-3 py-2 text-sm focus:outline-none focus:border-(--color-accent)/50"
            />
            <div className="mt-3 flex items-center gap-3">
              <Button onClick={submit} disabled={running}>{running ? "Running pipeline…" : "Dispatch"}</Button>
              {pipeline && <span className="text-xs text-(--color-muted) font-mono">cost ${pipeline.costUsd.toFixed(4)}</span>}
            </div>
          </Card>

          {pipeline ? (
            <div className="space-y-3">
              <CardTitle>Pipeline #{pipeline.id} · {pipeline.status}</CardTitle>
              {pipeline.steps.map((s) => (
                <Card key={s.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge tone="info">{s.agent}</Badge>
                      <span className="text-sm text-(--color-muted)">{s.task}</span>
                    </div>
                    <Badge tone={s.status === "done" ? "positive" : s.status === "failed" ? "negative" : "neutral"}>{s.status}</Badge>
                  </div>
                  {s.output && <p className="mt-2 text-sm whitespace-pre-wrap text-(--color-foreground)/90">{s.output}</p>}
                </Card>
              ))}
              {pipeline.summary && (
                <Card className="border-(--color-accent)/30">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle>🗝️ ARIA Summary</CardTitle>
                    <Button size="sm" variant="outline" onClick={sendToBuilder}>🔨 ส่งให้ Builder สร้างจริง</Button>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{pipeline.summary}</p>
                </Card>
              )}
            </div>
          ) : (
            !running && <Empty title="No pipeline yet" hint="Dispatch a command to see the step-by-step timeline." />
          )}
        </div>

        <div className="space-y-4">
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
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono text-(--color-muted)">
                    <span>equity ${selected.equity.toFixed(2)}</span>
                    <span>P/L ${selected.realizedPnl.toFixed(2)}</span>
                    <span>open {selected.openCount}</span>
                    <span>dd {selected.currentDrawdownPct.toFixed(1)}%</span>
                  </div>
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
              <Button onClick={runTick} disabled={ticking} variant="outline">{ticking ? "…" : "Run"}</Button>
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

          {selectedPortfolioId != null ? (
            <>
              <SafetyPanel portfolioId={selectedPortfolioId} onChanged={() => loadPortfolios()} />
              <WatchlistPanel portfolioId={selectedPortfolioId} />
              <MarketScanPanel portfolioId={selectedPortfolioId} />
            </>
          ) : (
            <Empty title="Create a portfolio to begin" hint="The desk controls appear once you have a portfolio selected." />
          )}
        </div>
      </div>
    </div>
  );
}
