// Scorecard Job 1 for Task Scheduler: once each trading day at ~10:30 ET this runs the
// /scan agent and then the chart agent on its top names by itself, so every setup the AI
// keeps or vetoes is logged (ChartSetup.source = "scheduled") and scored later.
// Spec: docs/superpowers/specs/2026-11-03-scorecard-agent-design.md section 8.
//
// Read-only toward the market: it never places or sizes an order. The only writes are
// the ChartSetup log rows and one ScorecardRun row. The task fires more than once an
// hour; runScorecardDaily returns without doing anything outside 10:30-11:30 ET, on a
// weekend, or once the day already has a ran / no_session row.
//
//   node --env-file=.env --import tsx scripts/scorecard-run.mts
import { randomUUID } from "node:crypto";
import { fetchAlpacaCandlesBatch } from "@/lib/alpaca";
import { reviewSetups } from "@/lib/chartAgent/review";
import { runChartAgent } from "@/lib/chartAgent/runChartAgent";
import { prisma } from "@/lib/db";
import type { Candle } from "@/lib/indicators";
import { fetchRecentNews } from "@/lib/market/news";
import { fetchRecentFilings } from "@/lib/market/secFilings";
import { sendDiscordNotification } from "@/lib/notify/discord";
import { fetchEconEvents } from "@/lib/scanAgent/econ";
import { runScanAgent } from "@/lib/scanAgent/runScanAgent";
import { fetchTradingViewRows } from "@/lib/scanAgent/tradingview";
import { runScorecardDaily } from "@/lib/scorecard/runDaily";
import { SCORECARD_SOURCE } from "@/lib/scorecard/types";
import type { Interval, Range } from "@/lib/yahoo";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

async function candlesFor(tickers: string[], range: Range, interval: Interval): Promise<Map<string, Candle[]>> {
  const batch = await fetchAlpacaCandlesBatch(tickers, range, interval);
  return new Map([...batch].map(([symbol, res]) => [symbol, res.candles]));
}

async function main() {
  try {
    const result = await runScorecardDaily({
      now: () => Date.now(),
      alreadyRan: async (sessionDate) =>
        (await prisma.scorecardRun.count({ where: { sessionDate, status: { in: ["ran", "no_session"] } } })) > 0,
      // The same deps as POST /api/scan, except the AI notes: the scheduled run needs
      // only the ranking, so it skips them (and their CLI spend).
      scan: () =>
        runScanAgent({
          fetchTradingViewRows,
          fetchRecentFilings,
          fetchRecentNews,
          fetchEconEvents,
          annotateRows: async () => ({
            notes: new Map(),
            status: { name: "AI", ok: true, note: "ข้ามโน้ต AI (รอบอัตโนมัติ)" },
          }),
        }),
      // The same deps as POST /api/chart-agent, with this run's id, rows tagged as
      // scheduled, and no abort signal (nobody is waiting on a page).
      chart: (tickers, runId) =>
        runChartAgent(tickers, {
          now: () => Date.now(),
          fetchIntraday: (t) => candlesFor(t, "5d", "5m"),
          fetchDaily: (t) => candlesFor(t, "1mo", "1d"),
          review: reviewSetups,
          log: async (rows) => {
            await prisma.chartSetup.createMany({ data: rows.map((row) => ({ ...row, source: SCORECARD_SOURCE })) });
          },
          runId: () => runId,
        }),
      record: async (run) => {
        await prisma.scorecardRun.create({ data: run });
      },
      newRunId: () => randomUUID(),
    });
    log(`scorecard-run: ${result.action} session ${result.sessionDate}${result.note ? ` (${result.note})` : ""}`);
    if (result.action === "failed") {
      await sendDiscordNotification(`scorecard: รอบอัตโนมัติ ${result.sessionDate} ล้มเหลว: ${result.note ?? "ไม่ทราบสาเหตุ"}`, "warning");
      process.exitCode = 1;
    }
  } catch (e) {
    log(`scorecard-run ERROR ${String(e)}`);
    await sendDiscordNotification(`scorecard: scripts/scorecard-run.mts พัง: ${String(e)}`, "warning");
    process.exitCode = 1;
  }
}

main().finally(() => prisma.$disconnect());
