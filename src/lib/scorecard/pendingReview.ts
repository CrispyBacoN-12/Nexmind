// Local review of pending captured rows: the cloud run logged each setup with the exact
// input the AI would have seen; this reads those inputs later, one AI call per run, and
// writes the decisions onto the rows. All I/O is injected. No transaction: each save is
// its own write, so a run that stops midway leaves the rest pending and they retry.

import { decideSetups } from "@/lib/chartAgent/decide";
import type { LogStatus } from "@/lib/chartAgent/logRows";
import type { reviewSetups } from "@/lib/chartAgent/review";
import { groupOf } from "./groups";
import { parseReviewInput, type ReviewInput } from "./capture";

export const INVALID_INPUT_BACKEND = "review_input_invalid";

export interface PendingRow { id: number; runId: string; reviewInput: unknown }

export interface ReviewUpdate {
  id: number;
  /** Omitted for an unreadable row: its stored status stays as it is. */
  status?: LogStatus;
  aiReading: string | null;
  aiRejectReason: string | null;
  aiBackend: string;
  aiModel: string | null;
  reviewedAt: Date;
}

export interface RunCounts {
  kept: number;
  vetoed: number;
  stripped: number;
  unread: number;
  aiBackend: string;
  aiModel: string | null;
}

export interface PendingReviewDeps {
  now(): number;
  loadPending(): Promise<PendingRow[]>;
  review: typeof reviewSetups;
  saveRow(u: ReviewUpdate): Promise<void>;
  saveRunCounts(runId: string, c: RunCounts): Promise<void>;
}

export async function applyPendingReviews(
  deps: PendingReviewDeps,
): Promise<{ runs: number; reviewed: number; skipped: number; invalid: number; note: string | null }> {
  const pending = await deps.loadPending();
  const byRun = new Map<string, PendingRow[]>();
  for (const r of pending) byRun.set(r.runId, [...(byRun.get(r.runId) ?? []), r]);

  let reviewed = 0;
  let skipped = 0;
  let invalid = 0;
  let note: string | null = null;

  for (const [runId, rows] of byRun) {
    const valid: { id: number; input: ReviewInput }[] = [];
    for (const r of rows) {
      const input = parseReviewInput(r.reviewInput);
      if (input) {
        valid.push({ id: r.id, input });
        continue;
      }
      await deps.saveRow({
        id: r.id, aiReading: null, aiRejectReason: null,
        aiBackend: INVALID_INPUT_BACKEND, aiModel: null, reviewedAt: new Date(deps.now()),
      });
      invalid++;
    }
    if (valid.length === 0) continue;
    valid.sort((a, b) => a.input.order - b.input.order || a.id - b.id);

    const result = await deps.review(valid.map((v) => v.input.item));
    if (result.backend === "mock" || result.note !== null) {
      skipped++;
      note = result.note ?? note;
      continue;
    }

    const decided = decideSetups(valid.map((v) => v.input.item.setup), result.reviews);
    const counts: RunCounts = { kept: 0, vetoed: 0, stripped: 0, unread: 0, aiBackend: result.backend, aiModel: result.model };
    for (let i = 0; i < decided.length; i++) {
      const { review, status } = decided[i];
      await deps.saveRow({
        id: valid[i].id,
        status,
        aiReading: review.reading,
        aiRejectReason: status === "ai_rejected" ? review.reason : null,
        aiBackend: result.backend,
        aiModel: result.model,
        reviewedAt: new Date(deps.now()),
      });
      counts[groupOf({ status, aiReading: review.reading })]++;
      reviewed++;
    }
    await deps.saveRunCounts(runId, counts);
  }
  return { runs: byRun.size, reviewed, skipped, invalid, note };
}
