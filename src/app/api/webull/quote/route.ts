import { fetchWebullCandles } from "@/lib/webull";

export const dynamic = "force-dynamic";

interface Quote { symbol: string; price: number; prevClose: number; changePct: number }

async function quoteOne(symbol: string): Promise<Quote | null> {
  try {
    const resp = await fetchWebullCandles(symbol, "5d", "1d");
    const bars = resp.candles;
    const last = bars.at(-1);
    if (!last) return null;
    const prevClose = bars.length > 1 ? bars[bars.length - 2].c : last.o;
    return { symbol, price: last.c, prevClose, changePct: prevClose ? ((last.c - prevClose) / prevClose) * 100 : 0 };
  } catch {
    return null;
  }
}

// GET ?symbols=AAPL,MSFT,NVDA — quick last-price + %change per symbol, for a
// watchlist strip. Symbols that fail to resolve are omitted, not errored.
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("symbols") ?? "";
  const symbols = raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 20);
  if (symbols.length === 0) return Response.json({ error: "symbols is required" }, { status: 400 });

  const quotes = (await Promise.all(symbols.map(quoteOne))).filter((q): q is Quote => q != null);
  return Response.json(quotes);
}
