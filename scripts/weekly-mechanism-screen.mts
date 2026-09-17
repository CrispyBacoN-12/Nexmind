// Do any of the six existing mechanisms survive on WEEKLY bars, at a fill the
// owner can actually place?
//
// WHY THIS EXISTS
//
// scripts/deep-holdout.log had mr-down3 passing 3/3 deep folds — filled at the
// bar's CLOSE, which on a US daily bar is 16:00 ET = 03:00 Thai. The owner has
// said a 03:00 routine is not acceptable, and both fills that remove the
// wake-up are now measured and dead: mr-down3-open-fill.log (next open,
// REJECTED — the edge is the overnight gap) and mr-down3-limit-fill.log
// (limit at the previous close, REJECTED, absolute 0/3, retention -157%).
//
// mr-down3-limit-fill.mts pre-registered the consequence before it ran: a FAIL
// does not license a search for a third fill, it says the design must change
// MECHANISM rather than fill. scripts/holding-period.log then measured what to
// change to — the gap tax is mechanism-specific, not universal (mr-down3 and
// turn-of-month shed ~0.055R on FIT, everything else ~0.01R, vol-dryup ~0), so
// a mechanism whose profit survives a livable fill is not a contradiction in
// terms.
//
// Design: docs/superpowers/specs/2026-09-08-weekly-bar-mechanism-screen-design.md
//
// PRE-REGISTRATION (fixed before the first run; not edited afterwards)
//
// HYPOTHESIS. At least one mechanism in the existing library, on weekly bars,
// at the livable fill, beats its matched random-entry control.
//
// EXACTLY ONE VARIABLE MOVES: the bar class. The same six MECHANISMS entries,
// unmodified. No new rule, no swept parameter, no swept ladder. A survivor
// therefore attributes to the bar class and to nothing else.
//
// SCREENING FOLDS. fit and select ONLY. TEST1-3 are not read. DEEP1-3 are not
// read — they are the only untouched window left for a mechanism that does not
// yet exist, and descriptive statistics count as reading them.
//
// FILL. Decided at the close of weekly bar i, filled at the open of weekly bar
// i+1 (shift1 + entryAt "open"). NO CLOSE-FILL NUMBER IS PRINTED AS A RESULT.
// Every screen in this repo until now reported a price the owner cannot trade;
// three runs were spent discovering that about one mechanism.
//
// COST MODEL. DEFAULT_COST_MODEL (0.5bps slip + 1bp comm) decides. A 5bps+1bp
// retail block is printed as a separate pre-registered statement.
//
// PROMOTION BAR. A mechanism advances only if it beats the CONTROL MEDIAN in
// BOTH fit and select, at DEFAULT_COST_MODEL. Advancing means: read its TEST
// rows, and if those hold, write a SEPARATE pre-registration and spend the deep
// hold-out once. Nothing is approved from this log.
//
// VOIDING CHECK. The fraction of weekly bars where open != close must be >= 0.99.
// A resampler that collapsed a week to one print would make entryAt "open"
// identical to "close" and the whole measurement would be meaningless.
//
// RESAMPLER CHECK. weeklyPanel re-derives every weekly bar from its daily
// source and compares field by field. It throws; this script does not catch it.
//
// HARNESS CHECK. The DAILY panel is re-run at the close fill and ASSERTED —
// not printed — to still reproduce scripts/mechanism-screen-control.log to
// within 0.002R. Only match/mismatch reaches the log, so no close-fill number
// is reported as a result. A resampler that corrupts the panel must not be able
// to look like a finding. On a mismatch the offending mechanism and fold are
// named without their numbers; the numbers are recoverable by re-running
// scripts/mechanism-screen.mts, so nothing is lost by withholding them here.
//
// CONSEQUENCE OF A FAIL. If no mechanism clears the bar: do not sweep the
// ladder, do not move the threshold, do not add a rule and re-run. It means the
// "price shape from daily OHLCV" axis is closed, and the design moves to a new
// data class or to changing what the product is. See the spec's final section.
//
// KNOWN CONSTRAINT, stated before the run. sp500-1d.json begins 2016-01-04, the
// same day FOLDS.fit begins, so FIT has NO warm-up prefix and loses its first
// 60 weekly bars to the engine's own WARMUP — fourteen months of a three-year
// fold. ~96 tradable weeks x ~474 symbols is still far above MIN_PANEL_TRADES.
// SELECT is 52 weekly bars. Both folds are weaker than their daily equivalents
// and are read that way. Splicing the deep cache in front of FIT as warm-up was
// rejected: it would put a provider seam at FIT's first tradable bar.
//
//   npx tsx scripts/weekly-mechanism-screen.mts --checks-only
//   npx tsx scripts/weekly-mechanism-screen.mts | tee scripts/weekly-mechanism-screen.log
//
// ADDED 2026-09-14 — `--panel=` REPLICATION ON A DISJOINT UNIVERSE
//
// WHY. Both survivors of this screen were already REJECTED at the weekly deep
// hold-out (weekly-deep-holdout.log, 2026-09-08): the deep-window CONTROL pays
// +0.11..+0.17 in those folds, so a rule can make money in all three and still
// lose. That rejection turns on the TIME PERIOD's regime, not on how many
// symbols were screened, and this flag cannot reopen it — broad-1d.json is
// Alpaca-sourced and floors at 2016-01-04 (deep-history-is-free.md), so there
// is no pre-2016 broad panel to spend a deep hold-out against. What THIS flag
// answers is a narrower, still-open question: was the FIT/SELECT pass that
// earned mr-down3 and gap-fade their TEST/DEEP reads itself a small-sample
// artifact of screening only the 491 most arbitraged tickers on earth, or does
// it replicate on ~1,172 disjoint names before the deep-fold regime kills it
// anyway? EXACTLY ONE VARIABLE MOVES, again: the universe — not the bar class,
// not the mechanism, not the ladder, not the fold set.
//
// STRONG PRIOR, stated before running this. The identical swap was already
// made once, on DAILY bars (STATE.md §4g, 2026-08-26,
// docs/quant/2026-08-26-broad-universe-rerun.md): same six mechanisms, same
// baseline, same folds, same ladder, same seed, only `--panel=` differed. Not
// one of ten fold-cells flipped verdict, and the closing line was explicit:
// "further universe-swapping on daily OHLCV should not be funded." That prior
// makes a flip here unlikely — but it was never measured on WEEKLY bars, which
// is the only bar class where any mechanism has ever cleared FIT+SELECT at
// all, so inferring the weekly answer from the daily one is exactly the
// unexamined-constant mistake weekly-bars-reopen-the-entry-axis.md warns
// against. This run tests it instead of assuming it.
//
// HARNESS CHECK ADAPTATION. The fixed DAILY_CLOSE_FILL table below is specific
// to sp500-1d.json (scripts/mechanism-screen-control.log). Passing `--panel=`
// selects DAILY_CLOSE_FILL_BROAD instead — sourced the same way, from an
// INDEPENDENT prior measurement (scripts/mechanism-screen-broad-control.log,
// 2026-08-26, `mechanism-screen.mts --panel=.cache/bars/broad-1d.json`), not
// invented for this run. The check still asserts rather than prints, for the
// same reason as always: a resampler or engine regression must not be able to
// look like a finding just because nobody had numbers to catch it against.
//
// CONSEQUENCE. A pass (mr-down3 and/or gap-fade clear FIT+SELECT on the broad
// panel too) closes the small-sample objection to the ORIGINAL weekly screen
// without changing either mechanism's status: both stay REJECTED at deep.
// Nothing here is promotable — the promotion-bar language below still prints,
// but it describes what advancing would have meant before deep closed this
// door, not a live option. A fail (broad panel does NOT replicate) would be
// the more interesting outcome: it would mean the original S&P weekly pass was
// itself likely noise, one layer earlier than the deep rejection already
// found.
//
//   npx tsx scripts/weekly-mechanism-screen.mts --panel=.cache/bars/broad-1d.json --checks-only
//   npx tsx scripts/weekly-mechanism-screen.mts --panel=.cache/bars/broad-1d.json | tee scripts/weekly-mechanism-screen-broad.log
//
import "dotenv/config";
import { loadPanel, FOLDS, PANEL_CACHE_PATH, type Fold, type Panel } from "@/lib/research/panel";
import { weeklyPanel, WEEKLY_PANEL_WARMUP_BARS } from "@/lib/research/weekly";
import {
  sliceFold,
  withSignals,
  simulateFold,
  runControl,
  CONTROL_RUNS,
  PANEL_SEED,
  type FoldSliceRow,
  type PanelExit,
  type PreparedSymbol,
} from "@/lib/research/panelRun";
import { LADDERS, MECHANISMS, type Mechanism } from "@/lib/research/mechanisms";
import { computeEntrySignals, WARMUP, type EntrySignals } from "@/lib/backtest/engine";

