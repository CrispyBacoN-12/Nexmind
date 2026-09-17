// The XAUUSD window policy — its own name space, deliberately not part of the
// equity panel's.
//
// Same reasoning that keeps DeepFoldName out of FoldName, one step further: a
// gold fold is not a weaker equity fold, it is a different class of evidence.
// The equity panel's strongest result came from replicating on a universe that
// shared not one ticker; gold is ONE series, with no cross-section, no disjoint
// universe, and a broker that is simultaneously the counterparty, the data
// source and the only tape. Passing `xau-v1` is therefore WEAKER evidence than
// passing `panel-v1`, and the type system is what stops the two being quoted as
// if they were the same thing.
//
// Pre-registered in docs/quant/2026-09-08-xauusd-preregistration.md §1 and §3.
// Nothing here reads a file or the network; the fold table is data.

// XauFoldName is declared in panel.ts, beside FoldName and DeepFoldName, so
// that Fold's union can name it without panel.ts depending on this file. It is
// re-exported here because this is where a reader looks for it.
import type { Fold, XauFoldName } from "@/lib/research/panel";
import { XAU_MAX_LOOKBACK_BARS } from "@/lib/research/mechanisms";

export type { XauFoldName };

/** The H1 cache, written by scripts/cache-xau-history.mts. One symbol. */
export const XAU_PANEL_CACHE_PATH = ".cache/bars/xau-h1.json";

/** `validation` tag on any strategy measured through this gate. Never "panel-v1". */
export const XAU_VALIDATION_TAG = "xau-v1";

/**
 * Distinct calendar months containing at least one trade, required per fold.
 *
 * This is what replaces MIN_PANEL_SYMBOLS, and it is not an equivalent
 * substitute — it is the closest thing available. On the equity panel the
 * monthly block bootstrap resamples a month across every symbol at once, which
 * is how it carries the cross-sectional correlation; on one symbol it degrades
 * to a plain time-series block bootstrap and has lost that reason for existing.
 * So the month count IS the sample the bootstrap resamples, and a fold whose
 * trades occupy fewer than two years of distinct months is a rule firing in
 * bursts — a regime bet wearing a strategy's clothes.
 */
export const MIN_XAU_BLOCKS = 24;

/** Trades required per fold, per arm. Same number the equity panel asks of a candidate. */
export const MIN_XAU_TRADES = 200;

/**
 * A gold fold carries one field the equity folds do not: which way the metal
 * actually went.
 *
 * It exists to make §3's rule 3 — FIT and SELECT must be opposite-direction
 * regimes — a thing a test can check, rather than a sentence in a document that
 * a plausible-looking table can quietly violate. `regime` is prose and cannot be
 * asserted on; `direction` can. "mixed" is not an option on purpose: a fold
 * nobody can label up or down is a fold cut badly, and allowing the label would
 * let the FIT/SELECT rule be satisfied vacuously.
 */
export interface XauFold extends Fold<XauFoldName> {
  direction: "up" | "down";
}

/**
 * **[PENDING]** — unblocked by the Phase 0 re-run against the broker's own
 * server, which reports the true first H1 bar.
 *
 * Deliberately `null` rather than the plan's draft table. The draft opened
 * `xfit` in 2004, and at least one server is already known not to reach back
 * that far; committing dates now would mean either discovering they are
 * unreachable and "adjusting" them — which is choosing folds after seeing what
 * the data allows — or silently running on a shorter window than the table
 * claims. Null makes every consumer fail closed until the real depth is known.
 *
 * The RULE for cutting them is fixed and is not up for revision once the depth
 * is: five folds, disjoint and ordered, cut by gold's own regime rather than
 * into equal calendar slices, FIT oldest and the TEST folds newest, FIT and
 * SELECT in opposite directions. `xauFoldViolations` is that rule in code, and
 * the table must pass it before it is committed.
 */
export const XAU_FOLDS: Record<XauFoldName, XauFold> | null = null;

/** The five names, in the order a screen must report them. */
export const XAU_FOLD_ORDER: XauFoldName[] = ["xfit", "xselect", "xtest1", "xtest2", "xtest3"];

