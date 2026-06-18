import { prisma } from "@/lib/db";
import { PageHeader, Badge, StatusDot } from "@/components/ui";

export const dynamic = "force-dynamic";

interface Node {
  codename: string;
  role: string;
  team: string;
  emoji: string;
  status: string;
  modelTier: string;
  children: Node[];
}

const teamColor: Record<string, string> = {
  HQ: "text-amber-300",
  Trading: "text-rose-300",
  Dev: "text-cyan-300",
  Design: "text-fuchsia-300",
  Intelligence: "text-emerald-300",
  Content: "text-lime-300",
  Finance: "text-yellow-300",
  Systems: "text-violet-300",
};

export default async function GraphPage() {
  const rows = await prisma.agent.findMany({ orderBy: { sort: "asc" } });

  const byParent = new Map<string | null, Node[]>();
  const nodes = new Map<string, Node>();
  for (const r of rows) {
    nodes.set(r.codename, { codename: r.codename, role: r.role, team: r.team, emoji: r.emoji, status: r.status, modelTier: r.modelTier, children: [] });
  }
  for (const r of rows) {
    const node = nodes.get(r.codename)!;
    const key = r.reportsTo && nodes.has(r.reportsTo) ? r.reportsTo : null;
    const arr = byParent.get(key) ?? [];
    arr.push(node);
    byParent.set(key, arr);
  }
  for (const node of nodes.values()) node.children = byParent.get(node.codename) ?? [];
  const roots = byParent.get(null) ?? [];

  return (
    <div>
      <PageHeader title="Team Graph" description="Org tree — the Secretary (ARIA) routes the CEO's orders down to each team lead and their specialists." />
      <div className="overflow-x-auto">
        <ul className="space-y-2">
          {roots.map((r) => <TreeNode key={r.codename} node={r} depth={0} />)}
        </ul>
      </div>
    </div>
  );
}

function TreeNode({ node, depth }: { node: Node; depth: number }) {
  return (
    <li>
      <div
        className="inline-flex items-center gap-2 rounded-md border border-(--color-border) bg-(--color-card) px-3 py-2"
        style={{ marginLeft: depth * 24 }}
      >
        <span className="text-lg">{node.emoji}</span>
        <span className="font-semibold text-sm">{node.codename}</span>
        <span className={`text-xs font-mono ${teamColor[node.team] ?? "text-(--color-muted)"}`}>{node.role}</span>
        <Badge tone="neutral">{node.modelTier}</Badge>
        <StatusDot status={node.status} />
      </div>
      {node.children.length > 0 && (
        <ul className="mt-2 space-y-2 border-l border-(--color-border)/60" style={{ marginLeft: depth * 24 + 11 }}>
          {node.children.map((c) => <TreeNode key={c.codename} node={c} depth={0} />)}
        </ul>
      )}
    </li>
  );
}
