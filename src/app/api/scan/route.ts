// POST /api/scan — the pre-market / open scan, run only when the owner presses
// the button on /scan. No GET, no cron: nothing here runs on a schedule.
//
// Read-only: it screens the S&P 500 on TradingView, then reads 8-K filings,
// headlines and the economic calendar, and has the AI write a one-line note per
// row. It never sizes, enters or ranks by odds (see scanAgent/types.ts).

import { annotateRows } from "@/lib/scanAgent/annotate";
import { fetchEconEvents } from "@/lib/scanAgent/econ";
import { runScanAgent } from "@/lib/scanAgent/runScanAgent";
import { fetchTradingViewRows } from "@/lib/scanAgent/tradingview";
import { fetchRecentNews } from "@/lib/market/news";
import { fetchRecentFilings } from "@/lib/market/secFilings";

export const dynamic = "force-dynamic";

/**
 * One TradingView call, up to 30 headline fetches (5 at a time), an EDGAR pass
 * and three sequential AI batches through the CLI (10-40s each, behind a
 * 3-way gate). Longer than callAgentCli's own 240s hard timeout, the same
 * reasoning as /api/advisor/critique: if the platform killed the request first
 * the owner would get a raw 504 the page cannot explain.
 */
export const maxDuration = 300;

export async function POST() {
  try {
    const result = await runScanAgent({
      fetchTradingViewRows,
      fetchRecentFilings,
      fetchRecentNews,
      fetchEconEvents,
      annotateRows,
    });
    return Response.json(result, { status: result.ok ? 200 : 502 });
  } catch (e) {
    // runScanAgent degrades every source itself; this is a last-resort guard so
    // the page always gets JSON it can show instead of a bare 500.
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
