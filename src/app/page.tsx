import { prisma } from "@/lib/db";
import { Card, CardTitle, Stat, Badge, PageHeader, Empty } from "@/components/ui";
import { fmtMoney, fmtNumber, fmtAgo, colorForChange } from "@/lib/utils";

export const dynamic = "force-dynamic";

type DecisionStep = { stage: string; note: string };
type HawkVote = { persona: string; vote: string; reason: string };

export default async function WarRoom({ searchParams }: { searchParams: Promise<{ portfolio?: string }> }) {
  const sp = await searchParams;
  const activePortfolios = await prisma.portfolio.findMany({ where: { status: "active" }, orderBy: { sort: "asc" } });
  const selectedId = Number(sp.portfolio) || activePortfolios[0]?.id || 0;

  const [trades, vetoed, news, openCount] = await Promise.all([
    prisma.trade.findMany({ where: { portfolioId: selectedId }, orderBy: { openedAt: "desc" }, take: 20 }),
    prisma.signal.findMany({ where: { status: "vetoed", portfolioId: selectedId }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.newsItem.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.trade.count({ where: { status: "open", portfolioId: selectedId } }),
  ]);

  const closed = trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => t.outcome === "win").length;
  const winRate = closed.length ? (wins / closed.length) * 100 : 0;
  const realizedPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="War Room"
        description="Live decisions from the trading desk — Scanner → HAWK×3 → SAGE → Iron Rules → execution."
        action={<Badge tone="info">PAPER MODE</Badge>}
      />

      {activePortfolios.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {activePortfolios.map((p) => (
            <a
              key={p.id}
              href={`/?portfolio=${p.id}`}
              className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors ${
                p.id === selectedId
                  ? "border-(--color-accent) bg-(--color-accent)/10 text-(--color-foreground)"
                  : "border-(--color-border) text-(--color-muted) hover:text-(--color-foreground)"
              }`}
            >
              {p.name}
            </a>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Open Positions" value={openCount} />
        <Stat label="Realized P/L (paper)" value={fmtMoney(realizedPnl)} subColor={colorForChange(realizedPnl)} sub={`${closed.length} closed`} />
        <Stat label="Win Rate" value={`${fmtNumber(winRate, 0)}%`} sub={`${wins}/${closed.length}`} />
        <Stat label="Vetoed by SAGE" value={vetoed.length} sub="risk blocks" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <CardTitle>Live Trade Feed</CardTitle>
          {trades.length === 0 && vetoed.length === 0 ? (
            <Empty title="No activity yet" hint="Run a trade tick from the Command Bridge or seed demo data." />
          ) : (
            <>
              {trades.map((t) => {
                const votes = safeParse<HawkVote[]>(t.hawkVotes, []);
                const log = safeParse<DecisionStep[]>(t.decisionLog, []);
                const longSide = t.side === "long";
                return (
                  <Card key={`t${t.id}`} className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-semibold">{t.symbol}</span>
                        <Badge tone={longSide ? "positive" : "negative"}>{t.side.toUpperCase()}</Badge>
                        <Badge tone={t.status === "open" ? "info" : t.outcome === "win" ? "positive" : t.outcome === "loss" ? "negative" : "neutral"}>
                          {t.status === "open" ? "OPEN" : (t.outcome ?? "closed").toUpperCase()}
                        </Badge>
                      </div>
                      <div className="text-right">
                        {t.pnl != null && <div className={`font-semibold tabular-nums ${colorForChange(t.pnl)}`}>{fmtMoney(t.pnl)}</div>}
                        <div className="text-[11px] text-(--color-muted) font-mono">{fmtAgo(t.openedAt)}</div>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono text-(--color-muted)">
                      <span>entry {fmtNumber(t.entry, 4)}</span>
                      <span className="text-rose-400/80">SL {fmtNumber(t.sl, 4)}</span>
                      <span className="text-emerald-400/80">TP1 {fmtNumber(t.tp1, 4)}</span>
                      <span>R:R {t.riskReward ?? "—"}</span>
                    </div>
                    {votes.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {votes.map((v, i) => (
                          <span key={i} className="text-[11px] rounded bg-(--color-card-2) border border-(--color-border) px-2 py-0.5">
                            <span className="text-(--color-accent-2)">{v.persona}</span> · {v.vote}
                          </span>
                        ))}
                      </div>
                    )}
                    {t.sageVerdict && <p className="mt-2 text-xs text-amber-300/80">🛡️ SAGE: {t.sageVerdict}</p>}
                    {log.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-[11px] text-(--color-muted) cursor-pointer hover:text-(--color-foreground)">decision trail ({log.length})</summary>
                        <ol className="mt-1 space-y-0.5 text-[11px] font-mono text-(--color-muted)">
                          {log.map((s, i) => (
                            <li key={i}><span className="text-(--color-accent)">{s.stage}</span> → {s.note}</li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </Card>
                );
              })}
              {vetoed.map((s) => (
                <Card key={`v${s.id}`} className="p-4 border-rose-500/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-semibold">{s.symbol}</span>
                      <Badge tone="warning">VETOED</Badge>
                    </div>
                    <span className="text-[11px] text-(--color-muted) font-mono">{fmtAgo(s.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-xs text-rose-300/80">{s.note}</p>
                </Card>
              ))}
            </>
          )}
        </div>

        <div className="space-y-3">
          <CardTitle>🛰️ SCOUT Intel</CardTitle>
          {news.length === 0 ? (
            <Empty title="No intel yet" hint="SCOUT pulls free news, funding, and sentiment daily." />
          ) : (
            news.map((n) => (
              <Card key={n.id} className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="neutral">{n.source}</Badge>
                  {n.sentiment && (
                    <Badge tone={n.sentiment === "bullish" ? "positive" : n.sentiment === "bearish" ? "negative" : "neutral"}>{n.sentiment}</Badge>
                  )}
                </div>
                <p className="mt-2 text-sm font-medium leading-snug">{n.title}</p>
                {n.summary && <p className="mt-1 text-xs text-(--color-muted)">{n.summary}</p>}
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function safeParse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
