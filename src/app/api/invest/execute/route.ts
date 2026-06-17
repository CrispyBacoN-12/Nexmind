import { NextResponse } from "next/server";
import { executeAction, type ExecuteAction } from "@/lib/invest/execute";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { portfolioId?: number; action?: ExecuteAction };
  const portfolioId = Number(body.portfolioId);
  if (!Number.isInteger(portfolioId)) return NextResponse.json({ error: "portfolioId is required" }, { status: 400 });
  if (!body.action || typeof body.action.symbol !== "string") return NextResponse.json({ error: "action is required" }, { status: 400 });
  try {
    const result = await executeAction(portfolioId, body.action);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 409 });
  }
}
