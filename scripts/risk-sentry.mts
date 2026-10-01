// Local Risk Sentry runner for Task Scheduler — the same work as
// src/app/api/cron/risk-sentry/route.ts, without needing a dev server or Vercel.
// Read-only risk monitoring (see docs/superpowers/specs/2026-09-16-risk-sentry-design.md §0):
// it is NOT the paused autonomous desk and never opens, closes or sizes anything.
//
//   node --env-file=.env --import tsx scripts/risk-sentry.mts
import { prisma } from "@/lib/db";
import { runRiskSentry } from "@/lib/riskSentry/runRiskSentry";
import { getJournalOpenPositions, getRiskSentryHoldings, setRiskSentryHoldings } from "@/lib/riskSentry/holdings";
import { fetchCandles, fetchCandlesBatch } from "@/lib/marketData";
import { fetchNextEarnings } from "@/lib/market/earnings";
import { getSetting, setSetting } from "@/lib/settings";
import { sendDiscordNotification } from "@/lib/notify/discord";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

async function main() {
  try {
    const s = await runRiskSentry({
      getRiskSentryHoldings,
      getJournalOpenPositions,
      setRiskSentryHoldings,
      fetchCandlesBatch,
      fetchCandles,
      fetchNextEarnings,
      getSetting,
      setSetting,
    });
    if (s.skipped) {
      log("risk-sentry: no holdings (journal empty, manual list empty)");
      return;
    }
    log(`risk-sentry: stops ${s.stops.length}, earnings ${s.earnings.length}, gate ${s.gate.from}->${s.gate.to}${s.gate.flipped ? " FLIPPED" : ""}, correlated pairs ${s.correlations.length}`);
    if (s.message) {
      log(`risk-sentry alert:\n${s.message}`);
      await sendDiscordNotification(s.message, "warning");
    }
  } catch (e) {
    log(`risk-sentry ERROR ${String(e)}`);
    await sendDiscordNotification(`scripts/risk-sentry.mts failed: ${String(e)}`, "critical");
    process.exitCode = 1;
  }
}

main().finally(() => prisma.$disconnect());
