// POST /api/chart-agent — the 5-minute chart reading, run only when the owner
// presses the button on /scan. No GET, no cron: nothing here runs on a schedule.
//
// Read-only: it reads 5-minute and daily bars, finds long liquidity-sweep
// setups in code and has the AI describe them. It never places or sizes an
// order (see chartAgent/types.ts). The only write is the setup log, a plain
// ChartSetup row per setup found.

import { randomUUID } from "node:crypto";
import { fetchAlpacaCandlesBatch } from "@/lib/alpaca";
import { runChartAgent } from "@/lib/chartAgent/runChartAgent";
import { reviewSetups } from "@/lib/chartAgent/review";
import { CHART_TOP_N } from "@/lib/chartAgent/types";
import { prisma } from "@/lib/db";
import type { Candle } from "@/lib/indicators";
import type { Interval, Range } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

/**
 * Two Alpaca batch reads plus one AI call through the CLI (10-40s, behind a
 * 3-way gate). Longer than callAgentCli's own 240s hard timeout, the same
 * reasoning as /api/scan: if the platform killed the request first the owner
 * would get a raw 504 the page cannot explain.
 */
export const maxDuration = 300;

const TICKER = /^[A-Z][A-Z.\-]{0,9}$/;

const bad = (error: string) => Response.json({ ok: false, error }, { status: 400 });

async function candlesFor(tickers: string[], range: Range, interval: Interval): Promise<Map<string, Candle[]>> {
  const batch = await fetchAlpacaCandlesBatch(tickers, range, interval);
  return new Map([...batch].map(([symbol, res]) => [symbol, res.candles]));
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("body must be JSON");
  }
  const raw = (body as { tickers?: unknown } | null)?.tickers;
  if (!Array.isArray(raw)) return bad("tickers must be an array");
  if (raw.length === 0 || raw.length > CHART_TOP_N) {
    return bad(`tickers must have 1 to ${CHART_TOP_N} items`);
  }
  const tickers: string[] = [];
  for (const item of raw) {
    const t = typeof item === "string" ? item.trim().toUpperCase() : "";
    if (!TICKER.test(t)) return bad("invalid ticker in list");
    tickers.push(t);
  }

  try {
    const result = await runChartAgent(tickers, {
      now: () => Date.now(),
      fetchIntraday: (t) => candlesFor(t, "5d", "5m"),
      fetchDaily: (t) => candlesFor(t, "1mo", "1d"),
      review: reviewSetups,
      log: async (rows) => {
        await prisma.chartSetup.createMany({ data: rows });
      },
      runId: () => randomUUID(),
      // Aborts when the page supersedes this run or goes away: the run then
      // skips the AI call and the log.
      signal: request.signal,
    });
    return Response.json(result, { status: result.ok ? 200 : 502 });
  } catch (e) {
    // runChartAgent degrades the AI and the log itself; this is a last-resort
    // guard so the page always gets JSON it can show instead of a bare 500.
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