/**
 * Bars of warm-up prepended to each gold fold.
 *
 * Larger than PANEL_WARMUP_BARS because the hypotheses are not the same rules:
 * `xau-daily-trend` reads a 480-bar mean, so a 250-bar warm-up would leave it
 * cold at the start of every fold and warm later — the boundary artifact the
 * warm-up exists to prevent, surfacing as one fold disagreeing with the others.
 * 480 + 250 keeps the same margin past the longest lookback that the equity
 * panel keeps past its own.
 */
export const XAU_WARMUP_BARS = XAU_MAX_LOOKBACK_BARS + 250;

const epoch = (isoDate: string): number => Date.parse(`${isoDate}T00:00:00Z`);

/**
 * Every way a candidate fold table breaks the pre-registered rule, as readable
 * strings. Empty means it is admissible.
 *
 * A validator rather than a set of assertions inside a test file, because the
 * table does not exist yet: this is what will be run against it the day it is
 * written, and the test below can only exercise it on fixtures until then. It
 * returns all violations rather than throwing on the first, so a badly cut
 * table is fixed in one pass instead of five.
 */
export function xauFoldViolations(folds: Record<XauFoldName, XauFold>): string[] {
  const problems: string[] = [];
  const list = XAU_FOLD_ORDER.map((n) => folds[n]);

  for (const [i, f] of list.entries()) {
    if (!f) {
      problems.push(`fold ${XAU_FOLD_ORDER[i]} is missing`);
      continue;
    }
    if (f.name !== XAU_FOLD_ORDER[i]) {
      problems.push(`fold at position ${i} is keyed ${XAU_FOLD_ORDER[i]} but names itself ${f.name}`);
    }
    if (!Number.isFinite(epoch(f.from)) || !Number.isFinite(epoch(f.to))) {
      problems.push(`fold ${f.name} has an unparseable date (${f.from} → ${f.to})`);
    } else if (epoch(f.to) <= epoch(f.from)) {
      problems.push(`fold ${f.name} ends at or before it starts (${f.from} → ${f.to})`);
    }
    if (!f.regime?.trim()) {
      problems.push(`fold ${f.name} has no regime description — it is quoted in every verdict`);
    }
  }
  if (problems.length > 0) return problems; // the checks below would read garbage

  // Disjoint and ordered, in the declared order. Same walk panel.test.ts does
  // over FOLDS: each fold starts at or after the previous one ends.
  for (let i = 1; i < list.length; i++) {
    if (epoch(list[i].from) < epoch(list[i - 1].to)) {
      problems.push(
        `fold ${list[i].name} (${list[i].from}) overlaps ${list[i - 1].name}, which runs to ${list[i - 1].to}`,
      );
    }
  }

  // FIT oldest, TEST newest — the property that makes a TEST fold untouched.
  const fitEnd = epoch(folds.xfit.to);
  const selectEnd = epoch(folds.xselect.to);
  for (const name of ["xtest1", "xtest2", "xtest3"] as const) {
    if (epoch(folds[name].from) < Math.max(fitEnd, selectEnd)) {
      problems.push(`${name} starts before the fitting folds end — it is not held out`);
    }
  }

  // Rule 3. The project's most expensive lesson, applied in advance: a cut
  // point fitted on one direction does not transfer, and a rule allowed to fit
  // and select inside the same direction would never reveal it.
  if (folds.xfit.direction === folds.xselect.direction) {
    problems.push(
      `xfit and xselect are both ${folds.xfit.direction} — the pre-registration requires opposite-direction regimes`,
    );
  }

  return problems;
}

/**
 * The fold table, or a throw naming exactly what unblocks it.
 *
 * Fails closed, like every research gate here and unlike the market gate: a
 * screen that ran on invented dates would produce numbers indistinguishable
 * from real ones, and the whole reason for pre-registering is that such numbers
 * cannot be un-read afterwards.
 */
export function xauFolds(): Record<XauFoldName, XauFold> {
  if (!XAU_FOLDS) {
    throw new Error(
      "XAU_FOLDS is [PENDING]: the fold table is unblocked by the Phase 0 depth probe against the broker's own server " +
        "(scripts/probe-xau-data.mts), then must pass xauFoldViolations() and be committed BEFORE any strategy number " +
        "is computed — see docs/quant/2026-09-08-xauusd-preregistration.md §3",
    );
  }
  return XAU_FOLDS;
}

