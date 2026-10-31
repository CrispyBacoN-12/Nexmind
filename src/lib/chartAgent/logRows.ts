// Maps the chart agent's decided setups to ChartSetup rows. Every setup the
// agent finds is logged, shown or not, so a later spec can grade "T1 before
// stop" against a random-entry control. Pure: the route does the DB write.

import type { Review } from "@/lib/chartAgent/review";
import type { Levels, Setup } from "@/lib/chartAgent/types";

export type LogStatus = "shown" | "ai_rejected" | "guard_stripped" | "capped";

/** The ChartSetup model's create input minus id and createdAt. */
export interface ChartSetupRow {
  runId: string;
  ticker: string;
  status: LogStatus;
  dataAsOf: string;
  entry: number;
  stop: number;
  t1: number;
  t2: number | null;
  r1: number;
  r2: number | null;
  sweptLevels: string[];
  sweepBarAt: string;
  levels: Levels;
  aiReading: string | null;
  aiRejectReason: string | null;
  aiBackend: string;
}

export function toLogRows(
  runId: string,
  decided: { setup: Setup; review: Review; status: LogStatus }[],
  backend: string,
): ChartSetupRow[] {
  return decided.map(({ setup, review, status }) => ({
    runId,
    ticker: setup.ticker,
    status,
    dataAsOf: setup.dataAsOf,
    entry: setup.entry,
    stop: setup.stop,
    t1: setup.t1.price,
    t2: setup.t2?.price ?? null,
    r1: setup.t1.r,
    r2: setup.t2?.r ?? null,
    sweptLevels: [...setup.sweptLevels],
    sweepBarAt: new Date(setup.sweepBar.t * 1000).toISOString(),
    levels: setup.levels,
    aiReading: review.reading,
    // Only a rejection stores its reason; a stripped reading's text is not kept.
    aiRejectReason: status === "ai_rejected" ? review.reason : null,
    aiBackend: backend,
  }));
}
