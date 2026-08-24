import { prisma } from "@/lib/db";
import { Card, CardTitle, Stat, PageHeader, Empty, Badge } from "@/components/ui";
import { fmtNumber, fmtAgo } from "@/lib/utils";
import { MIN_TRADES, MIN_PROFIT_FACTOR } from "@/lib/research/autoReview";
import type { BacktestSummary as FullBacktestSummary } from "@/lib/backtest/engine";

export const dynamic = "force-dynamic";

// A run stuck in "running" past this age almost certainly means the process
// that was executing it died mid-round rather than one still in flight.
const STALE_RUNNING_MS = 30 * 60 * 1000;

function safeParse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

type BacktestSummary = Partial<FullBacktestSummary>;

// Mirrors autoReviewStatus() exactly, broken into its individual checks so the
// page can show *why* a candidate landed where it did, not just the verdict.
function reviewChecks(bt: BacktestSummary, safetyFlag: boolean) {
  const trades = bt.trades ?? 0;
  const expectancy = bt.expectancy ?? null;
  const pf = bt.profitFactor ?? null;
  return [
    { label: "safety scan", pass: !safetyFlag, detail: safetyFlag ? "flagged by deny-list scan" : "clean" },
    { label: "trade count", pass: trades >= MIN_TRADES, detail: `${trades} (need ${MIN_TRADES}+)` },
    {
      label: "expectancy",
      pass: expectancy != null && expectancy > 0,
      detail: expectancy != null ? `$${fmtNumber(expectancy, 2)}/trade` : "n/a",
    },
    {
      label: "profit factor",
      pass: pf == null || pf >= MIN_PROFIT_FACTOR,
      detail: pf == null ? "no losers" : `${fmtNumber(pf, 2)} (need ${MIN_PROFIT_FACTOR}+)`,
    },
  ];
}

function runBadge(status: string, stale: boolean) {
  if (status === "running") return <Badge tone={stale ? "negative" : "warning"}>{stale ? "stalled" : "running"}</Badge>;
  if (status === "failed") return <Badge tone="negative">failed</Badge>;
  // A round the mock proposer would have filled is banked as "skipped", not
  // "done" — see runResearch(). Without this branch it falls through to the
  // green "done" badge and reads as a successful round that produced nothing.
  if (status === "skipped") return <Badge tone="warning">skipped</Badge>;
  return <Badge tone="positive">done</Badge>;
}

function strategyBadge(status: string, safetyFlag: boolean) {
  if (safetyFlag) return <Badge tone="warning">flagged</Badge>;
  if (status === "approved") return <Badge tone="positive">approved</Badge>;
  if (status === "rejected") return <Badge tone="neutral">rejected</Badge>;
  if (status === "demoted") return <Badge tone="negative">demoted</Badge>;
  return <Badge tone="info">proposed</Badge>;
}

export default async function ResearchPage() {
  const [runs, totalRuns, totalStrategies, approvedCount, runningRuns, allStrategies] = await Promise.all([
    prisma.researchRun.findMany({
      orderBy: { id: "desc" },
      take: 30,
      include: { strategies: { select: { id: true, label: true, status: true, safetyFlag: true, backtestSummary: true } } },
    }),
    prisma.researchRun.count(),
    prisma.researchStrategy.count(),
    prisma.researchStrategy.count({ where: { status: "approved" } }),
    prisma.researchRun.findMany({ where: { status: "running" }, orderBy: { id: "desc" } }),
    prisma.researchStrategy.findMany({
      select: {
        id: true, label: true, status: true, safetyFlag: true, backtestSummary: true, runId: true,
        run: { select: { symbol: true, interval: true, range: true } },
      },
    }),
  ]);

  const now = Date.now();
  const stale = runningRuns.filter((r) => now - r.createdAt.getTime() > STALE_RUNNING_MS);
  const active = runningRuns.filter((r) => now - r.createdAt.getTime() <= STALE_RUNNING_MS);

  // Leaderboard: every candidate that actually traded, ranked by expectancy —
  // the metric autoReviewStatus() itself gates on — so a viewer can see how
  // any one strategy stacks up against every other one this project has tried.
  const leaderboard = allStrategies
    .map((s) => ({ ...s, bt: safeParse<BacktestSummary>(s.backtestSummary, {}) }))
    .filter((s) => (s.bt.trades ?? 0) > 0 && s.bt.expectancy != null)
    .sort((a, b) => (b.bt.expectancy ?? 0) - (a.bt.expectancy ?? 0))
    .slice(0, 10);

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

      {leaderboard.length > 0 && (
        <div className="mb-6">
          <CardTitle>Leaderboard — ranked by expectancy</CardTitle>
          <Card className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-(--color-muted) border-b border-(--color-border)">
                  <th className="text-left py-2 px-3">#</th>
                  <th className="text-left py-2 px-3">Strategy</th>
                  <th className="text-left py-2 px-3">Symbol</th>
                  <th className="text-right py-2 px-3">Trades</th>
                  <th className="text-right py-2 px-3">Win%</th>
                  <th className="text-right py-2 px-3">PF</th>
                  <th className="text-right py-2 px-3">Expectancy</th>
                  <th className="text-right py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((s, i) => (
                  <tr key={s.id} className="border-b border-(--color-border)/40 hover:bg-(--color-border)/10">
                    <td className="py-2 px-3 font-mono text-(--color-muted)">{i + 1}</td>
                    <td className="py-2 px-3 font-medium">
                      {s.label}
                      <span className="text-(--color-muted) text-xs font-mono"> · run #{s.runId}</span>
                    </td>
                    <td className="py-2 px-3 text-xs text-(--color-muted) font-mono">
                      {s.run.symbol} {s.run.interval}/{s.run.range}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">{s.bt.trades}</td>
                    <td className="py-2 px-3 text-right font-mono">{fmtNumber(s.bt.winRate, 0)}%</td>
                    <td className="py-2 px-3 text-right font-mono">{fmtNumber(s.bt.profitFactor, 2)}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-400">
                      ${fmtNumber(s.bt.expectancy, 2)}
                    </td>
                    <td className="py-2 px-3 text-right">{strategyBadge(s.status, s.safetyFlag)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <p className="mt-2 text-[11px] text-(--color-muted)">
            Ranked by expectancy (avg P/L per trade) — the metric the auto-reviewer itself gates on. A high rank here doesn&apos;t
            guarantee &quot;approved&quot;: a candidate can top this list on a handful of lucky trades and still get rejected below
            for too few trades or a weak profit factor — check its badge and the reasons in Recent runs below.
          </p>
        </div>
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
                          <div key={s.id} className="border-t border-(--color-border) pt-1.5">
                            <div className="flex items-center justify-between gap-3 text-xs">
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
                            {bt.trades != null && s.status !== "proposed" && (
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono">
                                {reviewChecks(bt, s.safetyFlag).map((c) => (
                                  <span key={c.label} className={c.pass ? "text-emerald-400/80" : "text-rose-400/80"}>
                                    {c.pass ? "✓" : "✗"} {c.label}: {c.detail}
                                  </span>
                                ))}
                              </div>
                            )}
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
