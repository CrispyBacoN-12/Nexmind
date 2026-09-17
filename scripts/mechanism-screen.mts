// Do any of these entry mechanisms separate from the baseline at all?
//
// WHY THIS EXISTS
//
// Four families are now closed as rejected: trend-pullback continuation (the
// desk's own baseline, ~+0.04R/trade at t=1.08 OOS, i.e. indistinguishable from
// zero), Donchian/breakout, the 13 confluence vetoes, and cross-sectional mean
// reversion + momentum. The market-gate work then showed the baseline's fold
// avgR is {-0.003, -0.034, +0.010, -0.024, -0.014} and only reaches ~0 with the
// gate on. Running more research rounds inside that family is searching the
// same drawer harder. This searches a different drawer.
//
// It is a MEASUREMENT, not a strategy. Nothing here is written to the DB,
// nothing can be approved from it, and no threshold is fitted. Each mechanism is
// an EntryRule handed to the same computeEntrySignals/simulateExits pipeline the
// panel uses, so every number below is directly comparable to the baseline row
// printed alongside it.
//
// PRE-REGISTRATION (fixed before the first run; do not extend after reading)
//
// Six mechanisms, one exit ladder, five folds = SIX tests. Written down because
// the p95 control bar only means what it says if the number of shots is known.
// If a seventh idea occurs after seeing these numbers, it is a NEW screen with
// its own count, not a row appended to this one.
//
// Every trigger is self-normalising — ranked or compared against the symbol's
// OWN trailing window, never against an absolute number. That is the one lesson
// the regime work actually established: breadth and realized vol both died
// because FIT-derived cut points do not transfer to 2022, while SPY-vs-its-own-
// SMA200 survived 5/5 precisely because it has no free parameter. Any mechanism
// carrying a fitted constant would fail the same way, so none is included.
//
// The window lengths that DO appear (3-day streak, 7-bar range rank, 20-bar
// volume rank, SMA50 direction) are conventional values taken as-is from the
// literature the mechanism comes from. They are pre-registered, not swept. If
// one of these survives, the sweep happens afterwards on FIT only.
//
// HOW TO READ IT
//
// Read the FIT and SELECT columns. TEST1-3 are printed so the eventual verdict
// is auditable from one log, NOT as a menu — picking a mechanism because its
// TEST3 looks good is how the folds get spent, and it is the specific mistake
// that put research-29 on the desk.
//
// The bar is not "positive". On this universe 69-87% of names rose in every
// window, so a long-biased rule clears zero on beta alone; that is what
// --control exists for. The screen bar is SIGN CONSISTENCY across FIT and
// SELECT plus a margin over the baseline large enough to be worth the second
// stage. Expect most or all of these to fail. That is the screen working.
//
//   npx tsx scripts/mechanism-screen.mts
//   npx tsx scripts/mechanism-screen.mts --ladder=trail
//   npx tsx scripts/mechanism-screen.mts --control=200   (slow: second stage only)
//
// ADDENDUM 2026-08-26 — the gap-fade-open row, and why it is not a seventh test
//
// The six above were screened on two disjoint universes and only gap-fade passed
// both screening folds, on both panels, while still losing money
// (docs/quant/2026-08-26-broad-universe-rerun.md). Its known defect is not
// statistical: the rule detects a gap that happened at the OPEN and the engine
// filled it at the CLOSE, six and a half hours later.
//
// gap-fade-open is that same rule under a corrected fill. It is an IMPLEMENTATION
// test of an already-screened mechanism, not a new idea, so it does not consume
// a shot from the count above — but it does get its own pre-registration, fixed
// here before it was first run:
//
//   1. FIT ONLY decides whether this continues. select and test1-3 are printed
//      for the audit trail and must not be read as the result.
//   2. The comparison is gap-fade-open vs gap-fade IN THE SAME RUN, both against
//      their own matched controls. An open fill changes the control too, so
//      cross-run comparison of raw margins is meaningless.
//   3. It passes only if the FIT margin over its own control p95 EXCEEDS
//      gap-fade's +0.012. Merely staying positive is the null result: it would
//      mean the six-and-a-half-hour delay was never what was costing the rule,
//      and the whole thread closes.
//   4. If it passes, the next step is select, then test — not a parameter sweep.
//      The 1.2/1.5 ladder was never designed for a fade, but sweeping it before
//      the fill question is settled fits two things at once and settles neither.
//
// ADDENDUM 2026-09-05 — where the mechanisms went
//
// LADDERS and MECHANISMS now live in src/lib/research/mechanisms.ts, imported
// below rather than defined here. Nothing about them changed; they moved so that
// scripts/deep-holdout.mts can run the SAME objects over the pre-2016 folds
// instead of a copy that could drift. The numbers in
// scripts/mechanism-screen-control.log are unaffected and were re-verified
// against this file after the move.
//
import "dotenv/config";
import { loadPanel, FOLDS, type Fold, type FoldName } from "@/lib/research/panel";
import {
  sliceFold, withSignals, simulateFold, runControl, PANEL_SEED,
  type FoldSliceRow,
} from "@/lib/research/panelRun";
import { LADDERS, MECHANISMS, type Mechanism } from "@/lib/research/mechanisms";
import { computeEntrySignals, WARMUP } from "@/lib/backtest/engine";

