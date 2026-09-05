// Which exit geometries beat the exit we would have used anyway?
//
// This is the first script that can ask that question. Until now the panel gate
// had exactly one null — runControl, which shuffles the ENTRIES and holds the
// exit fixed. That is the correct null for an entry claim and useless for an
// exit one: change the geometry and both arms move together, so the margin
// barely responds and the difference the change actually made is invisible. The
// consequence on record is that the ATR trail 1.5/1.5 — the only geometry in
// this repo with a real out-of-sample pedigree — could not have been approved by
// the gate that was supposed to approve it.
//
// runExitControl is the missing null: same entries, baseline ladder, and a
// PAIRED monthly block bootstrap around the candidate-minus-baseline difference.
// Paired because both arms trade the same signals in the same months, so their
// per-month errors are strongly correlated (March 2020 is a bad month for every
// ladder). Resampling a month resamples it in BOTH arms at once, so the shared
// market component cancels inside every resample and what is left is the
// geometry. Two independent bootstraps would charge that shared variance to the
// difference twice and could not resolve an effect of the size sought here.
//
// PRE-REGISTERED, written before any fold was run.
//
// Candidates: every LADDER_OPTIONS entry except the baseline itself — the three
// wider single targets and the two ATR trails. Nothing invented for this script;
// these are the geometries the refinement loop can already pick, and the trail
// 1.5/1.5 is the one the desk trades today.
//
// Entries: the desk's live rule at DEFAULT_THRESHOLDS, held fixed across every
// row. The entry is known to be bad — it loses to a matched random entry in
// 30/30 cells — and that is deliberately not this script's question. A better
// exit on a negative-value entry is still a negative-value strategy; what is
// being measured is whether the geometry itself is an improvement, which is a
// separate claim needing a separate null.
//
// Metric: p5 of the resampled delta, the bar exitFoldVerdict applies. One-sided
// at 5%, the same level the entry gate asks of the control's p95 — so "beat the
// control" means the same strength of evidence on either axis. The point
// estimate and both arms' avgR print alongside, because a delta whose interval
// straddles zero is a number with no claim attached and should be readable as
// such.
//
// Selection rule, fixed in advance. A geometry is a candidate only if p5 > 0 on
// BOTH selection folds — FIT and SELECT. TEST1/TEST2/TEST3 print only under
// --holdout and are to be read after the candidate list is written down.
// Nothing here is an approval: the panel gate is the approver.
//
// RESULT of the selection run (scripts/exit-control.log, 2026-09-05):
// ZERO candidates. Both ATR trails clear FIT decisively — delta +0.045 and
// +0.046 with p5 +0.024 and +0.019, an interval well clear of zero — and both
// fail SELECT, where every geometry including the baseline is negative and the
// trails' deltas are −0.015 with p5 around −0.05. The three wider single targets
// fail both folds; their deltas grow with tp1Mult on FIT and shrink with it on
// SELECT, which is the shape of a target fitted to a rising market rather than a
// property of the geometry.
//
// So the first honest reading of the ATR trail is: it beats the 1.5/1.5 ladder
// in a three-year trending fold and does not in a one-year melt-up, and the
// pre-registered rule requires both. Two things about SELECT are worth stating
// rather than explaining away: it is a single year, so the paired sample is ~12
// monthly blocks against FIT's ~36, and it is the fold where the entry itself is
// worst. Neither is a reason to relax the rule — they are reasons the rule
// exists — but they do mean SELECT's failure is the weaker of the two readings.
//
// The holdout below is run with an EMPTY candidate list, to finish the trail's
// record honestly rather than because the hypothesis survived. Whatever it says
// changes nothing about the selection: no geometry passed.
//
// RESULT of the holdout run (scripts/exit-control-holdout.log, same day):
// the trails replicate and the wider single targets do not. `trail 1/1.5` has a
// POSITIVE delta in all five folds (+0.045 / −0.015 / +0.047 / +0.034 / +0.047)
// and clears p5 > 0 in four of them, failing only SELECT. `trail 1.5/1.5` — the
// geometry the desk trades — is positive in four and passes three, failing
// SELECT and TEST2. The three single targets pass nothing: on FIT and TEST1
// their delta GROWS with tp1Mult, on SELECT and TEST2 it SHRINKS with tp1Mult,
// and a parameter whose sign depends on the fold is a fit, not a mechanism.
//
// Read narrowly, which is all this instrument permits: replacing the 1.5/1.5
// ladder with an ATR trail is worth roughly +0.04R per trade against that
// ladder, on these entries, in four of five folds. It is NOT evidence the
// strategy makes money — the baseline entry loses to a matched random entry in
// 30/30 cells, and TEST2's trail arm is +0.003R absolute. A better exit on a
// negative-value entry is a smaller loss.
//
// The one crossing that deserves following up: `trail 1/1.5` beats `trail
// 1.5/1.5` on the fold where the desk's own geometry fails (TEST2, +0.034 with
// p5 +0.004 against +0.015 with p5 −0.017), and activating the trail earlier is
// the same direction the entry work already pointed — the loss lives in waiting.
// That is a hypothesis for a pre-registered run, not a conclusion from this one.
//
//   npx tsx scripts/exit-control.mts              # FIT + SELECT (selection)
//   npx tsx scripts/exit-control.mts --holdout    # the three held-out folds
//
import "dotenv/config";
import { loadPanel, FOLDS } from "@/lib/research/panel";
import {
  sliceFold, runExitControl, sameGeometry, BASELINE_EXIT, PANEL_LOT,
  type ExitGeometry, type PanelExit, type PreparedSymbol,
} from "@/lib/research/panelRun";
import { LADDER_OPTIONS } from "@/lib/research/runResearch";
import { computeEntrySignals, DEFAULT_COST_MODEL } from "@/lib/backtest/engine";

