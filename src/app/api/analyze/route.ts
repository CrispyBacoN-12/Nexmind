import { analyzeSymbol } from "@/lib/trading/analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// AI analysis of a symbol (no trade). POST { symbol }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
  if (!symbol) return Response.json({ error: "symbol is required (e.g. NVDA, PTT.BK, GC=F)" }, { status: 400 });

  try {
    return Response.json(await analyzeSymbol(symbol));
  } catch (e) {
    const msg = String(e);
    if (/no data|upstream|Not Found|404/i.test(msg)) {
      return Response.json(
        { error: `Symbol "${symbol}" not found on Yahoo. For Thai (SET) stocks add .BK — e.g. JMART.BK, PTT.BK.` },
        { status: 404 },
      );
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
