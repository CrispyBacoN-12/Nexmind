import { prisma } from "@/lib/db";
import { aiOutageStatus } from "@/lib/anthropic";
import { Card, CardTitle, Stat, Badge, PageHeader, Empty } from "@/components/ui";
import { fmtMoney, fmtNumber, fmtAgo, colorForChange } from "@/lib/utils";
import { TradeDeskPanel } from "./trade-desk-panel";
import { EquityCurveChart } from "./equity-curve-chart";
import { WebullPanel } from "./webull-panel";

export const dynamic = "force-dynamic";

type DecisionStep = { stage: string; note: string };
type HawkVote = { persona: string; vote: string; reason: string };

export default async function WarRoom() {
  const portfolios = await prisma.portfolio.findMany({ where: { status: "active" }, orderBy: { sort: "asc" } });

  // The desk keeps trading without AI, on rules alone. That is a legitimate mode
  // — but silently, it looks exactly like a working analyst team, which is how
  // 27 rule-only trades ended up on the page labelled as HAWK votes.
  const outage = await aiOutageStatus();

  const news = await prisma.newsItem.findMany({ orderBy: { createdAt: "desc" }, take: 8 });

  // Gather each portfolio's positions/feed in parallel, shaped by the active kind.
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

      {outage && (
        <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <p className="text-sm font-medium text-amber-300">⚠️ AI offline — decisions are rule-only</p>
          <p className="mt-1 text-xs text-(--color-muted)">
            HAWK and SAGE are not running: {outage.reason}{outage.ageMs > 60_000 ? ` (${fmtAgo(new Date(Date.now() - outage.ageMs))})` : ""}.
            New trades still pass the Scanner and the Iron Rules, but the
            analyst votes and the risk veto are deterministic stand-ins and are marked <span className="font-mono">MOCK AI</span>.
          </p>
        </div>
      )}

      <div className="mb-6">
        <WebullPanel />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-8">
          {blocks.length === 0 ? (
            <Empty title="No active portfolios" hint="Create one in the Trade Desk panel." />
          ) : (
            blocks.map((b) => (
              <section key={b.p.id} className="space-y-3">
                <div className="flex items-center gap-2">
                  <CardTitle className="mb-0">{b.p.name}</CardTitle>
                  {b.p.killSwitch && <Badge tone="warning">HALTED</Badge>}
                </div>

                <SwingBlock b={b} />
              </section>
            ))
          )}
        </div>

        <div className="space-y-4">
          <TradeDeskPanel />

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

// Row types derived straight from the Prisma delegates.
type PortfolioRow = Awaited<ReturnType<typeof prisma.portfolio.findMany>>[number];
type TradeRow = Awaited<ReturnType<typeof prisma.trade.findMany>>[number];
type SignalRow = Awaited<ReturnType<typeof prisma.signal.findMany>>[number];

interface SwingData {
  p: PortfolioRow; trades: TradeRow[]; vetoed: SignalRow[];
  openCount: number; closed: TradeRow[]; wins: number; winRate: number; realizedPnl: number;
}

function SwingBlock({ b }: { b: SwingData }) {
  const { trades, vetoed, openCount, closed, wins, winRate, realizedPnl } = b;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Open Positions" value={openCount} />
        <Stat label="Realized P/L" value={fmtMoney(realizedPnl)} subColor={colorForChange(realizedPnl)} sub={`${closed.length} closed`} />
        <Stat label="Win Rate" value={`${fmtNumber(winRate, 0)}%`} sub={`${wins}/${closed.length}`} />
        <Stat label="Vetoed by SAGE" value={vetoed.length} sub="risk blocks" />
      </div>

      {trades.length === 0 && vetoed.length === 0 ? (
        <Empty title="No activity yet" hint="Run a trade tick from the Trade Desk panel or seed demo data." />
      ) : (
        <div className="space-y-3">
          {closed.length >= 2 && (
            <Card className="p-4">
              <div className="text-[11px] uppercase tracking-wide text-(--color-muted) mb-1">Cumulative P/L</div>
              <EquityCurveChart trades={closed} />
            </Card>
          )}
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
                    {/* The votes and SAGE line below look identical whether an analyst
                        wrote them or the deterministic stand-in did. Say which. */}
                    {t.aiBackend === "mock" && (
                      <Badge tone="neutral" title="No AI ran — HAWK votes and the SAGE verdict below are the deterministic stand-in, not analyst opinions.">
                        MOCK AI
                      </Badge>
                    )}
                  </div>
                  <div className="text-right">
                    {t.pnl != null && <div className={`font-semibold tabular-nums ${colorForChange(t.pnl)}`}>{fmtMoney(t.pnl)}</div>}
                    <div className="text-[11px] text-(--color-muted) font-mono">{fmtAgo(t.openedAt)}</div>
                  </div>
                </div>
                <details className="mt-2">
                  <summary className="text-[11px] text-(--color-muted) cursor-pointer hover:text-(--color-foreground)">trade detail</summary>
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono text-(--color-muted)">
                    <span>entry {fmtNumber(t.entry, 4)}</span>
                    <span className="text-rose-400/80">SL {fmtNumber(t.sl, 4)}</span>
                    <span className="text-emerald-400/80">TP1 {fmtNumber(t.tp1, 4)}</span>
                    <span>R:R {t.riskReward ?? "—"}</span>
                  </div>
                  {t.grossPnl != null && t.pnl != null && Math.abs(t.grossPnl - t.pnl) > 0.005 && (
                    <div className="mt-1 text-[11px] text-(--color-muted) font-mono">gross {fmtMoney(t.grossPnl)}</div>
                  )}
                  {votes.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {votes.map((v, i) => (
                        <span key={i} className="text-[11px] rounded bg-(--color-card-2) border border-(--color-border) px-2 py-0.5">
                          <span className="text-(--color-accent-2)">{v.persona}</span> · {v.vote}
                        </span>
                      ))}
                    </div>
                  )}
                  {t.sageVerdict && <p className="mt-2 text-xs text-amber-300/80">🛡️ SAGE: {t.sageVerdict}</p>}
                  {log.length > 0 && (
                    <ol className="mt-2 space-y-0.5 text-[11px] font-mono text-(--color-muted)">
                      {log.map((s, i) => (
                        <li key={i}><span className="text-(--color-accent)">{s.stage}</span> → {s.note}</li>
                      ))}
                    </ol>
                  )}
                </details>
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
              <details className="mt-2">
                <summary className="text-[11px] text-rose-300/70 cursor-pointer hover:text-rose-300">why</summary>
                <p className="mt-1 text-xs text-rose-300/80">{s.note}</p>
              </details>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function safeParse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
