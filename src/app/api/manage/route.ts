import { manageOpenTrades } from "@/lib/trading/manage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const portfolioId = Number(body.portfolioId);
  if (!Number.isInteger(portfolioId)) return Response.json({ error: "portfolioId is required" }, { status: 400 });
  const summary = await manageOpenTrades(portfolioId);
  return Response.json(summary);
}
