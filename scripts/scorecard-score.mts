// Scorecard Job 2 for Task Scheduler: each morning at 07:00 ICT (Tue-Sat), after the US
// close, score every scheduled ChartSetup row of the current ruleVersion on real Alpaca
// SIP 5-minute bars, overwrite the "live" ScorecardSnapshot, freeze the "ai-verdict"
// snapshot once when its 300-row sample is ready, and send one Thai Discord summary.
// Spec: docs/superpowers/specs/2026-11-03-scorecard-agent-design.md sections 5, 6, 8.
//
// Read-only toward the market: it never places or sizes an order. Writes: ScorecardOutcome
// upserts, the live snapshot, and at most once per ruleVersion the verdict snapshot.
//
//   node --env-file=.env --import tsx scripts/scorecard-score.mts
import type { Prisma } from "@/generated/prisma/client";
import { fetchAlpacaRange } from "@/lib/alpaca";
import { CHART_RULE_VERSION } from "@/lib/chartAgent/types";
import { prisma } from "@/lib/db";
import { sendDiscordNotification } from "@/lib/notify/discord";
import { runScorecardNightly, type NightlyRow } from "@/lib/scorecard/nightly";
import { SCORECARD_SOURCE, type ExitReason, type ExitVariant, type Outcome, type OutcomeStatus } from "@/lib/scorecard/types";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const iso = (sec: number) => new Date(sec * 1000).toISOString();
const sec = (d: Date | null) => (d === null ? null : Math.floor(d.getTime() / 1000));
const json = (x: unknown) => x as Prisma.InputJsonValue;
const VERDICT_KEY = { kind: "ai-verdict", ruleVersion: CHART_RULE_VERSION };
const LIVE_KEY = { kind: "live", ruleVersion: CHART_RULE_VERSION };

async function loadRows(): Promise<NightlyRow[]> {
  const setups = await prisma.chartSetup.findMany({
    where: { source: SCORECARD_SOURCE, ruleVersion: CHART_RULE_VERSION },
    select: { id: true, createdAt: true, ticker: true, status: true, aiReading: true, aiModel: true, entry: true, stop: true, t1: true },
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

async function main() {
  try {
    const snapshot = await runScorecardNightly({
      now: () => Date.now(),
      loadRows,
      fetchBars: async (tickers, fromSec, toSec) => {
        const bars = await fetchAlpacaRange(tickers, iso(fromSec), iso(toSec), "5m");
        log(`scorecard-score: bars for ${bars.size}/${tickers.length} tickers ${iso(fromSec)}..${iso(toSec)}`);
        return bars;
      },
      saveOutcomes: async (rows) => {
        await prisma.$transaction(
          rows.map(({ chartSetupId, variant, outcome: o }) => {
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
            return prisma.scorecardOutcome.upsert({
              where: { chartSetupId_variant: { chartSetupId, variant } },
              create: { chartSetupId, variant, ...data },
              update: data,
            });
          }),
        );
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
      send: (message) => sendDiscordNotification(message, "info"),
    });
    const p = snapshot.keptProgress;
    log(`scorecard-score: done session ${snapshot.sessionDate}; kept ${p.n}/${p.target} (${p.closed} closed); missed ${snapshot.missed.length}; last run ${snapshot.lastRun.status}`);
  } catch (e) {
    log(`scorecard-score ERROR ${String(e)}`);
    await sendDiscordNotification(`scorecard: scripts/scorecard-score.mts พัง: ${String(e)}`, "critical");
    process.exitCode = 1;
  }
}

main().finally(() => prisma.$disconnect());
