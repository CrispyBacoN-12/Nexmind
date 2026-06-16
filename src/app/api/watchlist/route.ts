import { prisma } from "@/lib/db";
import { getWatchlist, normSymbol } from "@/lib/trading/watchlist";

export const dynamic = "force-dynamic";

// GET ?portfolioId=N
export async function GET(req: Request) {
  const portfolioId = Number(new URL(req.url).searchParams.get("portfolioId"));
  if (!Number.isInteger(portfolioId)) return Response.json({ error: "portfolioId is required" }, { status: 400 });
  return Response.json(await getWatchlist(portfolioId));
}

// Add a symbol. POST { portfolioId, symbol, label? }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const portfolioId = Number(body.portfolioId);
  const symbol = normSymbol(typeof body.symbol === "string" ? body.symbol : "");
  if (!Number.isInteger(portfolioId)) return Response.json({ error: "portfolioId is required" }, { status: 400 });
  if (!symbol) return Response.json({ error: "symbol is required" }, { status: 400 });

  const max = await prisma.watchlist.aggregate({ where: { portfolioId }, _max: { sort: true } });
  const item = await prisma.watchlist.upsert({
    where: { portfolioId_symbol: { portfolioId, symbol } },
    update: { enabled: true, label: body.label ?? undefined },
    create: { portfolioId, symbol, label: typeof body.label === "string" ? body.label : null, sort: (max._max.sort ?? 0) + 1 },
  });
  return Response.json(item);
}

// Remove a symbol by row id. DELETE ?id=N
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await prisma.watchlist.delete({ where: { id: Number(id) } });
  return Response.json({ ok: true });
}