/** The five folds in report order. Throws while the table is [PENDING]. */
export function xauFoldList(): XauFold[] {
  const f = xauFolds();
  return XAU_FOLD_ORDER.map((n) => f[n]);
}

/** The three held-out folds. Throws while the table is [PENDING]. */
export function xauTestFolds(): XauFold[] {
  const f = xauFolds();
  return [f.xtest1, f.xtest2, f.xtest3];
}

// --- costs -----------------------------------------------------------------

/**
 * Three cost levels, all from the same measured point-spread distribution.
 *
 * `DEFAULT_COST_MODEL` is deliberately not one of them: its header says it was
 * calibrated from an MT5 gold account, nobody re-derived it, and
 * probe-fill-and-costs.log measured that moving 0.5bps → 5bps shifts fold avgR
 * by ~0.03R — the same size as every effect being hunted.
 */
export type XauCostLevel = "median" | "p90" | "stress";

/** The level the PASS bar is evaluated at. The other two are sensitivity, never the verdict. */
export const XAU_GATE_COST_LEVEL: XauCostLevel = "p90";

/**
 * **[PENDING]** — unblocked by Phase 1: `.cache/xau/spread-profile-<server>.json`
 * accumulated to ≥ 120 of 168 (dow × hour) cells by scripts/probe-xau-costs.mts.
 *
 * Null rather than a placeholder for the same reason XAU_FOLDS is: a cost model
 * guessed in bps from a 2026 measurement understates the older folds by ~3.5×,
 * because the spread is a fixed number of POINTS while the 1.5×ATR stop is a
 * roughly stable fraction of price (0.28-0.68% across 2021-2026). Charging the
 * wrong constant is not a rounding error here, it is the effect size.
 */
export const XAU_COSTS: Record<XauCostLevel, number> | null = null;

/** The measured spread in POINTS at each level, or a throw naming what unblocks it. */
export function xauCostPoints(): Record<XauCostLevel, number> {
  if (!XAU_COSTS) {
    throw new Error(
      "XAU_COSTS is [PENDING]: unblocked by scripts/probe-xau-costs.mts accumulating " +
        ".cache/xau/spread-profile-<server>.json to >= 120 of 168 (dow x hour) cells — see " +
        "docs/quant/2026-09-08-xauusd-preregistration.md §4. Do not substitute DEFAULT_COST_MODEL.",
    );
  }
  return XAU_COSTS;
}

/**
 * **[PENDING]** — `symbol_info(XAUUSD).point` on the broker's own server.
 *
 * The size of one point in price. Named rather than assumed to be 0.01 because
 * this is exactly the class of fact MetaQuotes-Demo got wrong: its `tickValue`
 * is off by 10x against the sibling-symbol cross-check, and XAUCHF/XAUGBP
 * report a contract size 1000x the others. A wrong point size does not fail —
 * it silently scales every cost by a power of ten.
 */
export const XAU_POINT_SIZE: number | null = null;

/**
 * **[PENDING]** — round-turn commission in POINTS, from the broker's contract
 * specs (a Raw/ECN account charges it; a Standard account prices it into the
 * spread and this is 0).
 *
 * Separate from the spread because they are measured differently: the spread
 * comes from a tick histogram and moves by the hour, the commission is a
 * published constant. Adding them before charging is the only place they meet.
 */
export const XAU_COMMISSION_POINTS: number | null = null;

/** Everything needed to price a fill, with no part of it guessed. */
export interface XauCostSpec {
  spreadPoints: Record<XauCostLevel, number>;
  commissionPoints: number;
  pointSize: number;
}

/**
 * The full cost specification, or a throw naming which part is still [PENDING].
 *
 * One accessor rather than three so a caller cannot satisfy two of them and
 * quietly default the third — which, for `pointSize`, would be a factor-of-100
 * error that no downstream number would look wrong because of.
 */
