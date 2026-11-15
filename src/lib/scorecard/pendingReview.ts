// Local review of pending captured rows: the cloud run logged each setup with the exact
// input the AI would have seen; this reads those inputs later, one AI call per run, and
// writes the decisions onto the rows. All I/O is injected. No transaction: each save is
// its own write. The RUN is the unit: loadPending returns every row of any run that still has
// a pending row (including rows an earlier partial attempt already finalized), and the whole
// run is re-reviewed and rewritten from its frozen inputs. That repairs a partial save and is
// safe because pending rows block the verdict until the run is complete.

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
  const failed: string[] = [];
  let aiNote: string | null = null;

  for (const [runId, rows] of byRun) {
    try {
      const valid: { id: number; input: ReviewInput }[] = [];
      let runInvalid = 0;
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
        runInvalid++;
        invalid++;
      }
      if (valid.length === 0) {
        await deps.saveRunCounts(runId, {
          kept: 0, vetoed: 0, stripped: 0, unread: runInvalid, aiBackend: INVALID_INPUT_BACKEND, aiModel: null,
        });
        continue;
      }
      valid.sort((a, b) => a.input.order - b.input.order || a.id - b.id);

      const result = await deps.review(valid.map((v) => v.input.item));
      if (result.backend === "mock" || result.note !== null) {
        skipped++;
        aiNote = result.note ?? aiNote;
        continue;
      }

      const decided = decideSetups(valid.map((v) => v.input.item.setup), result.reviews);
      // An unreadable row stays in the run as unread, so the counts add up to the rows.
      const counts: RunCounts = { kept: 0, vetoed: 0, stripped: 0, unread: runInvalid, aiBackend: result.backend, aiModel: result.model };
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
    } catch {
      // One run's failed save must not stop the others; the run stays pending and retries whole.
      skipped++;
      failed.push(runId);
    }
  }
  const note = failed.length ? `run save failed: ${failed.join(", ")}` : aiNote;
  return { runs: byRun.size, reviewed, skipped, invalid, note };
}
