// Automated driver for the AI research loop, shared by the cron API route
// (src/app/api/cron/research/route.ts) and the local CLI wrapper
// (scripts/research-round.mts) — same split as runScan.ts / scan.mts for the
// live trading engine.
//
// Scope: this only automates *proposing and in-sample-vetting* new
// candidates (runResearch()'s existing propose -> backtest -> autoReview
// flow, cost-capped at COST_CIRCUIT_BREAKER_USD per candidate). It does NOT
// auto-approve or auto-port anything into strategies.ts — a candidate still
// has to clear scripts/approve-strategy.ts's blind test (see blindTest.ts)
// and get manually ported, same human-in-the-loop gate as before. This just
// removes the "someone has to remember to kick off a round" step.
//
// Cadence changed daily -> WEEKLY on 2026-08-25 (docs/PROPOSAL-panel-validation.md §7).
// Not for cost — a panel round measures at 8-10 minutes, so daily would be
// affordable. For multiple testing. Every round proposes three candidates and
// each gets a pass/fail against a pre-registered bar, so the rate at which this
// loop draws from the hypothesis space is the rate at which it manufactures
// false positives. 3/day is ~1,100 tests a year; 3/week is ~156. With the pool
// already holding 84 rows and exactly one live result to show for them, the
// binding constraint on this project is not how many ideas get tried, it is how
// many survive contact with data they have never seen. Slowing the draw is the
// cheapest way to raise the share of survivors that are real.
import { runResearch } from "./runResearch";
import { prisma } from "@/lib/db";
import type { BacktestSummary } from "@/lib/backtest/engine";
import type { PanelBlindTestReport, PanelFoldReport } from "./blindTest";

/** What the blindTest column can hold: a full report, the error branch, or "{}" for a row that never reached the gate. */
type StoredVerdict = Partial<PanelBlindTestReport> & { error?: string };

interface RotationEntry {
  label: string;
  brief: string;
  /** The three angles proposeCandidates should spread its candidates across. */
  angles?: string[];
}

// Re-aimed 2026-08-31, after run #112 and the direction recorded in
// docs/STATE.md §4.0b: stop researching entry *mechanisms*, research trade
// geometry and risk instead.
//
// **Read this before adding an "exit rule" or "position sizing" entry here.**
// The proposer cannot express either one. A candidate's code returns
// `{ side, note } | null` per bar and adapter.ts:134 consumes exactly `?.side`
// — nothing else it returns reaches the backtest. Exits come from sweepLadder
// over the six fixed LADDER_OPTIONS, and the backtest lot is a fixed 0.1
// (engine.ts:414). So a brief asking for a trailing-stop variant produces a
// candidate that cannot implement one, and the round measures whatever entry
// rule the model wrote instead. Widening the exit search means widening
// LADDER_OPTIONS (no AI involved); researching sizing means making the engine
// size to risk first. Both are outside this file.
//
// **Read this before adding an angle that waits for anything.** Measured
// 2026-09-03 (docs/quant/2026-09-03-entry-lateness.md): the baseline entry loses
// to a matched random entry in 30 of 30 ladder x fold cells, and replaying the
// SAME signals two or three bars earlier flips that margin positive in 5/5 folds
// and both exit geometries. So the rule commits late, and every further test
// placed in front of it commits later still — which is what the 13 rejected
// confluence filters were, and what the previous "wait for a confirmation close"
// angle here would have been. The eight gate relaxations run the same day are
// the other half of the lesson: loosening a threshold does NOT recover the gain,
// because it admits a wider population of trades rather than moving the same
// trades earlier, and the matched control rises with it. An angle earns its place
// here only if it fires on or before the baseline's trigger bar on setups the
// baseline would also have taken.
//
// What IS expressible is *which bar you take the trade on*, and that is not a
// cosmetic difference: entry price relative to a 1.5-ATR stop sets the R of
// every trade that follows. Same trigger, entered three ways, is a genuine
// risk-geometry experiment inside the existing contract.
//
// Deliberately NOT in the rotation: regime filters and confluence vetoes. That
// is the family swept IS/OOS on 2026-08-23 — all 13 rejected, three
// pre-registered picks all flipped sign out of sample
// (docs/quant/2026-08-23-confluence-filter-sweep-results.md). Re-proposing them
// through the AI loop would spend a round re-deriving a closed result.
//
// Deliberately says nothing about the take-profit: sweepLadder picks each
// candidate's ladder from LADDER_OPTIONS on avgR and writes it to exitLadder, so
// naming a target here only biases the design toward a geometry the candidate
// may not end up with.
const PANEL_TERMS =
  "risk 1% per trade, exit geometry swept separately, edge that holds across the whole cross-section (many names contributing, not one) and across both halves of the sample";

