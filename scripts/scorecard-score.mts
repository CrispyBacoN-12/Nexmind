// Scorecard Job 2 for Task Scheduler: fires when the machine wakes or the owner logs on, and
// does its work once per closed US session. It scores every scheduled ChartSetup row of the
// current ruleVersion on real Alpaca SIP 5-minute bars, overwrites the "live" ScorecardSnapshot,
// freezes the "ai-verdict" snapshot once when its 300-row sample is ready, and sends one Thai
// Discord summary. A failed run records nothing, so the next wake tries again.
// First it has the AI review the rows the capture logged as pending (the cloud capture and the
// local fallback both log them that way): this is the only place the AI reads setups. When that
// review finalized rows and no summary is due, it rescores and saves the live snapshot without
// Discord, so the page updates the same hour.
// Spec: docs/superpowers/specs/2026-11-03-scorecard-agent-design.md sections 5, 6, 8.
//
// Read-only toward the market: it never places or sizes an order. Writes: ScorecardOutcome
// upserts, the live snapshot, and at most once per ruleVersion the verdict snapshot.
//
//   node --env-file=.env --import tsx scripts/scorecard-score.mts
import type { Prisma } from "@/generated/prisma/client";
import { fetchAlpacaRange } from "@/lib/alpaca";
import { reviewSetups } from "@/lib/chartAgent/review";
import type { LogStatus } from "@/lib/chartAgent/logRows";
import { CHART_RULE_VERSION } from "@/lib/chartAgent/types";
import { prisma } from "@/lib/db";
import { sendDiscordNotification } from "@/lib/notify/discord";
import { applyPendingReviews } from "@/lib/scorecard/pendingReview";
import { nightlyCutoffSec, runScorecardNightly, type NightlyDeps, type NightlyRow } from "@/lib/scorecard/nightly";
import { latestClosedSession, scoreAction } from "@/lib/scorecard/summarySchedule";
import { PENDING_BACKEND, SCORECARD_SOURCE, type ExitReason, type ExitVariant, type Outcome, type OutcomeStatus } from "@/lib/scorecard/types";
import { getSetting, setSetting } from "@/lib/settings";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const iso = (sec: number) => new Date(sec * 1000).toISOString();
const sec = (d: Date | null) => (d === null ? null : Math.floor(d.getTime() / 1000));
const json = (x: unknown) => x as Prisma.InputJsonValue;
const VERDICT_KEY = { kind: "ai-verdict", ruleVersion: CHART_RULE_VERSION };
const LIVE_KEY = { kind: "live", ruleVersion: CHART_RULE_VERSION };
const LAST_SUMMARY_SETTING = "scorecard:lastSummarySession";
// The bar cutoff of the last summary sent, so the next one also lists what a silent refresh closed.
const LAST_SUMMARY_CUTOFF_SETTING = "scorecard:lastSummaryCutoffSec";