const EXIT = LADDERS.flat; // the ladder every screen and hold-out in this repo ran
const RETAIL_COSTS = { slippageBps: 5, commissionBps: 1 };
const SCREEN_FOLDS: Fold[] = [FOLDS.fit, FOLDS.select];

/**
 * The rule-bearing, fill-agnostic mechanisms: `baseline` is decideSetup() and
 * has no rule closure, and gap-fade-open* pin their own entryAt, so neither is
 * comparable at a fill this script chooses.
 */
const SCREENED = MECHANISMS.filter((m) => m.rule && !m.entryAt);

/** Close-fill DAILY avgR from scripts/mechanism-screen-control.log. Asserted, never printed. */
const DAILY_CLOSE_FILL: Record<string, Record<string, number>> = {
  "mr-down3": { fit: 0.08, select: 0.133 },
  nr7: { fit: 0.002, select: 0.015 },
  "gap-fade": { fit: -0.013, select: -0.031 },
  "turn-of-month": { fit: 0.093, select: 0.051 },
  "vol-dryup": { fit: 0.108, select: 0.083 },
  "range-expand": { fit: -0.014, select: 0.002 },
};

const BROAD_PANEL_CACHE_PATH = ".cache/bars/broad-1d.json";

/** Close-fill DAILY avgR on the broad panel, from scripts/mechanism-screen-broad-control.log (2026-08-26). */
const DAILY_CLOSE_FILL_BROAD: Record<string, Record<string, number>> = {
  "mr-down3": { fit: 0.052, select: 0.086 },
  nr7: { fit: -0.015, select: -0.037 },
  "gap-fade": { fit: -0.004, select: -0.031 },
  "turn-of-month": { fit: 0.035, select: 0.061 },
  "vol-dryup": { fit: 0.056, select: 0.053 },
  "range-expand": { fit: -0.037, select: -0.034 },
};

