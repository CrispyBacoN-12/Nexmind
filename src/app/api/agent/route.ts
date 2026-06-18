import { prisma } from "@/lib/db";
import { agentByCodename } from "@/lib/agents/registry";

export const dynamic = "force-dynamic";

type HawkVote = { persona: string; vote: string; reason: string };

// Activity detail for one agent (?codename=HAWK): recent work, votes, verdicts, lessons.
export async function GET(req: Request) {
  const codename = (new URL(req.url).searchParams.get("codename") ?? "").toUpperCase();
  const def = agentByCodename(codename);
  if (!def) return Response.json({ error: "unknown agent" }, { status: 404 });

  const [dbAgent, steps] = await Promise.all([
    prisma.agent.findUnique({ where: { codename } }),
    prisma.pipelineStep.findMany({ where: { agent: codename }, orderBy: { createdAt: "desc" }, take: 6 }),
  ]);

  const payload: Record<string, unknown> = {
    codename,
    name: def.name,
    role: def.role,
    team: def.team,
    emoji: def.emoji,
    rarity: def.rarity,
    modelTier: def.modelTier,
    title: def.title ?? null,
    motto: def.motto ?? null,
    skills: def.skills,
    status: dbAgent?.status ?? "idle",
    work: steps.map((s) => ({ task: s.task, output: s.output, status: s.status, at: s.createdAt, pipelineId: s.pipelineId })),
  };

  // Trading-desk specifics.
  if (codename === "HAWK") {
    const trades = await prisma.trade.findMany({ where: { NOT: { hawkVotes: "[]" } }, orderBy: { openedAt: "desc" }, take: 6 });
    payload.votes = trades.map((t) => ({ symbol: t.symbol, side: t.side, at: t.openedAt, votes: safeParse<HawkVote[]>(t.hawkVotes, []) }));
  }
  if (codename === "SAGE") {
    const [trades, vetoes] = await Promise.all([
      prisma.trade.findMany({ where: { NOT: { sageVerdict: null } }, orderBy: { openedAt: "desc" }, take: 6 }),
      prisma.signal.findMany({ where: { status: "vetoed" }, orderBy: { createdAt: "desc" }, take: 6 }),
    ]);
    payload.verdicts = [
      ...trades.map((t) => ({ symbol: t.symbol, at: t.openedAt, verdict: t.sageVerdict, kind: "approve" })),
      ...vetoes.map((s) => ({ symbol: s.symbol, at: s.createdAt, verdict: s.note, kind: "veto" })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 6);
  }
  if (codename === "SCANNER") {
    const signals = await prisma.signal.findMany({ orderBy: { createdAt: "desc" }, take: 8 });
    payload.signals = signals.map((s) => ({ symbol: s.symbol, side: s.side, status: s.status, at: s.createdAt, note: s.note }));
  }
  if (codename === "MEMO" || codename === "SAGE" || codename === "HAWK") {
    const lessons = await prisma.lesson.findMany({ orderBy: { createdAt: "desc" }, take: 6 });
    payload.lessons = lessons.map((l) => ({ text: l.text, at: l.createdAt }));
  }

  return Response.json(payload);
}

function safeParse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
