import { prisma } from "@/lib/db";
import { Card, CardTitle, Stat, PageHeader, Empty, Badge } from "@/components/ui";
import { fmtMoney, fmtNumber, colorForChange, fmtAgo } from "@/lib/utils";
import { computeStats, type ClosedTrade } from "@/lib/trading/stats";
import { getStartingBalance } from "@/lib/settings";

export const dynamic = "force-dynamic";

function safeParse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

const PERIODS: { label: string; days: number }[] = [
  { label: "Today", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
];

export default async function ReportsPage() {
  const [closed, recent, lessons, startingBalance] = await Promise.all([
    prisma.trade.findMany({ where: { status: "closed" }, orderBy: { closedAt: "desc" } }),
    prisma.trade.findMany({ where: { status: "closed" }, orderBy: { closedAt: "desc" }, take: 30 }),
    prisma.lesson.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
    getStartingBalance(),
  ]);

  const asClosed: ClosedTrade[] = closed.map((t) => ({ pnl: t.pnl ?? 0, rMultiple: t.rMultiple, outcome: t.outcome, closedAt: t.closedAt }));

  return (
    <div>
      <PageHeader title="Reports" description="Win rate, expectancy, and drawdown across periods — the demo metrics that gate going live." />

      {PERIODS.map((p) => {
        const since = new Date(); since.setDate(since.getDate() - p.days); if (p.days === 1) since.setHours(0, 0, 0, 0);
        const window = asClosed.filter((t) => (t.closedAt?.getTime() ?? 0) >= since.getTime());
        const s = computeStats(window, startingBalance);
        return (
          <div key={p.label} className="mb-6">
            <CardTitle>{p.label}</CardTitle>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <Stat label="Trades" value={s.trades} />
              <Stat label="Win Rate" value={`${fmtNumber(s.winRate, 0)}%`} sub={`${s.wins}/${s.trades}`} />
              <Stat label="Net P/L" value={fmtMoney(s.pnl)} subColor={colorForChange(s.pnl)} />
              <Stat label="Expectancy" value={fmtMoney(s.expectancy)} sub="per trade" subColor={colorForChange(s.expectancy)} />
              <Stat
                label="Max Drawdown"
                value={fmtMoney(s.maxDrawdown)}
                sub={s.maxDrawdownPct != null ? `${fmtNumber(s.maxDrawdownPct, 1)}%` : undefined}
                subColor="text-rose-400"
              />
              <Stat
                label="Sharpe Ratio"
                value={s.sharpeRatio != null ? fmtNumber(s.sharpeRatio, 2) : "—"}
                sub="annualized"
                subColor={s.sharpeRatio != null ? colorForChange(s.sharpeRatio) : undefined}
              />
              <Stat
                label="Sortino Ratio"
                value={s.sortinoRatio != null ? fmtNumber(s.sortinoRatio, 2) : "—"}
                sub="annualized"
                subColor={s.sortinoRatio != null ? colorForChange(s.sortinoRatio) : undefined}
              />
            </div>
          </div>
        );
      })}

      <div className="mb-6">
        <CardTitle>📜 Closed trades (latest 30)</CardTitle>
        {recent.length === 0 ? (
          <Empty title="No closed trades yet" hint="When a position hits its TP or SL it lands here — open positions live on the War Room." />
        ) : (
          <Card className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-(--color-muted) border-b border-(--color-border)">
                  <th className="px-3 py-2 font-medium">Symbol</th>
                  <th className="px-3 py-2 font-medium">Side</th>
                  <th className="px-3 py-2 font-medium text-right">Entry</th>
                  <th className="px-3 py-2 font-medium text-right">SL</th>
                  <th className="px-3 py-2 font-medium text-right">TP1</th>
                  <th className="px-3 py-2 font-medium text-right">Lot</th>
                  <th className="px-3 py-2 font-medium text-right">P/L</th>
                  <th className="px-3 py-2 font-medium text-right">R</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium text-right">When</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => {
                  const ladder = safeParse<{ tp1Hit?: boolean }>(t.stagedTp, {});
                  const tone = t.outcome === "win" ? "positive" : t.outcome === "loss" ? "negative" : "neutral";
                  const label = `${t.outcome ?? "closed"}${ladder.tp1Hit ? " · TP1✓" : ""}`;
                  return (
                    <tr key={t.id} className="border-b border-(--color-border) last:border-0">
                      <td className="px-3 py-2 font-mono font-medium">{t.symbol}</td>
                      <td className={`px-3 py-2 uppercase ${t.side === "long" ? "text-emerald-400" : "text-rose-400"}`}>{t.side}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtNumber(t.entry, 2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-(--color-muted)">{fmtNumber(t.sl, 2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-(--color-muted)">{fmtNumber(t.tp1, 2)}</td>
                      <td className="px-3 py-2 text-right font-mono">{t.lot}</td>
                      <td className={`px-3 py-2 text-right font-mono ${colorForChange(t.pnl ?? 0)}`}>{t.pnl != null ? fmtMoney(t.pnl) : "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">{t.rMultiple != null ? fmtNumber(t.rMultiple, 2) : "—"}</td>
                      <td className="px-3 py-2"><Badge tone={tone}>{label}</Badge></td>
                      <td className="px-3 py-2 text-right text-(--color-muted) font-mono">{t.closedAt ? fmtAgo(t.closedAt) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      <div className="mt-2">
        <CardTitle>🧠 Lessons learned (from losing trades)</CardTitle>
        {lessons.length === 0 ? (
          <Empty title="No lessons yet" hint="After a losing paper trade, MEMO distills a lesson that future HAWK prompts will see." />
        ) : (
          <div className="space-y-2">
            {lessons.map((l) => (
              <Card key={l.id} className="p-4">
                <div className="flex items-center justify-between">
                  <Badge tone="warning">lesson</Badge>
                  <span className="text-[11px] text-(--color-muted) font-mono">{fmtAgo(l.createdAt)}</span>
                </div>
                <p className="mt-2 text-sm">{l.text}</p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
