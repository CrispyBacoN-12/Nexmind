import { prisma } from "@/lib/db";
import { Card, CardTitle, Stat, PageHeader, Empty, Badge } from "@/components/ui";
import { fmtNumber, fmtAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

// A run stuck in "running" past this age almost certainly means the process
// that was executing it died mid-round rather than one still in flight.
const STALE_RUNNING_MS = 30 * 60 * 1000;

function safeParse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

type BacktestSummary = { trades?: number; winRate?: number; totalPnl?: number; profitFactor?: number };

function runBadge(status: string, stale: boolean) {
  if (status === "running") return <Badge tone={stale ? "negative" : "warning"}>{stale ? "stalled" : "running"}</Badge>;
  if (status === "failed") return <Badge tone="negative">failed</Badge>;
  return <Badge tone="positive">done</Badge>;
}

function strategyBadge(status: string, safetyFlag: boolean) {
  if (safetyFlag) return <Badge tone="warning">flagged</Badge>;
  if (status === "approved") return <Badge tone="positive">approved</Badge>;
  if (status === "rejected") return <Badge tone="neutral">rejected</Badge>;
  return <Badge tone="info">proposed</Badge>;
}

export default async function ResearchPage() {
  const [runs, totalRuns, totalStrategies, approvedCount, runningRuns] = await Promise.all([
    prisma.researchRun.findMany({
      orderBy: { id: "desc" },
      take: 30,
      include: { strategies: { select: { id: true, label: true, status: true, safetyFlag: true, backtestSummary: true } } },
    }),
    prisma.researchRun.count(),
    prisma.researchStrategy.count(),
    prisma.researchStrategy.count({ where: { status: "approved" } }),
    prisma.researchRun.findMany({ where: { status: "running" }, orderBy: { id: "desc" } }),
  ]);

  const now = Date.now();
  const stale = runningRuns.filter((r) => now - r.createdAt.getTime() > STALE_RUNNING_MS);
  const active = runningRuns.filter((r) => now - r.createdAt.getTime() <= STALE_RUNNING_MS);

  return (
    <div>
      <PageHeader
        title="Quant Research"
        description="The self-directed research loop is triggered by hand (scripts/run-research-round.mts), not a background job — this page reflects the last time someone ran it, not a live feed."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Total runs" value={totalRuns} />
        <Stat label="Strategies proposed" value={totalStrategies} />
        <Stat label="Approved" value={approvedCount} />
        <Stat
          label="Running now"
          value={active.length}
          sub={stale.length > 0 ? `${stale.length} stalled` : undefined}
          subColor={stale.length > 0 ? "text-amber-400" : undefined}
        />
      </div>

      {active.length === 0 && stale.length === 0 && (
        <Card className="mb-6 border-(--color-border)">
          <p className="text-sm text-(--color-muted)">Nothing is running right now. No one has kicked off a research round recently.</p>
        </Card>
      )}

      {active.map((r) => (
        <Card key={r.id} className="mb-4 border-cyan-500/30 bg-cyan-500/5">
          <div className="flex items-center justify-between">
            <CardTitle className="mb-0">Run #{r.id} in progress</CardTitle>
            <Badge tone="warning">running</Badge>
          </div>
          <p className="mt-2 text-sm">{r.symbol} · {r.interval}/{r.range}</p>
          <p className="mt-1 text-xs text-(--color-muted)">{r.brief}</p>
          <p className="mt-2 text-[11px] text-(--color-muted) font-mono">started {fmtAgo(r.createdAt)}</p>
        </Card>
      ))}

      {stale.map((r) => (
        <Card key={r.id} className="mb-4 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center justify-between">
            <CardTitle className="mb-0">Run #{r.id} likely stalled</CardTitle>
            <Badge tone="negative">stalled</Badge>
          </div>
          <p className="mt-2 text-sm">{r.symbol} · {r.interval}/{r.range}</p>
          <p className="mt-1 text-xs text-(--color-muted)">{r.brief}</p>
          <p className="mt-2 text-[11px] text-(--color-muted) font-mono">
            started {fmtAgo(r.createdAt)} — still marked &quot;running&quot; with no strategies produced; the process behind it most likely died before finishing.
          </p>
        </Card>
      ))}

      <div className="mt-2">
        <CardTitle>Recent runs</CardTitle>
        {runs.length === 0 ? (
          <Empty title="No research runs yet" hint="Kick one off with: npx tsx scripts/run-research-round.mts &quot;&lt;brief&gt;&quot; &lt;symbol&gt;" />
        ) : (
          <div className="space-y-2">
            {runs.map((r) => {
              const runStale = r.status === "running" && now - r.createdAt.getTime() > STALE_RUNNING_MS;
              return (
                <details key={r.id} className="rounded-lg border border-(--color-border) bg-(--color-card) p-4">
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="font-mono text-sm font-medium">#{r.id}</span>{" "}
                        <span className="text-sm">{r.symbol}</span>{" "}
                        <span className="text-xs text-(--color-muted) font-mono">{r.interval}/{r.range}</span>
                        <p className="text-xs text-(--color-muted) mt-1 truncate">{r.brief}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-(--color-muted) font-mono">{fmtAgo(r.createdAt)}</span>
                        {runBadge(r.status, runStale)}
                      </div>
                    </div>
                  </summary>
                  {r.strategies.length === 0 ? (
                    <p className="mt-3 text-xs text-(--color-muted)">No strategies produced yet.</p>
                  ) : (
                    <div className="mt-3 space-y-1.5">
                      {r.strategies.map((s) => {
                        const bt = safeParse<BacktestSummary>(s.backtestSummary, {});
                        return (
                          <div key={s.id} className="flex items-center justify-between gap-3 text-xs border-t border-(--color-border) pt-1.5">
                            <span className="truncate">{s.label}</span>
                            <div className="flex items-center gap-2 shrink-0 font-mono text-(--color-muted)">
                              {bt.trades != null && (
                                <span>
                                  {bt.trades}t · {fmtNumber(bt.winRate, 0)}% win · pf {fmtNumber(bt.profitFactor, 2)}
                                </span>
                              )}
                              {strategyBadge(s.status, s.safetyFlag)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </details>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