const holdout = process.argv.includes("--holdout");
const runs = Number(process.argv.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 1000);

// --holdout runs ONLY the held-out folds. FIT and SELECT are not re-run: their
// numbers are already in the selection log, and reprinting all five together
// invites reading them as one table, which is what the split exists to prevent.
const FOLD_LIST = holdout ? [FOLDS.test1, FOLDS.test2, FOLDS.test3] : [FOLDS.fit, FOLDS.select];

const label = (g: ExitGeometry) =>
  g.trail ? `trail ${g.trail.activateMult}/${g.trail.offsetMult}` : `single ${g.tp1Mult}/${g.slMult}`;

// The baseline is excluded rather than filtered out silently: exitFoldVerdict
// treats a geometry compared against itself as a caller error, not a verdict,
// and a row of zeroes in this table would read as a measurement.
const CANDIDATES: ExitGeometry[] = LADDER_OPTIONS.filter((g) => !sameGeometry(g, BASELINE_EXIT));

const fmt = (x: number, w = 8) => `${x >= 0 ? "+" : ""}${x.toFixed(3)}`.padStart(w);

async function main() {
  const panel = await loadPanel();
  console.log(`panel: ${panel.symbols.length} symbols · ${runs} paired resamples per cell`);
  console.log(`baseline (null): ${label(BASELINE_EXIT)} — REFINEMENT_LADDER, the geometry every refinement round already runs under`);
  console.log(holdout
    ? `folds: TEST1/TEST2/TEST3 — held out. Read only after the candidate list is written down.\n`
    : `folds: FIT + SELECT only (selection). Re-run with --holdout once the candidates are chosen.\n`);

  for (const fold of FOLD_LIST) {
    const slices = sliceFold(panel, fold);
    // Paid once per fold: every geometry below trades the SAME entry signals.
    // That is what makes this a control rather than six separate strategies.
    const prepared: PreparedSymbol[] = slices.map((s) => ({ ...s, signals: computeEntrySignals(s.candles) }));

    console.log(`${fold.name} (${fold.from}..${fold.to}, ${fold.regime})`);
    console.log(`  ${"geometry".padEnd(16)}${"trades".padStart(8)}${"base tr".padStart(9)}${"avgR".padStart(9)}${"base".padStart(9)}${"delta".padStart(9)}${"p5".padStart(9)}${"p95".padStart(9)}  verdict`);

    for (const geo of CANDIDATES) {
      const exit: PanelExit = { ...geo, lot: PANEL_LOT, costs: DEFAULT_COST_MODEL };
      const cmp = runExitControl(prepared, fold, exit, BASELINE_EXIT, { bootstrapRuns: runs });
      const p = cmp.paired;
      if (!p) {
        console.log(`  ${label(geo).padEnd(16)}${String(cmp.candidate.summary.trades).padStart(8)}${String(cmp.baseline.summary.trades).padStart(9)}${"—".padStart(9)}  unverified (fewer than two shared months)`);
        continue;
      }
      console.log(
        `  ${label(geo).padEnd(16)}` +
        `${String(cmp.candidate.summary.trades).padStart(8)}${String(cmp.baseline.summary.trades).padStart(9)}` +
        `${fmt(p.candidateAvgR, 9)}${fmt(p.baselineAvgR, 9)}${fmt(p.delta, 9)}${fmt(p.p5, 9)}${fmt(p.p95, 9)}` +
        `  ${cmp.verdict.passed ? "PASS" : "fail"}${p.blocks < 12 ? ` (${p.blocks} shared months)` : ""}`,
      );
      // The floors are the reason a verdict can fail while the delta looks fine.
      // Printing them only when they bite keeps the table readable without
      // hiding why a row did not pass.
      for (const r of cmp.verdict.reasons.filter((r) => r.includes("arm"))) console.log(`      ${r}`);
    }
    console.log();
  }

  console.log(`How to read this
  - "delta" is candidate avgR minus baseline avgR over the months BOTH arms
    traded. The arms do not hold identical trades — one position per symbol means
    a longer-held geometry skips signals a shorter one takes — so months only one
    arm was in are excluded; including them would let arm composition drive the
    number instead of the exit.
  - "p5" is the bar. A positive delta with p5 below zero means the difference did
    not survive resampling whole months, which is the failure mode this control
    exists to catch: an exit that looks better because the market was.
  - "base" is the SAME baseline ladder in every row of a fold, so the rows are
    comparable to each other as well as to the null.
  - PASS says only that this geometry beats the ladder we would have used anyway
    on these entries. It says nothing about whether the entries are worth taking,
    and the baseline entry loses to a matched random entry in every fold measured.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
