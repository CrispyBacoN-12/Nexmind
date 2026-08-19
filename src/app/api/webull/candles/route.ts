import { fetchWebullCandles } from "@/lib/webull";
import { ALLOWED_RANGES, ALLOWED_INTERVALS, type Range, type Interval } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

// GET ?symbol=AAPL&range=3mo&interval=1d — candles sourced from Webull only
// (no Alpaca/Yahoo fallback; this route exists specifically to surface
// Webull's own data in the UI).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol")?.trim().toUpperCase();
  const range = searchParams.get("range") ?? "3mo";
  const interval = searchParams.get("interval") ?? "1d";
  if (!symbol) return Response.json({ error: "symbol is required" }, { status: 400 });
  if (!ALLOWED_RANGES.includes(range as Range)) return Response.json({ error: `invalid range: ${range}` }, { status: 400 });
  if (!ALLOWED_INTERVALS.includes(interval as Interval)) return Response.json({ error: `invalid interval: ${interval}` }, { status: 400 });

  try {
    const data = await fetchWebullCandles(symbol, range as Range, interval as Interval);
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
