import { prisma } from "@/lib/db";
import { Card, CardTitle, Badge, PageHeader, Empty, Stat } from "@/components/ui";
import { fmtNumber, fmtMoney, colorForChange } from "@/lib/utils";
import { isSwingKind } from "@/lib/portfolioGuards";

export const dynamic = "force-dynamic";

interface DeskRow {
  id: number; name: string; strategy: string; tf: string; universe: string;
  open: number; closed: number; wins: number; winRate: number;
  avgR: number | null; totalPnl: number;
}

const rColor = (r: number | null) => (r == null ? "" : r > 0 ? "text-emerald-400" : r < 0 ? "text-rose-400" : "");

export default async function Scoreboard() {
  const portfolios = await prisma.portfolio.findMany({ where: { status: "active" }, orderBy: { sort: "asc" } });
  const swing = portfolios.filter((p) => isSwingKind(p.kind));

  const rows: DeskRow[] = await Promise.all(
    swing.map(async (p) => {
      const trades = await prisma.trade.findMany({
        where: { portfolioId: p.id },
        select: { status: true, outcome: true, pnl: true, rMultiple: true },
      });
      const closed = trades.filter((t) => t.status === "closed");
      const wins = closed.filter((t) => t.outcome === "win").length;
      const rs = closed.map((t) => t.rMultiple).filter((r): r is number => r != null);
      const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
      return {
        id: p.id, name: p.name, strategy: p.strategy, tf: `${p.scanInterval}/${p.scanRange}`, universe: p.universe,
        open: trades.filter((t) => t.status === "open").length,
        closed: closed.length,
        wins,
        winRate: closed.length ? (wins / closed.length) * 100 : 0,
        avgR,
        totalPnl: closed.reduce((s, t) => s + (t.pnl ?? 0), 0),
      };
    }),
  );

  // Rank by avgR (the asset-neutral metric); deskless ones (no closed trades) sink to the bottom.
  const ranked = [...rows].sort((a, b) => (b.avgR ?? -Infinity) - (a.avgR ?? -Infinity));
  const withTrades = ranked.filter((r) => r.closed > 0);
  const totalClosed = rows.reduce((s, r) => s + r.closed, 0);
  const totalOpen = rows.reduce((s, r) => s + r.open, 0);

  return (
    <div>
      <PageHeader
        title="Scoreboard"
        description="Per-desk track record, ranked by avg R-multiple — the asset-neutral edge measure. Compare strategies/timeframes head-to-head."
        action={<Badge tone="info">PAPER</Badge>}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Stat label="Swing desks" value={rows.length} />
        <Stat label="Open positions" value={totalOpen} />
        <Stat label="Closed trades" value={totalClosed} />
        <Stat label="Desks with edge" value={withTrades.filter((r) => (r.avgR ?? 0) > 0).length} sub="avgR > 0" />
      </div>

      {totalClosed === 0 ? (
        <Empty title="No closed trades yet" hint="Track record fills in as positions close. Avg R is the number to watch." />
      ) : (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-(--color-muted) border-b border-(--color-border)">
                <th className="text-left py-2 px-3">Desk</th>
                <th className="text-left py-2 px-3">Strategy</th>
                <th className="text-left py-2 px-3">TF</th>
                <th className="text-right py-2 px-3">Open</th>
                <th className="text-right py-2 px-3">Closed</th>
                <th className="text-right py-2 px-3">Win%</th>
                <th className="text-right py-2 px-3">Avg R</th>
                <th className="text-right py-2 px-3">P/L</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r) => (
                <tr key={r.id} className="border-b border-(--color-border)/40 hover:bg-(--color-border)/10">
                  <td className="py-2 px-3 font-medium">{r.name}{r.universe ? <span className="text-(--color-muted) text-xs"> · {r.universe}</span> : null}</td>
                  <td className="py-2 px-3 text-xs text-(--color-muted) font-mono">{r.strategy}</td>
                  <td className="py-2 px-3 text-xs text-(--color-muted) font-mono">{r.tf}</td>
                  <td className="py-2 px-3 text-right font-mono">{r.open}</td>
                  <td className="py-2 px-3 text-right font-mono">{r.closed}</td>
                  <td className="py-2 px-3 text-right font-mono">{r.closed ? `${fmtNumber(r.winRate, 0)}%` : "—"}</td>
                  <td className={`py-2 px-3 text-right font-mono font-semibold ${rColor(r.avgR)}`}>{r.avgR == null ? "—" : fmtNumber(r.avgR, 2)}</td>
                  <td className={`py-2 px-3 text-right font-mono ${colorForChange(r.totalPnl)}`}>{fmtMoney(r.totalPnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="mt-3 text-[11px] text-(--color-muted)">
        Avg R = mean R-multiple of closed trades (reward ÷ initial risk) — comparable across assets. P/L is paper USD and
        scale-distorted by price level (BTC dwarfs a $0.5 coin), so rank by Avg R, not P/L. Options desk is tracked on its own page.
      </p>
    </div>
  );
}
