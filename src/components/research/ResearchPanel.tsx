"use client";

import { useEffect, useState } from "react";
import { Card, CardTitle, Button, Badge } from "@/components/ui";
// Type-only, so nothing from the server module (prisma, the panel cache loader)
// is pulled into the client bundle.
import type { PanelBlindTestReport, PanelFoldReport } from "@/lib/research/blindTest";

interface ResearchStrategyRow {
  id: number;
  label: string;
  code: string;
  status: "proposed" | "approved" | "rejected" | "demoted";
  iterations: string; // JSON
  backtestSummary: string; // JSON
  blindTest: string; // JSON: the held-out verdict, or the error branch, or "{}"
  validation: string; // panel-v1 | legacy-single-symbol
  safetyFlag: boolean;
}
interface ResearchRunRow {
  id: number;
  brief: string;
  symbol: string;
  interval: string;
  range: string;
  status: "running" | "done" | "failed" | "skipped";
  costUsd: number;
  strategies: ResearchStrategyRow[];
}
interface Summary {
  trades: number; wins: number; losses: number; winRate: number; totalPnl: number;
  avgR: number | null; expectancy: number | null;
  profitFactor: number | null; maxDrawdownPct: number | null; sharpeRatio: number | null; sortinoRatio: number | null;
  totalCostsUsd: number;
}

/** What the blindTest column can hold: a full report, the error branch, or "{}" for a row that never reached the gate. */
type StoredVerdict = Partial<PanelBlindTestReport> & { error?: string; reasons?: string[] };

function parseSummary(json: string): Summary | null {
  try { return JSON.parse(json); } catch { return null; }
}

function parseVerdict(json: string): StoredVerdict | null {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" && Object.keys(v).length ? v : null;
  } catch { return null; }
}

const fx = (v: number | null | undefined, d = 2) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—";

/**
 * The held-out result, rendered next to the status it produced.
 *
 * The status badge alone cannot distinguish the three ways a row gets here: it
 * cleared all three TEST folds, it lost on one of them, or the gate never ran
 * (a mid-round DB failure fails closed to "rejected" — see applyBlindTestVerdict).
 * Only the last is worth re-running, so the panel has to say which happened.
 */
function BlindTest({ verdict }: { verdict: StoredVerdict }) {
  if (verdict.error) {
    return (
      <div className="mt-2 rounded border border-(--color-border) p-2 text-xs">
        <Badge tone="warning">blind test did not complete</Badge>
        <p className="mt-1 text-(--color-muted)">{verdict.error}</p>
        <p className="mt-1 text-(--color-muted)">Re-runnable — this is not a verdict on the strategy.</p>
      </div>
    );
  }
  const folds: PanelFoldReport[] = verdict.folds ?? [];
  if (!folds.length) return null;
  return (
    <div className="mt-2 rounded border border-(--color-border) p-2 text-xs">
      <div className="mb-1 flex items-center gap-2">
        <Badge tone={verdict.passed ? "positive" : "negative"}>
          {verdict.passed ? `survivor — cleared all ${folds.length} TEST folds` : "failed the held-out bar"}
        </Badge>
      </div>
      {folds.map((f) => (
        <div key={f.fold} className="font-mono text-(--color-muted)">
          <span className={f.passed ? "text-emerald-400" : "text-rose-400"}>
            {f.passed ? "PASS" : "FAIL"}
          </span>{" "}
          {f.fold} {f.from}..{f.to} · trades {f.summary.trades} · symbols {f.symbolsTraded}/{f.symbolsInFold} ·
          avgR {fx(f.summary.avgR)} · ctrl-p95 {f.control ? fx(f.control.p95) : "UNVERIFIED"} ·
          boot-p5 {f.bootstrap ? fx(f.bootstrap.p5) : "UNVERIFIED"}
          {!f.passed && f.reasons.length ? <span> — {f.reasons[0]}</span> : null}
        </div>
      ))}
      {verdict.caveat && <p className="mt-1 text-(--color-muted)">{verdict.caveat}</p>}
    </div>
  );
}

export default function ResearchPanel() {
  const [brief, setBrief] = useState("");
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
    if (!brief.trim() || running) return;
    setRunning(true);
    setRun(null);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief }),
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
      {/* No symbol/interval/range pickers any more: a round is always the whole
          S&P 500 panel on daily bars over the FIT fold. Offering a symbol box
          would let the operator ask for a run the pipeline no longer performs. */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-(--color-border) px-2 py-1.5 text-xs font-mono text-(--color-muted)">
          S&amp;P 500 panel · 1d · fit 2016–2018
        </span>
        <Button onClick={dispatch} disabled={running}>{running ? "Researching…" : "Dispatch QUANT"}</Button>
        {run && <span className="text-xs text-(--color-muted) font-mono">cost ${run.costUsd.toFixed(4)}</span>}
      </div>

      {run && (
        <div className="mt-4 space-y-3">
          <div className="text-xs text-(--color-muted)">Run #{run.id} · {run.status} · {run.symbol} {run.interval}/{run.range}</div>
          {run.strategies.map((s) => {
            const summary = parseSummary(s.backtestSummary);
            const verdict = parseVerdict(s.blindTest);
            const isOpen = expanded === s.id;
            return (
              <div key={s.id} className="rounded-md border border-(--color-border) p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{s.label}</span>
                    <Badge tone={s.status === "approved" ? "positive" : s.status === "rejected" ? "negative" : s.status === "demoted" ? "negative" : "neutral"}>{s.status}</Badge>
                    {/* Only panel-v1 rows are activatable (adapter.getResearchStrategy) —
                        an "approved" legacy row is not the same thing as a survivor. */}
                    {s.validation && s.validation !== "panel-v1" && <Badge tone="warning">{s.validation}</Badge>}
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
                    {/* These are FIT-fold numbers — the window the candidate was tuned on.
                        Unlabelled next to an "approved" badge they read as evidence for the
                        approval; the evidence is the held-out block below. */}
                    <span className="text-(--color-foreground)">fit fold</span>
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
                {verdict && <BlindTest verdict={verdict} />}
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
