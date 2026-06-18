import { prisma } from "@/lib/db";
import { Card, CardTitle, Stat, Badge, PageHeader, Empty } from "@/components/ui";
import { fmtMoney, fmtNumber, fmtAgo, colorForChange } from "@/lib/utils";

export const dynamic = "force-dynamic";

type DecisionStep = { stage: string; note: string };
type HawkVote = { persona: string; vote: string; reason: string };

// War Room is split into three groups by portfolio kind. Each group shows every
// portfolio of that kind as its own block (stats + trade feed).
const KIND_TABS = [
  { key: "swing", label: "⚔️ Swing Desks" },
  { key: "invest", label: "🏛️ Long-term Invest" },
  { key: "options", label: "🎯 Options Desks" },
] as const;

type KindKey = (typeof KIND_TABS)[number]["key"];

// Match a portfolio to a tab. Swing is the default, so it also catches any
// legacy/unknown kind that is neither invest nor options.
function matchesKind(portfolioKind: string, tab: KindKey): boolean {
  if (tab === "invest") return portfolioKind === "invest";
  if (tab === "options") return portfolioKind === "options";
  return portfolioKind !== "invest" && portfolioKind !== "options";
}

export default async function WarRoom({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const sp = await searchParams;
  const selectedKind: KindKey = KIND_TABS.some((t) => t.key === sp.kind) ? (sp.kind as KindKey) : "swing";

  const allActive = await prisma.portfolio.findMany({ where: { status: "active" }, orderBy: { sort: "asc" } });
  const portfolios = allActive.filter((p) => matchesKind(p.kind, selectedKind));

  const news = await prisma.newsItem.findMany({ orderBy: { createdAt: "desc" }, take: 8 });

  // Gather each portfolio's feed + stats in parallel.
  const blocks = await Promise.all(
    portfolios.map(async (p) => {
      const [trades, vetoed, openCount] = await Promise.all([
        prisma.trade.findMany({ where: { portfolioId: p.id }, orderBy: { openedAt: "desc" }, take: 20 }),
        prisma.signal.findMany({ where: { status: "vetoed", portfolioId: p.id }, orderBy: { createdAt: "desc" }, take: 10 }),
        prisma.trade.count({ where: { status: "open", portfolioId: p.id } }),
      ]);
      const closed = trades.filter((t) => t.status === "closed");
      const wins = closed.filter((t) => t.outcome === "win").length;
      const winRate = closed.length ? (wins / closed.length) * 100 : 0;
      const realizedPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
      return { p, trades, vetoed, openCount, closed, wins, winRate, realizedPnl };
    }),
  );

  return (
    <div>
      <PageHeader
        title="War Room"
        description="Live decisions from the trading desk — Scanner → HAWK×3 → SAGE → Iron Rules → execution."
        action={<Badge tone="info">PAPER MODE</Badge>}
      />

      {/* Kind group tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {KIND_TABS.map((t) => {
          const count = allActive.filter((p) => matchesKind(p.kind, t.key)).length;
          const active = t.key === selectedKind;
          return (
            <a
              key={t.key}
              href={`/?kind=${t.key}`}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "border-(--color-accent) bg-(--color-accent)/10 text-(--color-foreground)"
                  : "border-(--color-border) text-(--color-muted) hover:text-(--color-foreground)"
              }`}
            >
              {t.label} <span className="text-(--color-muted) font-mono text-xs">· {count}</span>
            </a>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-8">
          {blocks.length === 0 ? (
            <Empty title="No portfolios in this group" hint="Create one from the Command Bridge and pick this kind." />
          ) : (
            blocks.map(({ p, trades, vetoed, openCount, closed, wins, winRate, realizedPnl }) => (
              <section key={p.id} className="space-y-3">
                <div className="flex items-center gap-2">
                  <CardTitle className="mb-0">{p.name}</CardTitle>
                  {p.killSwitch && <Badge tone="warning">HALTED</Badge>}
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <Stat label="Open Positions" value={openCount} />
                  <Stat label="Realized P/L" value={fmtMoney(realizedPnl)} subColor={colorForChange(realizedPnl)} sub={`${closed.length} closed`} />
                  <Stat label="Win Rate" value={`${fmtNumber(winRate, 0)}%`} sub={`${wins}/${closed.length}`} />
                  <Stat label="Vetoed by SAGE" value={vetoed.length} sub="risk blocks" />
                </div>

                {trades.length === 0 && vetoed.length === 0 ? (
                  <Empty title="No activity yet" hint="Run a trade tick from the Command Bridge or seed demo data." />
                ) : (
                  <div className="space-y-3">
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
                  </div>
                )}
              </section>
            ))
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