export function xauCostSpec(): XauCostSpec {
  const spreadPoints = xauCostPoints(); // throws first; its message is the primary one
  if (XAU_POINT_SIZE == null || XAU_COMMISSION_POINTS == null) {
    throw new Error(
      "the XAUUSD contract spec is [PENDING]: " +
        [
          XAU_POINT_SIZE == null ? "XAU_POINT_SIZE (symbol_info.point)" : null,
          XAU_COMMISSION_POINTS == null ? "XAU_COMMISSION_POINTS (round-turn commission)" : null,
        ]
          .filter(Boolean)
          .join(" and ") +
        " must be read off the broker's own server — MetaQuotes-Demo's contract fields are " +
        "demonstrably wrong and are not admissible. See docs/quant/2026-09-08-xauusd-preregistration.md §2 and §4.",
    );
  }
  return { spreadPoints, commissionPoints: XAU_COMMISSION_POINTS, pointSize: XAU_POINT_SIZE };
}

// --- the session filter ----------------------------------------------------

/** The (day-of-week, hour) key a bar falls in, both read in UTC. */
export function xauCellKey(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return `${d.getUTCDay()}:${d.getUTCHours()}`;
}

/**
 * **[PENDING]** — derived by scripts/probe-xau-costs.mts from the spread
 * profile alone, and frozen before any strategy result is read.
 *
 * The excluded cells, as `xauCellKey` strings. §4 fixes the rule now: exclude
 * any (dow, hour) cell whose p90 spread exceeds **2x the median p90 across all
 * cells holding >= 200 ticks**. A ratio, not a level, deliberately — the one
 * regime feature that survived five equity folds was the one with no absolute
 * number in it, and both features carrying a fitted cut point died.
 */
export const XAU_SESSION_FILTER: readonly string[] | null = null;

/** The excluded cells as a set, or a throw. Empty is a legitimate answer; null is not. */
export function xauSessionFilter(): ReadonlySet<string> {
  if (!XAU_SESSION_FILTER) {
    throw new Error(
      "XAU_SESSION_FILTER is [PENDING]: it is derived from the same spread profile as XAU_COSTS " +
        "(scripts/probe-xau-costs.mts), by the ratio rule fixed in " +
        "docs/quant/2026-09-08-xauusd-preregistration.md §4. An empty list is a valid answer; " +
        "running with no filter at all is not.",
    );
  }
  return new Set(XAU_SESSION_FILTER);
}

// --- the bar ---------------------------------------------------------------

/** One fold's numbers for one candidate, at one cost level. */
export interface XauFoldRow {
  fold: XauFoldName;
  costLevel: XauCostLevel;
  trades: number;
  /** distinct calendar months containing a trade — the sample the bootstrap resamples */
  blocks: number;
  avgR: number | null;
  controlMedian: number | null;
  controlP95: number | null;
  /**
   * p5 of the month-resampled rule avgR, or null when it could not be computed
   * (fewer than two distinct months). Null reads as UNVERIFIED, never as a pass.
   */
  bootstrapP5: number | null;
  longTrades: number;
  longAvgR: number | null;
  shortTrades: number;
  shortAvgR: number | null;
}

export interface XauVerdict {
  passed: boolean;
  /** every condition that did not hold, in the order §5 lists them */
  failures: string[];
  /** what did hold, so a near-miss is readable without re-running */
  notes: string[];
}

/**
 * The pre-registered PASS bar, all six conditions ANDed.
 *
 * Lives here rather than in the screen script so it can be tested on fixtures
 * before the data exists, and so the script cannot quietly hold a different bar
 * than the document. See docs/quant/2026-09-08-xauusd-preregistration.md §5.
 *
 * On condition 3: "p5 of the margin" is read as *the 5th percentile of the
 * month-resampled rule avgR exceeding the control's MEDIAN*. Stated precisely
 * because the loose phrasing has two readings and the other one — treating the
 * control median as a constant and bootstrapping the difference — would drop the
 * control's own variance and make the test anti-conservative. The control's
 * spread is represented by conditions 1 and 2, which ask about its p95.
 */
