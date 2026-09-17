// Does mr-down3's edge survive being filled at the NEXT BAR'S OPEN?
//
// WHY THIS EXISTS
//
// Every number ever measured on mr-down3 — the five modern folds in
// scripts/mechanism-screen-control.log, and the three deep folds in
// scripts/deep-holdout.log that made it the first rule in this project to pass a
// pre-registered hold-out — fills at the SAME BAR'S CLOSE. The rule reads bar
// i's close (three consecutive lower closes) and buys at bar i's close. That is
// decidable only as a market-on-close order priced off a print that has not
// happened yet.
//
// The advisory tool now being designed cannot do that. The signal fires at the
// US close, 03:00 Thai time. The user is asleep. The design decision on the
// table is to place the order the evening before and let it fill at the next
// day's open — seventeen hours of gap risk that no measurement in this repo
// covers.
//
// If the edge is an artifact of the close print, the tool has nothing to
// recommend and the design dies here. So this runs BEFORE its first line of code.
//
// Next-bar-open is built WITHOUT touching the engine, by the technique already
// proven in scripts/probe-fill-and-costs.mts: shift the signal array right by one
// bar and fill with entryAt "open". engine.ts then sizes the stop off atrs[i-1] —
// which after the shift is the SIGNAL bar's ATR, known when the decision was
// made — and manages the entry bar, both of which are exactly what a next-open
// fill requires. runControl re-simulates through the same PanelExit object, so
// the matched random control fills at the open too; a control filling at the
// close against a rule filling at the open is not a control.
//
// PRE-REGISTRATION — written before the first run, and not edited afterwards.
//
//   HYPOTHESIS: mr-down3's edge is not an artifact of the same-bar close fill,
//   and survives a next-bar-open fill.
//
//   VERDICT FOLDS: the three DEEP folds only (deep1/deep2/deep3, 1998-2016). The
//   five modern folds are printed for continuity and are NOT part of the verdict
//   — their numbers have already been read, and a criterion scored on seen data
//   is not a hold-out.
//
//   VERDICT COST MODEL: DEFAULT_COST_MODEL (0.5bps slippage + 1bp commission),
//   because that is what deep-holdout.log ran and the two logs have to be
//   readable line against line. The 5bps block below is a SECOND pre-registered
//   statement, not a second chance at the first one.
//
//   PASS requires BOTH:
//
//     (1) ABSOLUTE. With the next-open fill, mr-down3 beats the control MEDIAN
//         in >= 2 of 3 deep folds AND beats the control P95 in >= 1 of 3. Word
//         for word the rule deep-holdout.mts pre-registered, so it is not a new
//         bar invented to fit a new number.
//
//     (2) RETENTION. Mean margin over the control median across the three deep
//         folds, at the open fill, is >= 50% of the same quantity at the close
//         fill. An edge that clears (1) while shedding most of its size has been
//         measured, not preserved, and the tool would be recommending trades on
//         an edge thinner than the slippage uncertainty around it.
//
//   ANYTHING LESS IS REJECTION of the next-open fill. Not "retest on a different
//   ladder", not "try open-unmanaged". Rejection means design decision #5 —
//   pre-placed orders, no waking up — is dead, and the remaining options are to
//   act near the US close at 03:00 Thai, or to abandon the stock advisory tool.
//
//   SECOND PRE-REGISTERED STATEMENT (retail costs). Slippage of 0.5bps vs 5bps is
//   worth ~0.027R/trade on this panel — wider than mr-down3's entire measured
//   alpha. So: if at 5bps the mean deep-fold margin over the control median is
//   <= 0 at the open fill, then the recommendations are NOT TRADEABLE at retail
//   slippage, regardless of what the 0.5bps verdict says, and the design must be
//   re-opened before anything is built. Stated now so it cannot be quietly
//   dropped after the numbers land.
//
//   NO OTHER MECHANISM MAY BE PROMOTED OUT OF THIS RUN. mr-down3 is the only row
//   printed and the only row under test.
//
// FIRST, A VOIDING CHECK. entryAt "open" is silently identical to "close" if a
// cache's open prices are degenerate (a provider that stored only closes, or a
// Yahoo interval downgrade). The run prints the fraction of bars where open !=
// close in each cache before anything else. If that fraction is not
// overwhelmingly high, THE WHOLE MEASUREMENT IS VOID and the verdict means
// nothing.
//
//   npx tsx scripts/mr-down3-open-fill.mts | tee scripts/mr-down3-open-fill.log
//   npx tsx scripts/mr-down3-open-fill.mts --control=20    (smoke run, NOT a result)
//
import "dotenv/config";
import {
  loadPanel,
  DEEP_FOLD_LIST,
  DEEP_PANEL_CACHE_PATH,
  FOLDS,
  type Fold,
  type Panel,
} from "@/lib/research/panel";
import {
  sliceFold,
  withSignals,
  simulateFold,
  runControl,
  CONTROL_RUNS,
  PANEL_SEED,
  type PanelExit,
  type PreparedSymbol,
} from "@/lib/research/panelRun";
import { LADDERS, mechanismByKey } from "@/lib/research/mechanisms";
import {
  computeEntrySignals,
  WARMUP,
  type EntrySignals,
  type CostModel,
} from "@/lib/backtest/engine";

