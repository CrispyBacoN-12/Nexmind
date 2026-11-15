// Scorecard cloud capture, for a GitHub Actions runner at ~10:30 ET: it runs the /scan
// agent and the chart agent's code with NO AI, and logs each setup as pending
// (ChartSetup.aiBackend = "pending", source = "scheduled") together with the exact input
// the AI would have read (ChartSetup.reviewInput). The owner's PC reviews them later.
// Spec: docs/superpowers/specs/2026-11-16-scorecard-cloud-capture-design.md section 5.
//
// The repo is public and so are the Actions logs: nothing here logs or sends an error's
// text. A failure is reported as one short Thai category plus the session date. (The
// ScorecardRun.error column may keep the raw note: the database is not public.)
//
// Read-only toward the market. Writes: ChartSetup rows and one ScorecardRun row.
//
//   node --env-file=.env --import tsx scripts/scorecard-capture.mts [--dry-run]
//
// --dry-run skips the window check and runs only the scan: no DB writes, no Discord.
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
import { makeRecorder, sanitizeConsole } from "@/lib/scorecard/capture";
import { etDayBoundsMs } from "@/lib/scorecard/etDay";
import { etClock } from "@/lib/scanAgent/session";
import { runScorecardDaily } from "@/lib/scorecard/runDaily";
import { SCORECARD_SOURCE } from "@/lib/scorecard/types";
import { CHART_TOP_N } from "@/lib/chartAgent/types";
import type { Interval, Range } from "@/lib/yahoo";

// The repo's Actions logs are public: library console.warn/error calls carry raw error text.
sanitizeConsole();

const CAT_SCAN = "สแกนไม่สำเร็จ";
const CAT_CHART = "ดึงกราฟไม่สำเร็จ";
const CAT_DB = "บันทึกลงฐานข้อมูลไม่ได้";
const CAT_UNKNOWN = "ไม่ทราบสาเหตุ";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

async function candlesFor(tickers: string[], range: Range, interval: Interval): Promise<Map<string, Candle[]>> {
  const batch = await fetchAlpacaCandlesBatch(tickers, range, interval);
  return new Map([...batch].map(([symbol, res]) => [symbol, res.candles]));
}

// The same deps as POST /api/scan, except the AI notes (the capture needs only the ranking).
const scanOnce = (nowMs: number) =>
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
  );

async function dryRun() {
  try {
    const scan = await scanOnce(Date.now());
    if (!scan.ok) {
      console.log(`scorecard-capture dry-run: scan failed (${CAT_SCAN})`);
      process.exitCode = 1;
      return;
    }
    const top = scan.rows.slice(0, CHART_TOP_N).map((r) => r.ticker);
    console.log(`scorecard-capture dry-run: scan ok, ${scan.rows.length} rows, top ${top.length}: ${top.join(",")}`);
  } catch {
    console.log(`scorecard-capture dry-run: scan failed (${CAT_SCAN})`);
    process.exitCode = 1;
  }
}

async function capture() {
  const recorder = makeRecorder();
  // Which stage failed, so the public message names a category without any error text.
  let scanBad = false;
  let chartBad = false;
  let chartLogBad = false;
  let recordBad = false;
  try {
    const result = await runScorecardDaily({
      now: () => Date.now(),
      alreadyRan: async (sessionDate) => {
        if ((await prisma.scorecardRun.count({ where: { sessionDate, status: { in: ["ran", "no_session"] } } })) > 0) return true;
        // A run can log its setups and then fail to write its run row. Re-running would log
        // the same session twice under a new runId, so those rows count as done.
        const { startMs, endMs } = etDayBoundsMs(sessionDate);
        const orphaned = await prisma.chartSetup.count({
          where: { source: SCORECARD_SOURCE, createdAt: { gte: new Date(startMs), lt: new Date(endMs) } },
        });
        if (orphaned > 0) log(`scorecard-capture: ${sessionDate} already has ${orphaned} scheduled ChartSetup rows but no run row; not re-running, no run row written`);
        return orphaned > 0;
      },
      scan: async (nowMs) => {
        try {
          const scan = await scanOnce(nowMs);
          if (!scan.ok) scanBad = true;
          return scan;
        } catch (e) {
          scanBad = true;
          throw e;
        }
      },
      chart: async (tickers, runId) => {
        try {
          const r = await runChartAgent(tickers, {
            now: () => Date.now(),
            fetchIntraday: (t) => candlesFor(t, "5d", "5m"),
            fetchDaily: (t) => candlesFor(t, "1mo", "1d"),
            review: recorder.review,
            log: async (rows) => {
              try {
                await prisma.chartSetup.createMany({
                  data: rows.map((row) => ({
                    ...row,
                    source: SCORECARD_SOURCE,
                    reviewInput: recorder.inputs().get(row.ticker) as unknown as Prisma.InputJsonValue,
                  })),
                });
              } catch (e) {
                chartLogBad = true;
                throw e;
              }
            },
            runId: () => runId,
          });
          if (!r.ok) chartBad = true;
          return r;
        } catch (e) {
          chartBad = true;
          throw e;
        }
      },
      record: async (run) => {
        try {
          await prisma.scorecardRun.create({ data: run });
        } catch (e) {
          recordBad = true;
          throw e;
        }
      },
      newRunId: () => randomUUID(),
    });
    // Never print result.note: it can carry a raw error message.
    log(`scorecard-capture: ${result.action} session ${result.sessionDate}`);
    if (result.action === "failed") {
      const category = scanBad ? CAT_SCAN : chartBad ? CAT_CHART : chartLogBad || recordBad ? CAT_DB : CAT_UNKNOWN;
      log(`scorecard-capture: failed (${category}) session ${result.sessionDate}`);
      await sendDiscordNotification(`scorecard: รอบเก็บข้อมูล ${result.sessionDate} ล้มเหลว: ${category}`, "warning");
      process.exitCode = 1;
    }
  } catch {
    const sessionDate = etClock(Math.floor(Date.now() / 1000)).date;
    log(`scorecard-capture: failed (${CAT_UNKNOWN}) session ${sessionDate}`);
    await sendDiscordNotification(`scorecard: scripts/scorecard-capture.mts พัง: ${CAT_UNKNOWN} (${sessionDate})`, "warning");
    process.exitCode = 1;
  }
}

(process.argv.includes("--dry-run") ? dryRun() : capture()).finally(() => prisma.$disconnect().catch(() => {}));
