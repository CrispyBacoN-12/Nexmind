import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isOptionsKind } from "@/lib/portfolioGuards";
import { runOptions } from "@/lib/options/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const portfolioId = Number(body.portfolioId);
  if (!Number.isInteger(portfolioId)) return NextResponse.json({ error: "portfolioId is required" }, { status: 400 });
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return NextResponse.json({ error: "portfolio not found" }, { status: 404 });
  if (!isOptionsKind(portfolio.kind)) return NextResponse.json({ error: "not an options portfolio" }, { status: 409 });
  try {
    return NextResponse.json(await runOptions(portfolioId));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