/** Which recorded close-fill table applies to a given daily panel's cache path. */
const HARNESS_TABLE_BY_CACHE_PATH: Record<string, Record<string, Record<string, number>>> = {
  [PANEL_CACHE_PATH]: DAILY_CLOSE_FILL,
  [BROAD_PANEL_CACHE_PATH]: DAILY_CLOSE_FILL_BROAD,
};

const HARNESS_TOLERANCE_R = 0.002;
const MIN_OPEN_DIFFERS = 0.99;

/** Push every signal one bar later, so a close-derived decision fills at the next open. */
const shift1 = (s: EntrySignals): EntrySignals => {
  const sides: EntrySignals["sides"] = new Array(s.sides.length).fill(null);
  for (let i = 0; i + 1 < s.sides.length; i++) sides[i + 1] = s.sides[i];
  return { sides, atrs: s.atrs };
};

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// --- the three checks ------------------------------------------------------

/** VOIDING CHECK. If a week collapsed to one print, entryAt "open" means nothing. */
function openDiffersFraction(panel: Panel): number {
  let bars = 0;
  let differs = 0;
  for (const symbol of panel.symbols) {
    for (const b of panel.bars[symbol]) {
      bars++;
      if (b.o !== b.c) differs++;
    }
  }
  return bars ? differs / bars : NaN;
}

/** HARNESS CHECK. Returns the failing "mech/fold" labels — never the numbers. */
function harnessMismatches(daily: Panel): string[] {
  const table = HARNESS_TABLE_BY_CACHE_PATH[daily.cachePath];
  const bad: string[] = [];
  if (!table) {
    return SCREENED.flatMap((mech) =>
      SCREEN_FOLDS.map((fold) => `${mech.key}/${fold.name} (no recorded close-fill table for ${daily.cachePath})`),
    );
  }
  for (const fold of SCREEN_FOLDS) {
    const slices = sliceFold(daily, fold);
    for (const mech of SCREENED) {
      const expected = table[mech.key]?.[fold.name];
      if (expected == null) {
        bad.push(`${mech.key}/${fold.name} (no recorded close-fill value)`);
        continue;
      }
      const prepared = withSignals(slices, (_sym, candles) =>
        computeEntrySignals(candles, undefined, mech.rule!(candles)),
      );
      const got = simulateFold(prepared, fold, { ...EXIT, entryAt: "close" }).summary.avgR;
      if (got == null || Math.abs(got - expected) > HARNESS_TOLERANCE_R) bad.push(`${mech.key}/${fold.name}`);
    }
  }
  return bad;
}