export function xauVerdict(rows: XauFoldRow[]): XauVerdict {
  const failures: string[] = [];
  const notes: string[] = [];

  // Fail closed on a malformed table before reading anything off it: a verdict
  // computed over four folds, or over a mix of cost levels, would look exactly
  // like a real one.
  if (rows.length !== XAU_FOLD_ORDER.length) {
    return { passed: false, failures: [`expected ${XAU_FOLD_ORDER.length} folds, got ${rows.length}`], notes };
  }
  const wrongLevel = rows.filter((r) => r.costLevel !== XAU_GATE_COST_LEVEL);
  if (wrongLevel.length > 0) {
    failures.push(
      `the bar is evaluated at ${XAU_GATE_COST_LEVEL} costs; ` +
        `${wrongLevel.map((r) => `${r.fold}=${r.costLevel}`).join(", ")}`,
    );
  }

  // 1. beats the control p95 in >= 3 of 5.
  const beatP95 = rows.filter((r) => r.avgR != null && r.controlP95 != null && r.avgR > r.controlP95);
  if (beatP95.length < 3) failures.push(`beats control p95 in ${beatP95.length}/5 folds, needs >= 3`);
  else notes.push(`beats control p95 in ${beatP95.length}/5`);

  // 2. beats the control median in 5 of 5. An unmeasurable fold is a failure,
  //    not an abstention.
  const beatMed = rows.filter((r) => r.avgR != null && r.controlMedian != null && r.avgR > r.controlMedian);
  if (beatMed.length < rows.length) {
    failures.push(
      `beats control median in ${beatMed.length}/5 folds, needs 5/5 (` +
        rows.filter((r) => !beatMed.includes(r)).map((r) => r.fold).join(", ") +
        ")",
    );
  } else notes.push("beats control median 5/5");

  // 3. bootstrap p5 over the control median in >= 3 of 5.
  const p5Clear = rows.filter(
    (r) => r.bootstrapP5 != null && r.controlMedian != null && r.bootstrapP5 > r.controlMedian,
  );
  const unverified = rows.filter((r) => r.bootstrapP5 == null);
  if (unverified.length > 0) {
    notes.push(`bootstrap unverified in ${unverified.map((r) => r.fold).join(", ")} (fewer than two months)`);
  }
  if (p5Clear.length < 3) failures.push(`bootstrap p5 clears the control median in ${p5Clear.length}/5 folds, needs >= 3`);
  else notes.push(`bootstrap p5 clears the control median in ${p5Clear.length}/5`);

  // 5. sample size, per fold. (4 is the cost-level check above.)
  for (const r of rows) {
    if (r.trades < MIN_XAU_TRADES) failures.push(`${r.fold}: ${r.trades} trades, needs >= ${MIN_XAU_TRADES}`);
    if (r.blocks < MIN_XAU_BLOCKS) {
      failures.push(
        `${r.fold}: trades occupy ${r.blocks} distinct months, needs >= ${MIN_XAU_BLOCKS} — ` +
          "a rule firing in bursts is a regime bet wearing a strategy's clothes",
      );
    }
  }

  // 6. the long/short split. Gold rose for twenty years; a lift that exists only
  //    on the long side is the same finding as single 2/2.5/3, which beat the
  //    baseline on longs in 4/5 folds and lost on shorts in 15 of 15 cells.
  const unsplit = rows.filter((r) => r.longAvgR == null || r.shortAvgR == null);
  if (unsplit.length > 0) {
    failures.push(`long/short split missing for ${unsplit.map((r) => r.fold).join(", ")} — unmeasured, not passed`);
  } else {
    const longPositive = rows.filter((r) => r.longAvgR! > 0).length;
    const shortPositive = rows.filter((r) => r.shortAvgR! > 0).length;
    if (longPositive > 0 && shortPositive === 0) {
      failures.push(
        `positive on longs in ${longPositive}/5 folds and on shorts in 0/5 — EXPOSURE, NOT EDGE`,
      );
    } else notes.push(`long positive ${longPositive}/5, short positive ${shortPositive}/5`);
  }

  return { passed: failures.length === 0, failures, notes };
}

/**
 * The sentence every `xau-v1` verdict carries, in the log and in any write-up.
 *
 * Kept as a constant rather than retyped per script so it cannot be softened in
 * one place and not another. It is not boilerplate: it is the difference
 * between this gate and the one the stocks desk actually trades on.
 */
export const XAU_EVIDENCE_CAVEAT =
  "xau-v1 is weaker evidence than panel-v1: one symbol, no cross-section, no ticker-disjoint replication, " +
  "and the broker is both counterparty and data source with no consolidated tape. The monthly block bootstrap " +
  "here is a plain time-series bootstrap — it has lost the cross-sectional correlation it exists to carry.";
