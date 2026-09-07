// How long does each mechanism actually hold — and how much of its edge is the
// FIRST overnight gap?
//
// WHY THIS EXISTS
//
// scripts/mr-down3-open-fill.log and scripts/mr-down3-limit-fill.log between them
// killed both entry timings that let the owner sleep. The attribution said the
// edge is the overnight gap, but "the gap" was never sized against the trade it
// belongs to. If mr-down3 holds two bars, one gap IS the trade and no fill can
// be moved. If it holds fifteen, losing one gap should have cost a fifteenth,
// and the open-fill result would mean something else entirely.
//
// The next design step is choosing a REPLACEMENT mechanism. That choice needs a
// filter, and the filter this measures is: a candidate whose profit is spread
// over a holding period is survivable at a livable fill; a candidate whose
// profit is one gap is not, whatever its avgR says.
//
// THIS IS A DIAGNOSTIC. No hypothesis is under test, no criterion is
// pre-registered, and nothing may be approved or rejected on these numbers
// alone. It exists to turn "the edge is the gap" into a number, and to give the
// mechanism search a filter that can be stated before candidates are invented.
//
// WHY THE DEEP FOLDS ARE NOT TOUCHED
//
// deep1/2/3 are the only untouched data left for a mechanism that does not yet
// exist. Descriptive statistics still count as reading them. This runs on FIT
// and SELECT only — the folds whose whole purpose is screening — so the deep
// hold-out stays clean for whatever replaces mr-down3.
//
// WHAT THE TWO FILLS ARE
//
//   close  decide at bar i's close, fill at bar i's close   (03:00 Thai, unlivable)
//   open   decide at bar i's close, fill at bar i+1's open  (20:30 Thai, livable)
//
// built by shift1 + entryAt "open", the technique mr-down3-open-fill.mts already
// used and documented. No engine change.
//
// The DROP between them is the first gap's contribution to avgR. It is NOT a
// verdict — there is no control here — but it is comparable ACROSS rows, which
// is the only thing being asked of it.
//
//   npx tsx scripts/holding-period.mts | tee scripts/holding-period.log
//
import "dotenv/config";
import { loadPanel, FOLDS, type Fold } from "@/lib/research/panel";
import {
  sliceFold,
  withSignals,
  simulateFold,
  PANEL_SEED,
  type PanelExit,
} from "@/lib/research/panelRun";
import { LADDERS, MECHANISMS } from "@/lib/research/mechanisms";
import { computeEntrySignals, WARMUP, type EntrySignals } from "@/lib/backtest/engine";

const EXIT = LADDERS.flat; // the ladder every screen and hold-out in this repo ran
const SCREEN_FOLDS: Fold[] = [FOLDS.fit, FOLDS.select];
const DAY_MS = 86_400_000;

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

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

interface Cell {
  trades: number;
  avgR: number;
  /** calendar days between fill and exit; 1 = exited the session after entry */
  heldP25: number;
  heldMed: number;
  heldP75: number;
  heldMean: number;
  /** share of trades that closed the very next session — the "one gap is the trade" population */
  oneDayShare: number;
}

function runCell(panel: ReturnType<typeof loadPanel>, fold: Fold, rule: NonNullable<(typeof MECHANISMS)[number]["rule"]>, atOpen: boolean): Cell {
  const exit: PanelExit = { ...EXIT, entryAt: atOpen ? "open" : "close" };
  const prepared = withSignals(sliceFold(panel, fold), (_sym, candles) =>
    computeEntrySignals(candles, undefined, rule(candles)),
  ).map((p) => (atOpen ? { ...p, signals: shift1(p.signals) } : p));

  const run = simulateFold(prepared, fold, exit);
  const held: number[] = [];
  const rs: number[] = [];
  for (const t of run.trades) {
    const d = (t.closedAt.getTime() - t.openedAt.getTime()) / DAY_MS;
    if (Number.isFinite(d) && d >= 0) held.push(d);
    if (t.rMultiple != null && Number.isFinite(t.rMultiple)) rs.push(t.rMultiple);
  }
  held.sort((a, b) => a - b);
  return {
    trades: run.trades.length,
    avgR: mean(rs),
    heldP25: quantile(held, 0.25),
    heldMed: quantile(held, 0.5),
    heldP75: quantile(held, 0.75),
    heldMean: mean(held),
    oneDayShare: held.length ? held.filter((d) => d <= 1.5).length / held.length : NaN,
  };
}

async function main() {
  console.log("holding period and first-gap share, by mechanism — DIAGNOSTIC, not a verdict");
  console.log(`ladder=flat  seed=${PANEL_SEED}  WARMUP=${WARMUP}  folds: fit, select (deep folds untouched)`);
  console.log("held = calendar days from fill to exit; <=1.5d means the trade was over the next session");

  const panel = loadPanel();

  for (const mech of MECHANISMS) {
    if (!mech.rule) continue; // baseline is decideSetup(), not a rule closure
    if (mech.entryAt) continue; // gap-fade-open* already fix their own fill; not comparable here
    console.log(`\n${mech.key}`);
    console.log(`  ${mech.blurb}`);
    console.log(
      "    fold    fill     trades     avgR    held p25    med    p75   mean   <=1 session",
    );
    for (const fold of SCREEN_FOLDS) {
      const cells = { close: runCell(panel, fold, mech.rule, false), open: runCell(panel, fold, mech.rule, true) };
      for (const [label, c] of Object.entries(cells)) {
        console.log(
          `    ${fold.name.padEnd(8)}${label.padEnd(7)}${String(c.trades).padStart(7)}  ` +
            `${c.avgR.toFixed(3).padStart(7)}  ${c.heldP25.toFixed(1).padStart(8)}  ` +
            `${c.heldMed.toFixed(1).padStart(5)}  ${c.heldP75.toFixed(1).padStart(5)}  ` +
            `${c.heldMean.toFixed(1).padStart(5)}  ${(100 * c.oneDayShare).toFixed(1).padStart(8)}%`,
        );
      }
      const drop = cells.close.avgR - cells.open.avgR;
      const share = cells.close.avgR !== 0 ? drop / cells.close.avgR : NaN;
      console.log(
        `      -> first gap is worth ${drop.toFixed(4)}R = ${(100 * share).toFixed(0)}% of the close-fill avgR` +
          `   (median hold ${cells.close.heldMed.toFixed(1)}d)`,
      );
    }
  }

  console.log(`\nReading this: the last line of each fold is the filter the mechanism search needs.`);
  console.log(`A candidate whose first gap is most of its avgR cannot be traded from Thailand,`);
  console.log(`however good its close-fill number looks. avgR here carries NO control and is`);
  console.log(`not evidence of edge — only the close-vs-open DIFFERENCE is being read.`);
}

await main();
