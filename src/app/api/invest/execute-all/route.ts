import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isInvestKind } from "@/lib/portfolioGuards";
import { executeAction, type ExecuteAction } from "@/lib/invest/execute";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { portfolioId?: number; actions?: ExecuteAction[] };
  const portfolioId = Number(body.portfolioId);
  if (!Number.isInteger(portfolioId)) return NextResponse.json({ error: "portfolioId is required" }, { status: 400 });

  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return NextResponse.json({ error: "portfolio not found" }, { status: 404 });
  if (!isInvestKind(portfolio.kind)) return NextResponse.json({ error: "not an invest portfolio" }, { status: 409 });

  const actions = Array.isArray(body.actions) ? body.actions : [];
  const results: { note: string; ok: boolean }[] = [];
  for (const action of actions) {
    try { results.push(await executeAction(portfolioId, action)); }
    catch (e) { results.push({ ok: false, note: String(e) }); }
  }
  return NextResponse.json({ results });
}