/**
 * Realised 1R as a fraction of price on the bars a mechanism fires on.
 *
 * The spec's cost table projects weekly 1R at ~8.3% of price by sqrt-of-time
 * scaling off a measured daily 3.70% (scripts/r-size-vs-costs.log). Printing
 * the realised figure is what makes that projection falsifiable rather than
 * decorative.
 */
function medianSignalR(prepared: PreparedSymbol[], slMult: number): number {
  const rs: number[] = [];
  for (const p of prepared) {
    const { sides, atrs } = p.signals;
    for (let i = 0; i < atrs.length; i++) {
      if (!sides[i]) continue;
      const r = (slMult * atrs[i]) / p.candles[i]?.c;
      if (r > 0 && r < 1) rs.push(r);
    }
  }
  rs.sort((a, b) => a - b);
  return quantile(rs, 0.5);
}

// --- the screen ------------------------------------------------------------

interface Row {
  fold: Fold;
  trades: number;
  symbolsTraded: number;
  avgR: number | null;
  /** BacktestSummary.winRate is already a PERCENT (0-100), not a fraction. Do not multiply it. */
  winRate: number;
  ctrlMed: number | null;
  ctrlP95: number | null;
  medianR: number;
}

/** Signals for one fold at the livable fill: decided on bar i, pushed to fill at bar i+1's open. */
function livablePrepared(slices: FoldSliceRow[], rule: NonNullable<Mechanism["rule"]>): PreparedSymbol[] {
  return withSignals(slices, (_sym, candles) =>
    computeEntrySignals(candles, undefined, rule(candles)),
  ).map((p) => ({ ...p, signals: shift1(p.signals) }));
}

function runRow(prepared: PreparedSymbol[], fold: Fold, exit: PanelExit): Omit<Row, "fold"> {
  const run = simulateFold(prepared, fold, exit);
  const ctrl = runControl(prepared, fold, exit, CONTROL_RUNS, PANEL_SEED);
  return {
    trades: run.trades.length,
    symbolsTraded: run.symbolsTraded,
    avgR: run.summary.avgR,
    winRate: run.summary.winRate,
    ctrlMed: ctrl?.median ?? null,
    ctrlP95: ctrl?.p95 ?? null,
    medianR: medianSignalR(prepared, exit.slMult),
  };
}

const f3 = (v: number | null) => (v == null || !Number.isFinite(v) ? "    —" : v.toFixed(3).padStart(7));

function printRow(r: Row): void {
  const margin = r.avgR != null && r.ctrlMed != null ? r.avgR - r.ctrlMed : null;
  const verdict = margin == null ? "no-control" : margin > 0 ? "beats-median" : "LOSES-to-median";
  console.log(
    `    ${r.fold.name.padEnd(8)}${String(r.trades).padStart(8)}${String(r.symbolsTraded).padStart(9)}  ` +
      `${f3(r.avgR)}  ${r.winRate.toFixed(1).padStart(5)}%  ` +
      `${f3(r.ctrlMed)}  ${f3(r.ctrlP95)}  ${f3(margin)}  ${(100 * r.medianR).toFixed(2).padStart(6)}%  ${verdict}`,
  );
}

