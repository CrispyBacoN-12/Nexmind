// The TEST rows for the two mechanisms that advanced out of the weekly screen.
//
// WHY THIS EXISTS
//
// scripts/weekly-mechanism-screen.log ended with "ADVANCES: mr-down3, gap-fade".
// Its pre-registration defines what advancing means, and this script is that
// step, nothing more:
//
//   "Advancing means: read its TEST rows, and if those hold, write a SEPARATE
//    pre-registration and spend the deep hold-out once. Nothing is approved
//    from this log."
//
// So this is a FILTER placed between the screen and the deep hold-out. It is
// not a verdict, and no mechanism is approved, deployed, or sized on it.
//
// PRE-REGISTRATION (fixed before the first run; not edited afterwards)
//
// HYPOTHESIS. mr-down3 and/or gap-fade, unmodified, on weekly bars at the
//   livable fill, still beat their matched random-entry control outside the
//   folds they were screened on.
//
// EXACTLY ONE THING MOVES from scripts/weekly-mechanism-screen.mts: the folds.
//   Same two mechanisms, same rules, same ladder (LADDERS.flat, tp1 1.2 /
//   sl 1.5), same resampler, same seed, same control count, same fill, same
//   fold warm-up. If any of those had moved too, a difference in the numbers
//   would not attribute to the folds.
//
// FOLDS READ. test1, test2, test3 ONLY. fit and select are not re-printed —
//   they are already in scripts/weekly-mechanism-screen.log and reprinting them
//   here would invite reading a five-fold row as if it were one measurement.
//   DEEP1-3 are NOT read: this script does not import DEEP_FOLDS or
//   DEEP_PANEL_CACHE_PATH, and descriptive statistics count as reading them.
//
// THE TEST FOLDS ARE NOT VIRGIN DATA. src/lib/research/panel.ts says so itself,
//   and scripts/mechanism-screen-control.log already printed mr-down3's daily
//   TEST margins (+0.056 / +0.010 / +0.047) while deciding what to look at
//   next. These folds have been used to choose. That is exactly why the deep
//   hold-out exists and why this run cannot substitute for it. Read this log as
//   "is it still worth spending DEEP on?", never as "does it work?".
//
// FILL. Decided at the close of weekly bar i, filled at the open of weekly bar
//   i+1 (shift1 + entryAt "open"). NO CLOSE-FILL NUMBER IS PRINTED AS A RESULT.
//
// COST MODEL. DEFAULT_COST_MODEL (0.5bps slip + 1bp comm) decides. A 5bps+1bp
//   retail block is printed as a separate pre-registered statement.
//
// CRITERION — "TEST rows hold". A mechanism holds if, at DEFAULT_COST_MODEL, it
//   beats the control MEDIAN in at least 2 of the 3 TEST folds AND its own raw
//   avgR is greater than zero in at least 2 of the 3. Both conditions, or it
//   does not hold. The second condition is there because gap-fade cleared the
//   screen on a negative control while its own avgR was ~0, and a rule that
//   loses money slightly less than random is an information result, not a
//   trade.
//
// CONSEQUENCE OF A FAIL (pre-registered, so a bad result cannot be talked into
//   a re-run). If neither mechanism holds: do not spend the deep hold-out, do
//   not sweep the ladder, do not move the criterion, do not add a rule and
//   re-run, do not try a third fill. It means the "price shape from daily
//   OHLCV" axis is closed on weekly bars as well as daily ones, and the design
//   moves to a new data class or to changing what the product is — the two
//   options already written into
//   docs/superpowers/specs/2026-09-08-weekly-bar-mechanism-screen-design.md.
//
// IF SOMETHING HOLDS. It still is not approved here. It earns one thing: the
//   right to have a SEPARATE pre-registration written, and the deep hold-out
//   spent once against it.
//
// RESAMPLER CHECK. weeklyPanel re-derives every weekly bar from its daily
//   source and compares field by field. It throws; this script does not catch it.
//
// VOIDING CHECK. The fraction of weekly bars where open != close must be
//   >= 0.99, or entryAt "open" is indistinguishable from "close" and the run
//   is VOID.
//
// TRADE FLOOR. Every fold must clear MIN_PANEL_TRADES. Unlike FIT, all three
//   TEST folds have a full 104-weekly-bar warm-up prefix available, so every
//   week inside each fold is tradable.
//
//   npx tsx scripts/weekly-test-rows.mts --checks-only
//   npx tsx scripts/weekly-test-rows.mts | tee scripts/weekly-test-rows.log
//
import "dotenv/config";
import { loadPanel, TEST_FOLDS, type Fold, type Panel } from "@/lib/research/panel";
import { weeklyPanel, WEEKLY_PANEL_WARMUP_BARS } from "@/lib/research/weekly";
import {
  sliceFold,
  withSignals,
  simulateFold,
  runControl,
  CONTROL_RUNS,
  PANEL_SEED,
  MIN_PANEL_TRADES,
  type FoldSliceRow,
  type PanelExit,
  type PreparedSymbol,
} from "@/lib/research/panelRun";
import { LADDERS, MECHANISMS, type Mechanism } from "@/lib/research/mechanisms";
import { computeEntrySignals, WARMUP, type EntrySignals } from "@/lib/backtest/engine";