const FOLD_ORDER: FoldName[] = ["fit", "select", "test1", "test2", "test3"];

// ---------------------------------------------------------------------------

interface Row {
  fold: Fold;
  trades: number;
  symbolsTraded: number;
  avgR: number | null;
  winRate: number;
  controlP95: number | null;
  /** the MEDIAN random run — "did it beat a coin flip at all", a much weaker
   *  question than the p95 pass bar, and a different claim. Both are printed
   *  because "failed the p95 bar" and "lost to random" get confused otherwise. */
  controlMed: number | null;
}

const fmt = (v: number | null, d = 3) => (v == null || !Number.isFinite(v) ? "     —" : v.toFixed(d).padStart(6));

function signOf(v: number | null): string {
  if (v == null) return "?";
  return v > 0 ? "+" : v < 0 ? "-" : "0";
}

function printRows(mech: Mechanism, rows: Row[]) {
  console.log(`\n${mech.key}`);
  console.log(`  ${mech.blurb}`);
  console.log("    fold      trades  symbols    avgR     win%   ctrl med  ctrl p95   margin");
  for (const r of rows) {
    const margin = r.avgR != null && r.controlP95 != null ? r.avgR - r.controlP95 : null;
    const beat = r.avgR != null && r.controlMed != null ? (r.avgR > r.controlMed ? "  beats-median" : "  LOSES-to-median") : "";
    console.log(
      `    ${r.fold.name.padEnd(8)} ${String(r.trades).padStart(7)} ${String(r.symbolsTraded).padStart(8)}  ` +
        `${fmt(r.avgR)}  ${(r.winRate).toFixed(1).padStart(5)}%  ${fmt(r.controlMed)}   ${fmt(r.controlP95)}   ${fmt(margin)}${beat}`,
    );
  }
  const fitSel = rows.filter((r) => r.fold.name === "fit" || r.fold.name === "select").map((r) => r.avgR);
  const all = rows.map((r) => r.avgR);
  console.log(
    `    signs fit/select ${fitSel.map(signOf).join("")}  ·  all five ${all.map(signOf).join("")}` +
      (fitSel.every((v) => v != null && v > 0) ? "  <- both screening folds positive" : ""),
  );
}