async function main() {
  const checksOnly = process.argv.includes("--checks-only");
  const panelPath = process.argv.find((a) => a.startsWith("--panel="))?.split("=")[1];

  console.log("weekly-bar mechanism screen — livable fill only, fit + select only");
  console.log("PRE-REGISTERED: see this script's header. Nothing here may be approved.");

  console.log("\nloading daily panel cache…");
  const daily = panelPath ? loadPanel(panelPath) : loadPanel();
  console.log(`panel ${daily.cachePath} — ${daily.symbols.length} symbols, fetchedAt ${daily.fetchedAt}`);

  // HARNESS CHECK — daily, close fill, asserted not printed.
  const bad = harnessMismatches(daily);
  console.log(`HARNESS CHECK (daily panel reproduces its recorded close-fill numbers to ${HARNESS_TOLERANCE_R}R): ` +
    (bad.length ? `mismatch — ${bad.join(", ")}` : "match"));
  if (bad.length) {
    console.error("aborting: the harness does not reproduce its own recorded numbers, so nothing below would mean anything.");
    process.exit(1);
  }

  // RESAMPLER CHECK — inside weeklyPanel; it throws, and nothing catches it.
  console.log("\nresampling to weekly bars (every bar asserted against its daily source)…");
  const weekly = weeklyPanel(daily);
  const totalWeeks = weekly.symbols.reduce((a, s) => a + weekly.bars[s].length, 0);
  console.log(`RESAMPLER CHECK: pass — ${weekly.symbols.length} symbols, ${totalWeeks} weekly bars from ${weekly.cachePath}`);

  // VOIDING CHECK.
  const frac = openDiffersFraction(weekly);
  console.log(`VOIDING CHECK (weekly bars with open != close): ${(100 * frac).toFixed(2)}% ` +
    `— bar is ${(100 * MIN_OPEN_DIFFERS).toFixed(0)}%`);
  if (!(frac >= MIN_OPEN_DIFFERS)) {
    console.error("aborting: VOID. A weekly bar whose open equals its close makes the livable fill identical to the close fill.");
    process.exit(1);
  }

  const slices: Record<string, FoldSliceRow[]> = {};
  for (const fold of SCREEN_FOLDS) {
    slices[fold.name] = sliceFold(weekly, fold, weekly.symbols, WEEKLY_PANEL_WARMUP_BARS);
    const rows = slices[fold.name];
    const tradable = rows.length ? rows[0].candles.length - rows[0].entryFrom : 0;
    console.log(`  ${fold.name}: ${rows.length} symbols participate, ` +
      `${rows.length ? rows[0].entryFrom : 0} warm-up + ${tradable} tradable weekly bars (first symbol)`);
  }

  if (checksOnly) {
    console.log("\n--checks-only: stopping before the screen.");
    return;
  }

  console.log(`\nfill: decided at the close of weekly bar i, filled at the open of bar i+1 ` +
    `(Friday 16:00 ET -> Monday 09:30 ET = Saturday 03:00 -> Monday 20:30 Thai)`);
  console.log(`ladder=flat tp1=${EXIT.tp1Mult} sl=${EXIT.slMult}  control=${CONTROL_RUNS} runs  seed=${PANEL_SEED}  ` +
    `engine WARMUP=${WARMUP} bars  fold warm-up=${WEEKLY_PANEL_WARMUP_BARS} weekly bars`);

  const blocks: { label: string; exit: PanelExit; decides: boolean }[] = [
    { label: "DEFAULT_COST_MODEL (0.5bps slip + 1bp comm) — THIS BLOCK DECIDES", exit: { ...EXIT, entryAt: "open" }, decides: true },
    { label: "retail (5bps slip + 1bp comm) — pre-registered second statement", exit: { ...EXIT, entryAt: "open", costs: RETAIL_COSTS }, decides: false },
  ];

  const promoted: string[] = [];

  for (const block of blocks) {
    console.log(`\n${"=".repeat(112)}\n${block.label}\n${"=".repeat(112)}`);
    for (const mech of SCREENED) {
      console.log(`\n${mech.key}`);
      console.log(`  ${mech.blurb}`);
      console.log("    fold      trades  symbols     avgR     win%   ctrl med  ctrl p95   margin      1R  verdict");
      const beats: boolean[] = [];
      for (const fold of SCREEN_FOLDS) {
        const prepared = livablePrepared(slices[fold.name], mech.rule!);
        const r = runRow(prepared, fold, block.exit);
        printRow({ fold, ...r });
        beats.push(r.avgR != null && r.ctrlMed != null && r.avgR > r.ctrlMed);
      }
      if (block.decides && beats.every(Boolean)) promoted.push(mech.key);
    }
  }

  console.log(`\n${"=".repeat(112)}`);
  console.log("PROMOTION BAR: beats the control MEDIAN in BOTH fit and select, at DEFAULT_COST_MODEL.");
  console.log(promoted.length
    ? `ADVANCES: ${promoted.join(", ")} — read its TEST rows, then write a SEPARATE pre-registration before spending the deep hold-out.`
    : "NO CANDIDATE. Per this script's header: do not sweep the ladder, do not move the threshold, do not add a rule and re-run.");
  console.log(`\n1R is the median of slMult x ATR / close over the bars each mechanism fires on. The spec projected ~8.3%`);
  console.log(`of price for weekly bars by sqrt-of-time scaling off a measured daily 3.70%; the column above is what`);
  console.log(`actually happened, and is the number that falsifies the cost arithmetic if it disagrees.`);
}

await main();
