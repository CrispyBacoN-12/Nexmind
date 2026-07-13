import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { exportStrategyNote } from "@/lib/obsidian/export";

export const dynamic = "force-dynamic";

// Human review of one ResearchStrategy candidate: approve or reject.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const strategyId = Number(id);
  if (!Number.isInteger(strategyId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { status?: string };
  if (body.status !== "approved" && body.status !== "rejected") {
    return NextResponse.json({ error: "status must be 'approved' or 'rejected'" }, { status: 400 });
  }

  const existing = await prisma.researchStrategy.findUnique({ where: { id: strategyId }, include: { run: true } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.safetyFlag && body.status === "approved") {
    return NextResponse.json({ error: "cannot approve a strategy that ever failed the safety scan" }, { status: 400 });
  }

  const updated = await prisma.researchStrategy.update({ where: { id: strategyId }, data: { status: body.status } });
  try {
    exportStrategyNote(updated, existing.run);
  } catch (e) {
    console.error(`obsidian export failed for strategy ${updated.id}:`, e);
  }
  return NextResponse.json(updated);
}