const EXIT = LADDERS.flat; // the ladder every screen and hold-out in this repo ran
const RETAIL_COSTS = { slippageBps: 5, commissionBps: 1 };

/** The two keys scripts/weekly-mechanism-screen.log printed on its ADVANCES line. */
const ADVANCED = ["mr-down3", "gap-fade"] as const;
const MIN_OPEN_DIFFERS = 0.99;
/** beats-median in >= this many of the 3 TEST folds, AND avgR > 0 in >= this many. */
const HOLD_MIN_FOLDS = 2;

const CANDIDATES: Mechanism[] = ADVANCED.map((key) => {
  const m = MECHANISMS.find((x) => x.key === key);
  if (!m?.rule) throw new Error(`mechanism ${key} is missing or has no rule closure`);
  if (m.entryAt) throw new Error(`mechanism ${key} pins its own entryAt; not comparable at this fill`);
  return m;
});

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

/**
 * Realised 1R as a fraction of price on the bars a mechanism fires on. Printed
 * so the weekly cost arithmetic stays falsifiable across folds, exactly as it
 * was in the screen.
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
  const thin = r.trades < MIN_PANEL_TRADES ? "  BELOW-TRADE-FLOOR" : "";
  console.log(
    `    ${r.fold.name.padEnd(8)}${String(r.trades).padStart(8)}${String(r.symbolsTraded).padStart(9)}  ` +
      `${f3(r.avgR)}  ${r.winRate.toFixed(1).padStart(5)}%  ` +
      `${f3(r.ctrlMed)}  ${f3(r.ctrlP95)}  ${f3(margin)}  ${(100 * r.medianR).toFixed(2).padStart(6)}%  ${verdict}${thin}`,
  );
}

async function main() {
  const checksOnly = process.argv.includes("--checks-only");

  console.log("weekly TEST rows — mr-down3 and gap-fade, livable fill, test1/test2/test3 only");
  console.log("PRE-REGISTERED: see this script's header. This is a FILTER before the deep hold-out,");
  console.log("not a verdict. The TEST folds have already been used to choose; nothing is approved here.");

  console.log("\nloading daily panel cache…");
  const daily = loadPanel();
  console.log(`panel ${daily.cachePath} — ${daily.symbols.length} symbols, fetchedAt ${daily.fetchedAt}`);

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
  for (const fold of TEST_FOLDS) {
    slices[fold.name] = sliceFold(weekly, fold, weekly.symbols, WEEKLY_PANEL_WARMUP_BARS);
    const rows = slices[fold.name];
    const tradable = rows.length ? rows[0].candles.length - rows[0].entryFrom : 0;
    console.log(`  ${fold.name}: ${rows.length} symbols participate, ` +
      `${rows.length ? rows[0].entryFrom : 0} warm-up + ${tradable} tradable weekly bars (first symbol)`);
  }

  if (checksOnly) {
    console.log("\n--checks-only: stopping before the run.");
    return;
  }

  console.log(`\nfill: decided at the close of weekly bar i, filled at the open of bar i+1 ` +
    `(Friday 16:00 ET -> Monday 09:30 ET = Saturday 03:00 -> Monday 20:30 Thai)`);
  console.log(`ladder=flat tp1=${EXIT.tp1Mult} sl=${EXIT.slMult}  control=${CONTROL_RUNS} runs  seed=${PANEL_SEED}  ` +
    `engine WARMUP=${WARMUP} bars  fold warm-up=${WEEKLY_PANEL_WARMUP_BARS} weekly bars  trade floor=${MIN_PANEL_TRADES}`);

  const blocks: { label: string; exit: PanelExit; decides: boolean }[] = [
    { label: "DEFAULT_COST_MODEL (0.5bps slip + 1bp comm) — THIS BLOCK DECIDES", exit: { ...EXIT, entryAt: "open" }, decides: true },
    { label: "retail (5bps slip + 1bp comm) — pre-registered second statement", exit: { ...EXIT, entryAt: "open", costs: RETAIL_COSTS }, decides: false },
  ];

  const held: string[] = [];
  const failed: string[] = [];

  for (const block of blocks) {
    console.log(`\n${"=".repeat(120)}\n${block.label}\n${"=".repeat(120)}`);
    for (const mech of CANDIDATES) {
      console.log(`\n${mech.key}`);
      console.log(`  ${mech.blurb}`);
      console.log("    fold      trades  symbols     avgR     win%   ctrl med  ctrl p95   margin      1R  verdict");
      let beatsMedian = 0;
      let positiveAvgR = 0;
      let thinFolds = 0;
      for (const fold of TEST_FOLDS) {
        const prepared = livablePrepared(slices[fold.name], mech.rule!);
        const r = runRow(prepared, fold, block.exit);
        printRow({ fold, ...r });
        if (r.avgR != null && r.ctrlMed != null && r.avgR > r.ctrlMed) beatsMedian++;
        if (r.avgR != null && r.avgR > 0) positiveAvgR++;
        if (r.trades < MIN_PANEL_TRADES) thinFolds++;
      }
      if (!block.decides) continue;
      const holds = beatsMedian >= HOLD_MIN_FOLDS && positiveAvgR >= HOLD_MIN_FOLDS && thinFolds === 0;
      console.log(
        `    -> beats-median ${beatsMedian}/3, avgR>0 ${positiveAvgR}/3` +
          (thinFolds ? `, ${thinFolds} fold(s) below the trade floor` : "") +
          `  =>  ${holds ? "HOLDS" : "DOES NOT HOLD"}`,
      );
      (holds ? held : failed).push(mech.key);
    }
  }

  console.log(`\n${"=".repeat(120)}`);
  console.log(`CRITERION: beats the control MEDIAN in >= ${HOLD_MIN_FOLDS} of 3 TEST folds AND raw avgR > 0 in ` +
    `>= ${HOLD_MIN_FOLDS} of 3, at DEFAULT_COST_MODEL.`);
  if (failed.length) console.log(`DOES NOT HOLD: ${failed.join(", ")} — closed. Not re-tuned, not re-run at another ladder or fill.`);
  console.log(held.length
    ? `HOLDS: ${held.join(", ")} — earns ONE thing: a SEPARATE pre-registration may now be written, and the deep ` +
      `hold-out spent once against it. Nothing is approved from this log.`
    : `NOTHING HOLDS. Per this script's header: do not spend the deep hold-out, do not sweep the ladder, do not ` +
      `move the criterion, do not add a rule and re-run. The price-shape axis is closed on weekly bars too, and ` +
      `the design moves to a new data class or to changing what the product is.`);
  console.log(`\nThese folds were already read on daily bars while choosing what to look at next, so a pass here is ` +
    `weaker evidence than it looks. DEEP1-3 remain unread.`);
}

await main();