const MECH = mechanismByKey("mr-down3");
const EXIT = LADDERS.flat; // the ladder deep-holdout and mechanism-screen both ran
const RETENTION_FLOOR = 0.5; // pre-registered in (2) above

const COSTS: { label: string; verdict: boolean; costs: CostModel }[] = [
  {
    label: "0.5bps + 1bp  (DEFAULT_COST_MODEL — the verdict cost model)",
    verdict: true,
    costs: { slippageBps: 0.5, commissionBps: 1 },
  },
  {
    label: "5bps + 1bp    (retail slippage — second pre-registered statement)",
    verdict: false,
    costs: { slippageBps: 5, commissionBps: 1 },
  },
];

/** Push every signal one bar later, so a close-derived decision fills at the next open. */
const shift1 = (s: EntrySignals): EntrySignals => {
  const sides: EntrySignals["sides"] = new Array(s.sides.length).fill(null);
  for (let i = 0; i + 1 < s.sides.length; i++) sides[i + 1] = s.sides[i];
  return { sides, atrs: s.atrs };
};

interface Row {
  fold: string;
  trades: number;
  avgR: number | null;
  winRate: number;
  controlMed: number | null;
  controlP95: number | null;
}

const marginMed = (r: Row) => (r.avgR != null && r.controlMed != null ? r.avgR - r.controlMed : null);
const marginP95 = (r: Row) => (r.avgR != null && r.controlP95 != null ? r.avgR - r.controlP95 : null);
const fmt = (v: number | null, d = 3) =>
  v == null || !Number.isFinite(v) ? "     —" : v.toFixed(d).padStart(6);

/** Fraction of bars whose open differs from their close — the voiding check. */
function openDistinctness(panel: Panel): { checked: number; distinct: number } {
  let checked = 0;
  let distinct = 0;
  for (const sym of panel.symbols) {
    for (const b of panel.bars[sym] ?? []) {
      checked++;
      if (b.o !== b.c) distinct++;
    }
  }
  return { checked, distinct };
}

function runCell(prepared: PreparedSymbol[], fold: Fold, exit: PanelExit, controlRuns: number): Row {
  const run = simulateFold(prepared, fold, exit);
  const ctrl = controlRuns > 0 ? runControl(prepared, fold, exit, controlRuns, PANEL_SEED) : null;
  return {
    fold: fold.name,
    trades: run.trades.length,
    avgR: run.summary.avgR,
    winRate: run.summary.winRate,
    controlMed: ctrl?.median ?? null,
    controlP95: ctrl?.p95 ?? null,
  };
}

function printRows(label: string, rows: Row[]) {
  console.log(`\n  ${label}`);
  console.log("    fold      trades     avgR     win%   ctrl med  ctrl p95   marg-med  marg-p95");
  for (const r of rows) {
    console.log(
      `    ${r.fold.padEnd(8)} ${String(r.trades).padStart(7)}  ${fmt(r.avgR)}  ` +
        `${r.winRate.toFixed(1).padStart(5)}%  ${fmt(r.controlMed)}   ${fmt(r.controlP95)}   ` +
        `${fmt(marginMed(r))}    ${fmt(marginP95(r))}`,
    );
  }
}

/** Prepare one fold's symbols with mr-down3's signals, at both fills. */
function prepare(panel: Panel, fold: Fold): { close: PreparedSymbol[]; open: PreparedSymbol[] } {
  const slice = sliceFold(panel, fold);
  const close = withSignals(slice, (_sym, candles) =>
    computeEntrySignals(candles, undefined, MECH.rule!(candles)),
  );
  return { close, open: close.map((p) => ({ ...p, signals: shift1(p.signals) })) };
}

