// Scorecard Job 1 for Task Scheduler, now the LOCAL FALLBACK capture: the GitHub Actions
// workflow (scripts/scorecard-capture.mts) is the primary capture. Once each trading day at
// ~10:30 ET this runs the /scan agent and then the chart agent's code on its top names with
// NO AI, exactly like the cloud capture: every setup is logged as pending
// (ChartSetup.aiBackend = "pending", source = "scheduled") with the exact input the AI would
// have read (ChartSetup.reviewInput). The AI reads them only later, in the review step of
// scripts/scorecard-score.mts, so a night the AI is down is reviewed once it is back.
// Spec: docs/superpowers/specs/2026-11-16-scorecard-cloud-capture-design.md (amends
// 2026-11-03-scorecard-agent-design.md section 8).
//
// Read-only toward the market: it never places or sizes an order. The only writes are
// the ChartSetup log rows, one ScorecardRun row and the session claim (Setting
// scorecard:claim:<date>). The task fires several times a day; runScorecardDaily returns
// without doing anything outside 10:30-11:30 ET, on a weekend, once the day already has a
// ran / no_session row, or while the cloud capture holds the session's claim.
//
//   node --env-file=.env --import tsx scripts/scorecard-run.mts
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { fetchAlpacaCandlesBatch } from "@/lib/alpaca";
import { runChartAgent } from "@/lib/chartAgent/runChartAgent";
import { prisma } from "@/lib/db";
import type { Candle } from "@/lib/indicators";
import { fetchRecentNews } from "@/lib/market/news";
import { fetchRecentFilings } from "@/lib/market/secFilings";
import { sendDiscordNotification } from "@/lib/notify/discord";
import { fetchEconEvents } from "@/lib/scanAgent/econ";
import { runScanAgent } from "@/lib/scanAgent/runScanAgent";
import { fetchTradingViewRows } from "@/lib/scanAgent/tradingview";
import { makeRecorder } from "@/lib/scorecard/capture";
import { runScorecardDaily } from "@/lib/scorecard/runDaily";
import { dbAlreadyRan } from "@/lib/scorecard/sessionGuardDb";
import { SCORECARD_SOURCE } from "@/lib/scorecard/types";
import type { Interval, Range } from "@/lib/yahoo";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

async function candlesFor(tickers: string[], range: Range, interval: Interval): Promise<Map<string, Candle[]>> {
  const batch = await fetchAlpacaCandlesBatch(tickers, range, interval);
  return new Map([...batch].map(([symbol, res]) => [symbol, res.candles]));
}

async function main() {
  // Stands in for reviewSetups: no AI call, it keeps what the AI would have read.
  const recorder = makeRecorder();
  try {
    const result = await runScorecardDaily({
      now: () => Date.now(),
      // Run row, orphan rows and the session claim shared with the cloud capture.
      alreadyRan: dbAlreadyRan("local", (m) => log(`scorecard-run: ${m}`)),
      // The same deps as POST /api/scan, except the AI notes: the scheduled run needs
      // only the ranking, so it skips them (and their CLI spend).
      scan: (nowMs) =>
        runScanAgent(
          {
            fetchTradingViewRows,
            fetchRecentFilings,
            fetchRecentNews,
            fetchEconEvents,
            annotateRows: async () => ({
              notes: new Map(),
              status: { name: "AI", ok: true, note: "ข้ามโน้ต AI (รอบอัตโนมัติ)" },
            }),
          },
          nowMs,
        ),
      // The same deps as POST /api/chart-agent, with this run's id, rows tagged as
      // scheduled and pending, and no abort signal (nobody is waiting on a page).
      chart: (tickers, runId) =>
        runChartAgent(tickers, {
          now: () => Date.now(),
          fetchIntraday: (t) => candlesFor(t, "5d", "5m"),
          fetchDaily: (t) => candlesFor(t, "1mo", "1d"),
          review: recorder.review,
          log: async (rows) => {
            await prisma.chartSetup.createMany({
              data: rows.map((row) => ({
                ...row,
                source: SCORECARD_SOURCE,
                reviewInput: recorder.inputs().get(row.ticker) as unknown as Prisma.InputJsonValue,
              })),
            });
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