async function main() {
  const ladderKey = (process.argv.find((a) => a.startsWith("--ladder="))?.split("=")[1] ?? "flat").trim();
  const exit = LADDERS[ladderKey];
  if (!exit) {
    console.error(`unknown --ladder=${ladderKey}; expected one of: ${Object.keys(LADDERS).join(", ")}`);
    process.exit(1);
  }
  const controlRuns = Number(process.argv.find((a) => a.startsWith("--control="))?.split("=")[1] ?? 0);

  // Stage-two filters. Stage one runs everything on everything; the control is
  // ~N times the cost of a plain fold, so it is pointed only at what survived
  // the sign screen. These narrow WHAT IS RECOMPUTED, never how it is computed —
  // the folds, the ladder and PANEL_SEED are identical either way, so a filtered
  // row is bit-identical to the same row in a full run.
  const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
  const only = onlyArg ? new Set(onlyArg.split(",").map((s) => s.trim())) : null;
  const foldsArg = process.argv.find((a) => a.startsWith("--folds="))?.split("=")[1];
  const foldNames = foldsArg
    ? (foldsArg.split(",").map((s) => s.trim()) as FoldName[])
    : FOLD_ORDER;
  for (const n of foldNames) if (!FOLDS[n]) { console.error(`unknown fold ${n}`); process.exit(1); }
  const mechanisms = only ? MECHANISMS.filter((m) => only.has(m.key)) : MECHANISMS;
  if (!mechanisms.length) { console.error(`--only matched no mechanism`); process.exit(1); }

  // --panel points the whole screen at a different bar cache. The mechanisms,
  // folds, ladder and PANEL_SEED are untouched, so running the same --only set
  // against two panels is a controlled comparison of the UNIVERSE and nothing
  // else. That is the only reason this flag exists; it is not a way to shop for
  // a cache that makes a row pass. Whichever panel produced a number must be
  // quoted alongside it — `fetchedAt` and the symbol count are printed below
  // precisely so a pasted log identifies its own data.
  const panelPath = process.argv.find((a) => a.startsWith("--panel="))?.split("=")[1];
  console.log("loading panel cache…");
  const panel = panelPath ? loadPanel(panelPath) : loadPanel();
  console.log(`panel ${panel.cachePath} — ${panel.symbols.length} symbols, fetchedAt ${panel.fetchedAt}`);
  const dropped = Object.entries(panel.droppedBars).sort((a, b) => b[1] - a[1]);
  if (dropped.length) {
    const total = dropped.reduce((a, [, n]) => a + n, 0);
    console.log(
      `  dropped ${total} placeholder bar(s) (o==h==l==c, no volume) across ${dropped.length} symbol(s): ` +
        dropped.map(([sym, n]) => `${sym} ${n}`).join(", "),
    );
  }
  console.log(`ladder=${ladderKey} ${JSON.stringify(exit.trail ?? "no trail")}  control=${controlRuns || "off"}`);
  console.log(`WARMUP=${WARMUP} bars, ${mechanisms.length} mechanism row(s), folds: ${foldNames.join(", ")}`);

  // Slices are cut once and shared across every mechanism: slicing is per-fold
  // while signals are per-mechanism, and cutting them seven times would be seven
  // passes over 89MB for identical output.
  const slices: Record<FoldName, FoldSliceRow[]> = {} as Record<FoldName, FoldSliceRow[]>;
  for (const name of foldNames) {
    slices[name] = sliceFold(panel, FOLDS[name]);
    console.log(`  ${name}: ${slices[name].length} symbols participate`);
  }

  for (const mech of mechanisms) {
    const rows: Row[] = [];
    for (const name of foldNames) {
      const fold = FOLDS[name];
      const prepared = withSignals(slices[name], (_sym, candles) =>
        computeEntrySignals(candles, undefined, mech.rule ? mech.rule(candles) : undefined),
      );
      // The control gets the SAME exit object, so it fills where the rule fills.
      const mechExit = mech.entryAt ? { ...exit, entryAt: mech.entryAt } : exit;
      const run = simulateFold(prepared, fold, mechExit);
      let controlP95: number | null = null;
      let controlMed: number | null = null;
      if (controlRuns > 0) {
        const ctrl = runControl(prepared, fold, mechExit, controlRuns, PANEL_SEED);
        controlP95 = ctrl?.p95 ?? null;
        controlMed = ctrl?.median ?? null;
      }
      rows.push({
        fold,
        trades: run.trades.length,
        symbolsTraded: run.symbolsTraded,
        avgR: run.summary.avgR,
        winRate: run.summary.winRate,
        controlP95,
        controlMed,
      });
    }
    printRows(mech, rows);
  }

  console.log(
    "\nreminder: FIT and SELECT are the screening folds. The TEST columns are printed for the\n" +
      "audit trail — choosing a mechanism from them spends the only untouched data left.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
