// One capture per session across machines. The cloud capture (GitHub Actions) and the local
// fallback (Task Scheduler on the owner's PC) fire in the same 10:30-11:29 ET minutes, and a
// check-then-act "already ran?" on two machines can let both log the same session. Before
// either one runs, it claims the session with a create that fails when the key exists, so only
// one of two racing runners gets it.
//
// Pure-ish: every I/O dependency is injected (sessionGuardDb.ts wires prisma).

import { etDayBoundsMs } from "./etDay";
import { SCORECARD_CLAIM_STALE_MINUTES } from "./types";

export type ClaimResult = "claimed" | "taken";

export interface ClaimDeps {
  /** Must fail when the key already exists (Setting.key is the @id, so prisma throws P2002). */
  create(key: string, value: string): Promise<void>;
  read(key: string): Promise<{ value: string } | null>;
  overwrite(key: string, value: string): Promise<void>;
  now(): number;
}

export const claimKey = (sessionDate: string) => `scorecard:claim:${sessionDate}`;

/** Epoch ms the claim was written, or null when the stored value cannot be read. */
function claimedAt(value: string): number | null {
  try {
    const at = (JSON.parse(value) as { at?: unknown }).at;
    const ms = typeof at === "string" ? Date.parse(at) : NaN;
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/**
 * Claims `sessionDate` for `owner`. "taken" when another runner claimed it less than
 * SCORECARD_CLAIM_STALE_MINUTES ago. An older claim (its runner died or failed) is taken
 * over. A create that fails while no claim exists was not a duplicate: its error propagates.
 */
export async function claimSession(deps: ClaimDeps, sessionDate: string, owner: string): Promise<ClaimResult> {
  const key = claimKey(sessionDate);
  const value = JSON.stringify({ owner, at: new Date(deps.now()).toISOString() });
  try {
    await deps.create(key, value);
    return "claimed";
  } catch (createError) {
    // The duplicate is recognised by the row being there, so this module needs no prisma error type.
    const existing = await deps.read(key);
    if (existing === null) throw createError;
    const at = claimedAt(existing.value);
    // An unreadable claim was not written by this code; it cannot hold a session.
    if (at !== null && deps.now() - at <= SCORECARD_CLAIM_STALE_MINUTES * 60_000) return "taken";
    await deps.overwrite(key, value);
    return "claimed";
  }
}

export interface SessionGuardDeps {
  /** `ScorecardRun` rows of that session with status ran or no_session. */
  countDoneRuns(sessionDate: string): Promise<number>;
  /** Scheduled `ChartSetup` rows created in [startMs, endMs). */
  countScheduledRows(startMs: number, endMs: number): Promise<number>;
  claim(sessionDate: string): Promise<ClaimResult>;
  /** One line, no error text (the cloud log is public). */
  log(message: string): void;
}

/**
 * The `alreadyRan` dep of runScorecardDaily, shared by the cloud capture and the local
 * fallback. True when the session already has a ran / no_session row, when it has scheduled
 * rows but no run row (a run logged its setups and then failed to write its run row: re-running
 * would log the session twice under a new runId), or when another runner holds its claim.
 * False only after this runner claimed the session.
 */
export function makeAlreadyRan(deps: SessionGuardDeps): (sessionDate: string) => Promise<boolean> {
  return async (sessionDate) => {
    if ((await deps.countDoneRuns(sessionDate)) > 0) return true;
    const { startMs, endMs } = etDayBoundsMs(sessionDate);
    const orphaned = await deps.countScheduledRows(startMs, endMs);
    if (orphaned > 0) {
      deps.log(`${sessionDate} already has ${orphaned} scheduled ChartSetup rows but no run row; not re-running, no run row written`);
      return true;
    }
    if ((await deps.claim(sessionDate)) === "taken") {
      deps.log(`${sessionDate} is claimed by another runner; not running, no run row written`);
      return true;
    }
    return false;
  };
}
