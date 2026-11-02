// Groups, summaries and the frozen AI verdict sample for the scorecard (spec §6).
// Pure: no I/O, no clock (the caller says whether a window has elapsed).

import type { ControlDistribution } from "@/lib/research/control";
import { SCORECARD_VERDICT_N, type Outcome } from "./types";

export type Group = "kept" | "vetoed" | "stripped" | "unread";

/**
 * Which arm a logged setup belongs to. A shown or capped setup with no AI reading means
 * the AI never saw it, so it is `unread`, not `kept`: counting it as kept would credit
 * the AI with setups it did not approve.
 */
export function groupOf(row: { status: string; aiReading: string | null }): Group {
  if (row.status === "ai_rejected") return "vetoed";
  if (row.status === "guard_stripped") return "stripped";
  return row.aiReading === null ? "unread" : "kept";
}

export interface GroupStats {
  n: number;
  meanR: number | null;
  winPct: number | null;
  t1Pct: number | null;
}

/** Reads closed outcomes only; open, not_filled and no_data do not count. */
export function summarize(outcomes: Outcome[]): GroupStats {
  const closed = outcomes.filter((o) => o.status === "closed" && o.r !== null);
  const n = closed.length;
  if (n === 0) return { n: 0, meanR: null, winPct: null, t1Pct: null };
  return {
    n,
    meanR: closed.reduce((s, o) => s + (o.r as number), 0) / n,
    winPct: closed.filter((o) => (o.r as number) > 0).length / n,
    t1Pct: closed.filter((o) => o.exitReason === "t1").length / n,
  };
}

/**
 * The frozen sample the AI verdict is read on: the earliest SCORECARD_VERDICT_N kept
 * setups that filled. `ready` only when it is full, every one is closed, and every
 * one's 10-session window has passed (so no control trade can still be open).
 *
 * Order-independent: rows are sorted by (createdAt, id) ascending, so the sample is the
 * same whatever order the caller passes them in. The id tiebreak matters because one
 * createMany per run gives every setup of that run the same createdAt.
 */
export function aiVerdictSample<T extends { id: number; createdAt: Date; group: Group; hold: Outcome; windowElapsed: boolean }>(
  rows: T[],
): { sample: T[]; ready: boolean } {
  const sample = rows
    .filter((r) => r.group === "kept" && r.hold.status !== "not_filled" && r.hold.status !== "no_data")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)
    .slice(0, SCORECARD_VERDICT_N);
  const ready =
    sample.length === SCORECARD_VERDICT_N &&
    sample.every((r) => r.hold.status === "closed" && r.windowElapsed);
  return { sample, ready };
}

/** Strictly above the control's 95th percentile. */
export function beatsControl(meanR: number, control: ControlDistribution): boolean {
  return meanR > control.p95;
}