async function main() {
  const controlRuns = Number(
    process.argv.find((a) => a.startsWith("--control="))?.split("=")[1] ?? CONTROL_RUNS,
  );

  console.log("mr-down3 @ next-bar-open — pre-registered, see header");
  console.log(`ladder=flat  control=${controlRuns}  seed=${PANEL_SEED}  WARMUP=${WARMUP}`);
  console.log(`rule: ${MECH.blurb}`);

  const deepPanel = loadPanel(DEEP_PANEL_CACHE_PATH);
  const modernPanel = loadPanel();

  // ---- voiding check ------------------------------------------------------
  console.log(`\n${"=".repeat(78)}\n0. VOIDING CHECK — are open prices real?\n${"=".repeat(78)}`);
  let voided = false;
  for (const [name, p] of [
    ["deep (Yahoo 1998+)", deepPanel],
    ["modern (Alpaca 2016+)", modernPanel],
  ] as const) {
    const { checked, distinct } = openDistinctness(p);
    const pct = checked ? (100 * distinct) / checked : 0;
    console.log(
      `  ${name.padEnd(24)} ${distinct}/${checked} bars have open != close  (${pct.toFixed(2)}%)`,
    );
    if (pct < 90) voided = true;
  }
  if (voided) {
    console.log("\n  *** VOID: a cache's opens are degenerate. entryAt \"open\" is not measuring a");
    console.log("      different fill on it, and every number below is meaningless. Stop here. ***");
  } else {
    console.log("  opens are real in both caches — the open fill is a genuinely different fill.");
  }

  // ---- the tables ---------------------------------------------------------
  const deepRows: Record<string, { close: Row[]; open: Row[] }> = {};

  for (const c of COSTS) {
    console.log(`\n${"=".repeat(78)}`);
    console.log(`costs = ${c.label}`);
    console.log("=".repeat(78));

    const perFill: { close: Row[]; open: Row[] } = { close: [], open: [] };
    for (const fold of DEEP_FOLD_LIST) {
      const prep = prepare(deepPanel, fold);
      perFill.close.push(
        runCell(prep.close, fold, { ...EXIT, costs: c.costs, entryAt: "close" }, controlRuns),
      );
      perFill.open.push(
        runCell(prep.open, fold, { ...EXIT, costs: c.costs, entryAt: "open" }, controlRuns),
      );
    }
    console.log("\nDEEP FOLDS — the verdict folds (1998-2016, never used for any decision)");
    printRows("fill = same-bar close (what every prior log measured)", perFill.close);
    printRows("fill = next-bar open  (what the advisory tool would actually get)", perFill.open);
    deepRows[c.label] = perFill;

    const modern: { close: Row[]; open: Row[] } = { close: [], open: [] };
    for (const fold of Object.values(FOLDS)) {
      const prep = prepare(modernPanel, fold);
      modern.close.push(
        runCell(prep.close, fold, { ...EXIT, costs: c.costs, entryAt: "close" }, controlRuns),
      );
      modern.open.push(
        runCell(prep.open, fold, { ...EXIT, costs: c.costs, entryAt: "open" }, controlRuns),
      );
    }
    console.log("\nMODERN FOLDS — context only, NOT part of the verdict (already-seen data)");
    printRows("fill = same-bar close", modern.close);
    printRows("fill = next-bar open", modern.open);
  }

  // ---- verdict ------------------------------------------------------------
  console.log(
    `\n${"=".repeat(78)}\nVERDICT — scored against the header, which was written first\n${"=".repeat(78)}`,
  );

  const verdictCost = COSTS.find((c) => c.verdict)!;
  const { close: dClose, open: dOpen } = deepRows[verdictCost.label];

  const beatsMed = dOpen.filter((r) => (marginMed(r) ?? -1) > 0).length;
  const beatsP95 = dOpen.filter((r) => (marginP95(r) ?? -1) > 0).length;
  const mean = (rows: Row[]) => {
    const v = rows.map(marginMed).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
  };
  const meanOpen = mean(dOpen);
  const meanClose = mean(dClose);
  const retention = meanClose > 0 ? meanOpen / meanClose : NaN;

  const absolutePass = beatsMed >= 2 && beatsP95 >= 1;
  const retentionPass = Number.isFinite(retention) && retention >= RETENTION_FLOOR;

  console.log(`  cost model: ${verdictCost.label}`);
  console.log(
    `  (1) ABSOLUTE   beats control median: ${beatsMed}/3 (need >=2)   beats p95: ${beatsP95}/3 (need >=1)  -> ${absolutePass ? "PASS" : "FAIL"}`,
  );
  console.log(
    `  (2) RETENTION  mean margin-over-median  close ${meanClose.toFixed(4)}  open ${meanOpen.toFixed(4)}`,
  );
  console.log(
    `                 retention ${(100 * retention).toFixed(1)}% (need >=${100 * RETENTION_FLOOR}%)  -> ${retentionPass ? "PASS" : "FAIL"}`,
  );
  console.log(`\n  NEXT-OPEN FILL: ${absolutePass && retentionPass ? "PASS" : "REJECTED"}`);
  if (!(absolutePass && retentionPass)) {
    console.log("  -> design decision #5 (pre-placed orders, fill at next open) is dead.");
    console.log("     Remaining options: act near the US close (03:00 Thai), or abandon the tool.");
  }

  const retailCost = COSTS.find((c) => !c.verdict)!;
  const meanRetail = mean(deepRows[retailCost.label].open);
  console.log(`\n  SECOND STATEMENT (retail costs, ${retailCost.label.split("(")[0].trim()}):`);
  console.log(
    `    mean deep-fold margin over control median at the open fill: ${meanRetail.toFixed(4)}`,
  );
  console.log(
    `    -> ${meanRetail > 0 ? "TRADEABLE at retail slippage" : "NOT TRADEABLE at retail slippage — re-open the design before building"}`,
  );

  if (voided) {
    console.log("\n  *** REMINDER: the voiding check failed. Disregard every verdict above. ***");
  }
}

await main();
