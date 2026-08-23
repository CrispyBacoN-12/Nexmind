import { fetchCandles } from "@/lib/marketData";
import { ALLOWED_RANGES, ALLOWED_INTERVALS, type Range, type Interval } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

// GET ?symbol=AAPL&range=3mo&interval=1d — candles for the price chart.
//
// Goes through the shared provider router (Webull → Alpaca → Yahoo) rather than
// calling Webull directly. It used to be Webull-only, to surface Webull's own
// data in the UI; that made the chart the one screen in the app with a single
// point of failure, and it went blank for good the day the Webull sandbox host
// stopped routing. The response carries `provider` so the UI can say which
// upstream actually answered.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol")?.trim().toUpperCase();
  const range = searchParams.get("range") ?? "3mo";
  const interval = searchParams.get("interval") ?? "1d";
  if (!symbol) return Response.json({ error: "symbol is required" }, { status: 400 });
  if (!ALLOWED_RANGES.includes(range as Range)) return Response.json({ error: `invalid range: ${range}` }, { status: 400 });
  if (!ALLOWED_INTERVALS.includes(interval as Interval)) return Response.json({ error: `invalid interval: ${interval}` }, { status: 400 });

  try {
    const data = await fetchCandles(symbol, range as Range, interval as Interval);
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