// The baseline every entry below varies. It is weak on purpose to state: ~+0.04R
// per trade at t=1.08 out-of-sample on weekly bars, which is the number any
// result here has to beat, not a rule presented as working.
const BASELINE = "the trend-pullback baseline (price above SMA50, pullback toward SMA20, resumption on the trigger bar)";

export const RESEARCH_ROTATION: RotationEntry[] = [
  {
    label: "stocks-entry-anticipation",
    brief:
      `Entry anticipation for US equities swing trading: open the SAME setup as ${BASELINE} EARLIER than the baseline does. ` +
      `A candidate must fire on a bar at or before the baseline's trigger bar, never after it, and must not add a further test that has to pass first. ` +
      `${PANEL_TERMS}.`,
    angles: [
      "fire while the trend structure is already in place but the momentum reading has not yet reached the level the baseline stands aside for, so the position is open before the move is certified",
      "fire on the bar that ends the pullback — the first close that reclaims the previous bar's range inside an established uptrend — rather than after a momentum indicator agrees",
      "fire where the pullback's depth and duration already match what usually precedes a resumption, taking the position while price is still moving against the trend rather than after it turns",
    ],
  },
  {
    label: "stocks-trade-geometry",
    brief: `Trade geometry for US equities swing trading: take ${BASELINE} only where the distance from entry to a 1.5-ATR stop is favourable relative to the room the move plausibly has. ${PANEL_TERMS}.`,
    angles: [
      "open only where a 1.5-ATR stop would sit beyond the pullback's low, so the stop is protected by the setup's own structure and not by distance alone",
      "open only when price is far from the recent swing high it would have to reach for the trade to work, i.e. there is room ahead",
      "open only where the distance to the stop is small relative to the distance to the level the trade has to reach, since the ladder is swept separately and the entry bar is the only lever on that ratio",
    ],
  },
];
const MS_PER_WEEK = 7 * 86_400_000;

/**
 * Deterministic week-of-cycle pick, so a weekly cron works through the whole
 * rotation before repeating (a full cycle is one week per entry).
 *
 * Keyed on weeks rather than days because the cron fires weekly; keying on days
 * would advance the rotation seven steps between runs, landing on a cycle that
 * still covers everything but for no reason anyone reading it could predict.
 */
export function pickRotationEntry(weeksSinceEpoch: number = Math.floor(Date.now() / MS_PER_WEEK)): RotationEntry {
  const n = RESEARCH_ROTATION.length;
  return RESEARCH_ROTATION[((weeksSinceEpoch % n) + n) % n];
}

export interface ScheduledResearchOverride {
  brief?: string;
}

/**
 * What a round asks for: the brief, the log label, and the diversity axis.
 *
 * The axis is dropped on a manual override on purpose. `angles` are three reads
 * of *this rotation entry's* brief; carrying them onto someone else's brief
 * would send QUANT off to explore three angles of a question nobody asked,
 * which is worse than giving it no axis at all.
 */
export function roundInputs(
  override: ScheduledResearchOverride | undefined,
  pick: RotationEntry,
): { brief: string; label: string; angles?: string[] } {
  if (override?.brief) return { brief: override.brief, label: "manual-override", angles: undefined };
  return { brief: pick.brief, label: pick.label, angles: pick.angles };
}

/** Runs one research round (rotation pick, or an explicit brief override) and returns log lines. */
export async function runScheduledResearchRound(override?: ScheduledResearchOverride): Promise<string[]> {
  const { brief, label, angles } = roundInputs(override, pickRotationEntry());

  const lines: string[] = [`research round [${label}] S&P 500 panel, FIT fold`];

  const { runId, skipped } = await runResearch(brief, undefined, angles);
  const run = await prisma.researchRun.findUnique({ where: { id: runId } });
  lines.push(`run #${runId} status: ${run?.status}`);
  // The cron log is where this is noticed. A skipped round is silent otherwise:
  // status "skipped" plus zero strategy lines looks the same as a bad round.
  if (skipped === "no-ai-backend") {
    lines.push(`SKIPPED: no AI backend configured in this environment — QUANT proposed nothing rather than banking mock candidates. Set ANTHROPIC_API_KEY (or make the Claude Code CLI reachable) wherever this cron runs.`);
    return lines;
  }

  const strategies = await prisma.researchStrategy.findMany({ where: { runId }, orderBy: { id: "asc" } });
  for (const s of strategies) {
    lines.push(strategyResultLine(s));
    for (const l of blindTestLines(s.blindTest)) lines.push(l);
  }
  return lines;
}

/** The columns strategyResultLine reads; a subset of the ResearchStrategy row. */
export interface StrategyLogRow {
  id: number;
  label: string;
  status: string;
  safetyFlag: boolean;
  backtestSummary: string;
  iterations: string;
}

