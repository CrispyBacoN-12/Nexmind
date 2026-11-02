// Job 1 of the scorecard (spec §8): once each trading day, shortly after 10:30 ET,
// run the scan and then the chart agent on its top names, so every setup the AI
// keeps, vetoes or never reads is logged (source "scheduled") and scored later.
//
// Pure orchestration: every I/O dependency is injected, so the flow is tested with
// stubs. scripts/scorecard-run.mts wires the real ones. Read-only toward the
// market: it never places or sizes an order.

import type { Prisma } from "@/generated/prisma/client";
import { CHART_TOP_N } from "@/lib/chartAgent/types";
import type { ChartAgentResult } from "@/lib/chartAgent/runChartAgent";
import { etClock, marketPhase } from "@/lib/scanAgent/session";
import type { ScanResult } from "@/lib/scanAgent/types";
import { groupOf, type Group } from "./groups";
import { SCORECARD_RUN_ET_MINUTES, SCORECARD_RUN_WINDOW_MINUTES } from "./types";

/** A `ScorecardRun` row to create: the table's columns minus `id` and `ranAt`. */
export type ScorecardRunInput = Omit<Prisma.ScorecardRunUncheckedCreateInput, "id" | "ranAt">;

export interface DailyDeps {
  now(): number;
  /** True when a `ran` or `no_session` row already exists for that ET session date. */
  alreadyRan(sessionDate: string): Promise<boolean>;
  scan(nowMs: number): Promise<ScanResult>;
  chart(tickers: string[], runId: string): Promise<ChartAgentResult>;
  record(run: ScorecardRunInput): Promise<void>;
  newRunId(): string;
}

export type DailyAction = "outside_window" | "already_ran" | "ran" | "no_session" | "failed";

export interface DailyResult {
  action: DailyAction;
  sessionDate: string;
  note: string | null;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Counts per `groupOf` over everything the chart agent logged. The result lists the
 * shown and rejected/stripped setups one by one but only counts the capped ones, so a
 * capped setup is judged by the backend outcome: when no model answered (`model` is
 * null: the AI was down or its answer unusable) every review was unread, else the
 * capped setups were kept. A capped setup the AI skipped on its own would read as kept
 * here; the result does not say.
 */
function countGroups(r: Extract<ChartAgentResult, { ok: true }>): Record<Group, number> & { setups: number } {
  const counts = { kept: 0, vetoed: 0, stripped: 0, unread: 0 };
  for (const s of r.shown) counts[groupOf({ status: "shown", aiReading: s.review.reading })]++;
  for (const x of r.rejected) {
    counts[groupOf({ status: x.review.status === "rejected" ? "ai_rejected" : "guard_stripped", aiReading: x.review.reading })]++;
  }
  const cappedReading = r.model === null ? null : "kept";
  for (let i = 0; i < r.cappedCount; i++) counts[groupOf({ status: "capped", aiReading: cappedReading })]++;
  return { ...counts, setups: r.shown.length + r.rejected.length + r.cappedCount };
}

export async function runScorecardDaily(deps: DailyDeps): Promise<DailyResult> {
  const nowMs = deps.now();
  const { date: sessionDate, minutes } = etClock(Math.floor(nowMs / 1000));

  // Window: a weekday (marketPhase is "open" only on one) from 10:30 to 11:30 ET.
  const inWindow =
    marketPhase(nowMs) === "open" &&
    minutes >= SCORECARD_RUN_ET_MINUTES &&
    minutes < SCORECARD_RUN_ET_MINUTES + SCORECARD_RUN_WINDOW_MINUTES;
  if (!inWindow) return { action: "outside_window", sessionDate, note: null };

  if (await deps.alreadyRan(sessionDate)) return { action: "already_ran", sessionDate, note: null };

  const fail = async (error: string, runId: string | null): Promise<DailyResult> => {
    try {
      await deps.record({ sessionDate, runId, status: "failed", error });
    } catch (e) {
      return { action: "failed", sessionDate, note: `${error} (บันทึกไม่ได้: ${message(e)})` };
    }
    return { action: "failed", sessionDate, note: error };
  };

  let scan: ScanResult;
  try {
    scan = await deps.scan(nowMs);
  } catch (e) {
    return fail(message(e), null);
  }
  if (!scan.ok) return fail(scan.error, null);

  const runId = deps.newRunId();
  let chart: ChartAgentResult;
  try {
    chart = await deps.chart(
      scan.rows.slice(0, CHART_TOP_N).map((row) => row.ticker),
      runId,
    );
  } catch (e) {
    return fail(message(e), runId);
  }
  if (!chart.ok) return fail(chart.error, runId);

  // runChartAgent swallows a failed setup log into logNote and still answers ok. A day whose
  // rows were not written must not count as done, or alreadyRan would block the retry.
  if (chart.logNote !== null) return fail(chart.logNote, runId);

  // No regular bars today: a holiday. Nothing was logged and nothing is owed a retry.
  const action: DailyAction = chart.dataAsOf === null ? "no_session" : "ran";
  const run: ScorecardRunInput =
    action === "no_session"
      ? { sessionDate, runId, status: "no_session", setups: 0, aiBackend: chart.backend, aiModel: chart.model }
      : { sessionDate, runId, status: "ran", ...countGroups(chart), aiBackend: chart.backend, aiModel: chart.model };
  try {
    await deps.record(run);
  } catch (e) {
    return { action: "failed", sessionDate, note: `บันทึกผลรอบไม่ได้: ${message(e)}` };
  }
  return { action, sessionDate, note: chart.logNote };
}
