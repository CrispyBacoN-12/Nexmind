import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui";
import type { SceneAgent, CoreInfo } from "@/components/office/scene";
import { IsoOffice } from "@/components/office/iso-office";

export const dynamic = "force-dynamic";

export default async function RosterPage() {
  const [agents, trades] = await Promise.all([
    prisma.agent.findMany({ orderBy: { sort: "asc" } }),
    prisma.trade.findMany({ orderBy: { openedAt: "desc" }, take: 12 }),
  ]);

  const closed = trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => t.outcome === "win").length;
  const core: CoreInfo = {
    openTrades: trades.filter((t) => t.status === "open").length,
    realizedPnl: closed.reduce((s, t) => s + (t.pnl ?? 0), 0),
    winRate: closed.length ? (wins / closed.length) * 100 : 0,
    lastDecision: trades[0] ? `${trades[0].symbol} ${trades[0].side.toUpperCase()} · ${trades[0].status === "open" ? "OPEN" : (trades[0].outcome ?? "closed").toUpperCase()}` : null,
  };

  const online = agents.filter((a) => a.status === "online" || a.status === "working").length;
  const realms = new Set(agents.map((a) => a.team)).size;

  const sceneAgents: SceneAgent[] = agents.map((a) => ({
    codename: a.codename, role: a.role, team: a.team, status: a.status, emoji: a.emoji, modelTier: a.modelTier,
  }));

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <span className="text-(--color-ygg-leaf)">🌳</span> Agent Roster — Yggdrasil Office
          </h1>
          <p className="text-sm text-(--color-muted) mt-1">{agents.length} agents across {realms} realms of the world-tree. Click anyone to see their votes, work, and lessons.</p>
        </div>
        <Badge tone="info">{online} online</Badge>
      </div>

      <IsoOffice agents={sceneAgents} core={core} />
    </div>
  );
}
