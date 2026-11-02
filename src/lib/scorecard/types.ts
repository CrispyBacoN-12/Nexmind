// Shared constants and shapes for the scorecard (agent #4): it scores the chart
// agent's logged long-sweep setups as if each had been bought. Spec:
// docs/superpowers/specs/2026-11-03-scorecard-agent-design.md.
//
// Pure types and constants. No I/O, no clock.

import type { CostModel } from "@/lib/backtest/engine";

/** Only `ChartSetup` rows with this source are scored; button rows are ignored. */
export const SCORECARD_SOURCE = "scheduled";

/** The scheduled run reads the chart at 10:30 ET (minutes since 00:00 ET). */
export const SCORECARD_RUN_ET_MINUTES = 630;
/** The run may fire up to this many minutes after SCORECARD_RUN_ET_MINUTES. */
export const SCORECARD_RUN_WINDOW_MINUTES = 60;
/** A `hold` position is closed on time at the close of this session. */
export const SCORECARD_MAX_HOLD_SESSIONS = 10;
/** Setups the AI kept before the verdict is read. */
export const SCORECARD_VERDICT_N = 300;
/** Below this many scored setups no summary is printed as a result. */
export const SCORECARD_MIN_N = 30;
/** The random control enters no later than 15:30 ET (minutes since 00:00 ET). */
export const SCORECARD_CONTROL_LAST_ENTRY_ET_MINUTES = 930;
/** A setup with no bars at all this many days after its run is `no_data`. */
export const SCORECARD_NO_DATA_DAYS = 15;

/**
 * 5 bps slippage on every fill and 1 bp round-turn commission on entry notional.
 *
 * This is a copy of `RESEARCH_COST_MODEL`, not an import: runResearch.ts imports
 * prisma at module scope, which would make this pure module throw without
 * DATABASE_URL and pull the database into anything that imports it.
 * `costModel.test.ts` fails if the two ever differ.
 */
export const SCORECARD_COST_MODEL: CostModel = { slippageBps: 5, commissionBps: 1 };

/** `hold`: up to 10 sessions. `sameDay`: out at the entry day's close. */
export type ExitVariant = "hold" | "sameDay";

export type OutcomeStatus = "open" | "closed" | "not_filled" | "no_data";

export type ExitReason = "stop" | "t1" | "time";

/** All times are epoch seconds. `fill` is the raw bar open, before slippage. */
export interface Outcome {
  status: OutcomeStatus;
  fillAt: number | null;
  fill: number | null;
  exitAt: number | null;
  exitPrice: number | null;
  exitReason: ExitReason | null;
  r: number | null;
  sessionsHeld: number;
}