/**
 * One log line per candidate, leading with the fold that decided its status.
 *
 * `runResearch.ts:311` passes `selectRun.summary` to autoReviewStatus, but the
 * row stores `backtestSummary = swept.summary` — FIT, the window the candidate
 * was *tuned* on. This line used to print only that, so the headline numbers
 * were never the deciding numbers. Run #112 is the worked example: research-216
 * read `fit=[trades=3 win%=100.0]` and was rejected for trading 0 times in 2019;
 * research-218 read `pf=0.23` but died on `avgR −0.407`. Recovering the real
 * verdict meant hand-querying `iterations` in Neon, so in practice nobody did.
 *
 * SELECT is not on the return value in any consumable form, so it is read back
 * out of `iterations` — the one place runResearch persists it (line 301).
 * FIT stays on the line, after SELECT and labelled, because a candidate that
 * looks strong on FIT and collapses on SELECT is the overfit signature worth
 * seeing; it just must not be read first.
 */
export function strategyResultLine(s: StrategyLogRow): string {
  const head = `research-${s.id} [${s.status}]${s.safetyFlag ? " SAFETY-FLAGGED" : ""} "${s.label}"`;
  const sel = selectIteration(s.iterations);
  const bt = safeParse<BacktestSummary>(s.backtestSummary);
  const fit = bt ? ` fit=[trades=${bt.trades} win%=${fx(bt.winRate, 1)} pnl=$${fx(bt.totalPnl, 0)} pf=${fx(bt.profitFactor, 2)}]` : "";
  // Said out loud rather than left blank. Legacy single-symbol rows never ran a
  // select fold at all, and silently dropping the segment makes them read like
  // a panel row that passed one.
  if (!sel) return `${head} (no select fold recorded)${fit}`;
  const b = sel.summary;
  return (
    `${head} select=[trades=${b.trades}${sel.participation ? ` symbols=${sel.participation}` : ""}` +
    ` win%=${fx(b.winRate, 1)} avgR=${fx(b.avgR, 3)} pf=${fx(b.profitFactor, 2)}]${fit}`
  );
}

/** The SELECT-fold entry runResearch appends last, plus the symbol count that lives only in its note. */
function selectIteration(json: string): { summary: BacktestSummary; participation: string | null } | null {
  const its = safeParse<Iteration[]>(json);
  if (!Array.isArray(its)) return null;
  const hit = its.find((i) => typeof i?.note === "string" && i.note.startsWith("select fold") && i.backtestSummary);
  if (!hit?.backtestSummary) return null;
  return { summary: hit.backtestSummary, participation: /(\d+\/\d+) symbols traded/.exec(hit.note)?.[1] ?? null };
}

interface Iteration { note: string; backtestSummary?: BacktestSummary }

/** The blindTest / backtestSummary columns are free-text JSON; never let a malformed one abort a round's log. */
function safeParse<T>(json: string): T | null {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" ? (v as T) : null;
  } catch {
    return null;
  }
}

const fx = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—");

/**
 * The held-out result, in the log, next to the status it produced.
 *
 * Without this the weekly log line for a survivor and for a candidate that lost
 * on every fold differ by one word, and both quote FIT numbers. The log file is
 * where a round is actually noticed — a verdict that only exists as JSON in a
 * database column is a verdict nobody reads.
 */
function blindTestLines(json: string): string[] {
  const v = safeParse<StoredVerdict>(json);
  if (!v) return [];
  // Fails closed on purpose (see applyBlindTestVerdict): a candidate whose gate
  // could not be run is rejected, but it is re-runnable and a real failure is
  // not. The log has to keep those apart or a Neon hiccup looks like a verdict.
  if (typeof v.error === "string") return [`    blind test DID NOT COMPLETE — ${v.error}`];
  const folds = v.folds ?? [];
  if (!folds.length) return [];
  const out = folds.map((f: PanelFoldReport) => {
    const ctrl = f.control ? `ctrl-p95 ${fx(f.control.p95, 2)}` : "ctrl UNVERIFIED";
    const boot = f.bootstrap ? `boot-p5 ${fx(f.bootstrap.p5, 2)}` : "boot UNVERIFIED";
    const why = f.passed ? "" : ` — ${f.reasons[0] ?? "no reason recorded"}`;
    return (
      `    ${f.passed ? "PASS" : "FAIL"} ${f.fold} ${f.from}..${f.to} ` +
      `trades=${f.summary.trades} symbols=${f.symbolsTraded}/${f.symbolsInFold} ` +
      `avgR=${fx(f.summary.avgR, 2)} ${ctrl} ${boot}${why}`
    );
  });
  if (v.passed) out.push(`    SURVIVOR — cleared all ${folds.length} TEST folds and is now desk-eligible`);
  return out;
}