async function loadRows(): Promise<NightlyRow[]> {
  const setups = await prisma.chartSetup.findMany({
    where: { source: SCORECARD_SOURCE, ruleVersion: CHART_RULE_VERSION },
    select: { id: true, runId: true, createdAt: true, ticker: true, status: true, aiReading: true, aiModel: true, aiBackend: true, entry: true, stop: true, t1: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const stored = setups.length
    ? await prisma.scorecardOutcome.findMany({ where: { chartSetupId: { in: setups.map((s) => s.id) } } })
    : [];
  const byId = new Map<number, Partial<Record<ExitVariant, Outcome>>>();
  for (const o of stored) {
    const outcome: Outcome = {
      status: o.status as OutcomeStatus,
      fillAt: sec(o.fillAt),
      fill: o.fill,
      exitAt: sec(o.exitAt),
      exitPrice: o.exitPrice,
      exitReason: o.exitReason as ExitReason | null,
      r: o.r,
      sessionsHeld: o.sessionsHeld,
    };
    byId.set(o.chartSetupId, { ...byId.get(o.chartSetupId), [o.variant as ExitVariant]: outcome });
  }
  return setups.map((s) => ({ ...s, outcomes: byId.get(s.id) ?? {} }));
}

// Reads the setups the capture logged as pending and writes the AI's decisions onto them.
// Runs on every trigger, before the summary guard. No $transaction: sequential awaits.
// Returns how many rows it finalized (reviewed or marked invalid); 0 when it failed.
async function reviewPending(): Promise<number> {
  try {
    const r = await applyPendingReviews({
      now: () => Date.now(),
      // The run is the unit: every row of any run that still has a pending row, including rows
      // an earlier partial save already finalized, so the whole run is re-reviewed from its inputs.
      loadPending: async () => {
        const open = await prisma.chartSetup.findMany({
          where: { source: SCORECARD_SOURCE, ruleVersion: CHART_RULE_VERSION, aiBackend: PENDING_BACKEND },
          select: { runId: true },
          distinct: ["runId"],
        });
        if (open.length === 0) return [];
        const rows = await prisma.chartSetup.findMany({
          where: { source: SCORECARD_SOURCE, ruleVersion: CHART_RULE_VERSION, runId: { in: open.map((o) => o.runId) } },
          select: { id: true, runId: true, reviewInput: true },
          orderBy: { id: "asc" },
        });
        return rows.map((x) => ({ id: x.id, runId: x.runId, reviewInput: x.reviewInput as unknown }));
      },
      review: reviewSetups,
      saveRow: async ({ id, status, ...rest }) => {
        await prisma.chartSetup.update({ where: { id }, data: { ...(status ? { status: status as LogStatus } : {}), ...rest } });
      },
      saveRunCounts: async (runId, c) => {
        await prisma.scorecardRun.updateMany({ where: { runId }, data: c });
      },
    });
    log(`scorecard-review: runs ${r.runs}, reviewed ${r.reviewed}, skipped ${r.skipped}, invalid ${r.invalid}${r.note !== null ? ` (${r.note})` : ""}`);
    return r.reviewed + r.invalid;
  } catch (e) {
    log(`scorecard-review ERROR ${String(e)}`);
    return 0;
  }
}

// The real I/O of runScorecardNightly; `send` is Discord for the summary, a no-op for a refresh.
const nightlyDeps = (send: NightlyDeps["send"], closedSinceSec: number | null = null): NightlyDeps => ({
  now: () => Date.now(),
  loadRows,
  fetchBars: async (tickers, fromSec, toSec) => {
    const bars = await fetchAlpacaRange(tickers, iso(fromSec), iso(toSec), "5m");
    log(`scorecard-score: bars for ${bars.size}/${tickers.length} tickers ${iso(fromSec)}..${iso(toSec)}`);
    return bars;
  },
  // Info-only rules vs buy-and-hold series: a failure is logged here and the nightly stores [].
  fetchDailyBars: async (tickers, fromSec, toSec) => {
    try {
      const bars = await fetchAlpacaRange(tickers, iso(fromSec), iso(toSec), "1d");
      log(`scorecard-score: daily bars for ${bars.size}/${tickers.length} tickers ${iso(fromSec)}..${iso(toSec)}`);
      return bars;
    } catch (e) {
      log(`scorecard-score: daily bars failed: ${String(e)}`);
      throw e;
    }
  },
  saveOutcomes: async (rows) => {
    // No $transaction: it needs Neon's WebSocket, which timed out on this network while
    // plain queries go over HTTPS. Each upsert is keyed and idempotent, so a run that
    // stops halfway just rescores the rest next time.
    for (const { chartSetupId, variant, outcome: o } of rows) {
      const data = {
        status: o.status,
        fillAt: o.fillAt === null ? null : new Date(o.fillAt * 1000),
        fill: o.fill,
        exitAt: o.exitAt === null ? null : new Date(o.exitAt * 1000),
        exitPrice: o.exitPrice,
        exitReason: o.exitReason,
        r: o.r,
        sessionsHeld: o.sessionsHeld,
      };
      await prisma.scorecardOutcome.upsert({
        where: { chartSetupId_variant: { chartSetupId, variant } },
        create: { chartSetupId, variant, ...data },
        update: data,
      });
    }
    log(`scorecard-score: upserted ${rows.length} outcomes`);
  },
  loadRuns: (sinceSession) => prisma.scorecardRun.findMany({ where: { sessionDate: { gte: sinceSession } } }),
  loadVerdict: async () => (await prisma.scorecardSnapshot.findUnique({ where: { kind_ruleVersion: VERDICT_KEY } }))?.data ?? null,
  saveLive: async (data) => {
    await prisma.scorecardSnapshot.upsert({
      where: { kind_ruleVersion: LIVE_KEY },
      create: { ...LIVE_KEY, data: json(data) },
      update: { data: json(data), computedAt: new Date() },
    });
  },
  // Frozen once: refuse when one exists. The (kind, ruleVersion) unique constraint
  // makes a racing second create fail instead of overwriting.
  saveVerdict: async (data) => {
    if (await prisma.scorecardSnapshot.findUnique({ where: { kind_ruleVersion: VERDICT_KEY } })) {
      throw new Error(`an ai-verdict snapshot for ${CHART_RULE_VERSION} already exists; not overwriting`);
    }
    await prisma.scorecardSnapshot.create({ data: { ...VERDICT_KEY, data: json(data) } });
    log(`scorecard-score: AI verdict frozen: n ${data.n}, meanR ${data.meanR.toFixed(4)}, p95 ${data.controlP95.toFixed(4)}, pass ${data.pass}`);
  },
  send,
  closedSinceSec,
});

async function main() {
  try {
    const startedAt = Date.now();
    const finalized = await reviewPending();
    const lastSent = await getSetting(LAST_SUMMARY_SETTING, "");
    const action = scoreAction(startedAt, lastSent, finalized);
    if (action === "none") {
      log(`scorecard-score: summary for ${lastSent} already sent, nothing due`);
      return;
    }
    const summary = action === "summary";
    if (!summary) log(`scorecard-score: summary for ${lastSent} already sent; review finalized ${finalized} rows, refreshing the live snapshot without Discord`);
    const storedCutoff = Number(await getSetting(LAST_SUMMARY_CUTOFF_SETTING, ""));
    const closedSince = Number.isFinite(storedCutoff) && storedCutoff > 0 ? storedCutoff : null;
    const snapshot = await runScorecardNightly(
      summary ? nightlyDeps((message) => sendDiscordNotification(message, "info"), closedSince) : nightlyDeps(async () => {}),
    );
    if (summary) {
      await setSetting(LAST_SUMMARY_SETTING, latestClosedSession(startedAt));
      await setSetting(LAST_SUMMARY_CUTOFF_SETTING, String(nightlyCutoffSec(Date.parse(snapshot.computedAt))));
    }
    const p = snapshot.keptProgress;
    log(`scorecard-score: done session ${snapshot.sessionDate}; kept ${p.n}/${p.target} (${p.closed} closed); missed ${snapshot.missed.length}; last run ${snapshot.lastRun.status}`);
  } catch (e) {
    log(`scorecard-score ERROR ${String(e)}`);
    await sendDiscordNotification(`scorecard: scripts/scorecard-score.mts พัง: ${String(e)}`, "critical");
    process.exitCode = 1;
  }
}

main().finally(() => prisma.$disconnect());
