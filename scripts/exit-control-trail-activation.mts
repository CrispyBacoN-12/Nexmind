// Does activating the ATR trail EARLIER beat the two activation points already
// on the menu?
//
// Follow-up to scripts/exit-control.mts, not a new instrument. That script's
// own header flagged this exact hypothesis after its holdout run: `trail
// 1/1.5` beats `trail 1.5/1.5` on TEST2 — the one fold where the desk's own
// live geometry (1.5/1.5) fails — and earlier trail activation is the same
// direction the entry-lateness work already pointed (the loss lives in
// waiting, not in the setup). That was written down as "a hypothesis for a
// pre-registered run, not a conclusion from this one." This is that run.
//
// PRE-REGISTERED, written before any fold was run.
//
// Candidates: activateMult in {0.25, 0.5, 0.75}, offsetMult held at 1.5 —
// the same offset both existing trails already use, so only activation
// timing varies and nothing else does. 0.25 and 0.5 sit below either existing
// trail; 0.75 sits between them. Nothing above 1.0 is tested here: LADDER_
// TRAILS already covers 1.0 and 1.5, and this script exists to fill the gap
// below them, not to re-run what exit-control.mts already logged.
//
// Baseline (null): BASELINE_EXIT, same as exit-control.mts — the 1.5/1.5
// single-target ladder every refinement round already runs under. This is
// deliberately NOT `trail 1/1.5` or `trail 1.5/1.5`: comparing a new trail
// against another trail would answer "is this trail better than that trail",
// not "does this clear the bar every exit change is held to."
//
// Entries and method: identical to exit-control.mts — the desk's live rule at
// DEFAULT_THRESHOLDS held fixed, runExitControl's paired monthly block
// bootstrap on the candidate-minus-baseline delta, same PANEL_SEED. Cost
// model is DEFAULT_COST_MODEL, matching exit-control.mts exactly rather than
// the equities-calibrated RESEARCH_COST_MODEL research now decides on
// (runResearch.ts, 2026-09-14) — a deliberate choice: the point of this run
// is to sit in the same table as exit-control.log and exit-control-holdout.log,
// and mixing cost models would make "beats trail 1/1.5" unanswerable from the
// two logs together.
//
// Selection rule, fixed in advance, identical to exit-control.mts: a geometry
// is a candidate only if p5 > 0 on BOTH FIT and SELECT. TEST1/TEST2/TEST3
// print only under --holdout, read after the candidate list is written down.
// Nothing here is an approval: the panel gate is the approver.
//
//   npx tsx scripts/exit-control-trail-activation.mts              # FIT + SELECT
//   npx tsx scripts/exit-control-trail-activation.mts --holdout    # held-out folds
//
import "dotenv/config";
import { loadPanel, FOLDS } from "@/lib/research/panel";
import {
  sliceFold, runExitControl, BASELINE_EXIT, PANEL_LOT,
  type ExitGeometry, type PanelExit, type PreparedSymbol,
} from "@/lib/research/panelRun";
import { computeEntrySignals, DEFAULT_COST_MODEL } from "@/lib/backtest/engine";

const holdout = process.argv.includes("--holdout");
const runs = Number(process.argv.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 1000);

// Same split as exit-control.mts, same reason: reprinting selection and
// holdout together invites reading them as one table.
const FOLD_LIST = holdout ? [FOLDS.test1, FOLDS.test2, FOLDS.test3] : [FOLDS.fit, FOLDS.select];

const TRAIL_OFFSET = 1.5;
const ACTIVATE_MULTS = [0.25, 0.5, 0.75];
const TRAIL_NOMINAL_TP_MULT = 2.5; // matches runResearch.ts's TRAIL_NOMINAL_TP_MULT — a trail has no fixed target

const CANDIDATES: ExitGeometry[] = ACTIVATE_MULTS.map((activateMult) => ({
  tp1Mult: TRAIL_NOMINAL_TP_MULT,
  slMult: BASELINE_EXIT.slMult,
  singleTarget: true,
  trail: { activateMult, offsetMult: TRAIL_OFFSET },
}));

const label = (g: ExitGeometry) =>
  g.trail ? `trail ${g.trail.activateMult}/${g.trail.offsetMult}` : `single ${g.tp1Mult}/${g.slMult}`;

const fmt = (x: number, w = 8) => `${x >= 0 ? "+" : ""}${x.toFixed(3)}`.padStart(w);

async function main() {
  const panel = await loadPanel();
  console.log(`panel: ${panel.symbols.length} symbols · ${runs} paired resamples per cell`);
  console.log(`baseline (null): ${label(BASELINE_EXIT)} — same baseline as exit-control.mts`);
  console.log(`candidates: earlier trail activation only — offset fixed at ${TRAIL_OFFSET}, activateMult in {${ACTIVATE_MULTS.join(", ")}}`);
  console.log(holdout
    ? `folds: TEST1/TEST2/TEST3 — held out. Read only after the candidate list is written down.\n`
    : `folds: FIT + SELECT only (selection). Re-run with --holdout once the candidates are chosen.\n`);

  for (const fold of FOLD_LIST) {
    const slices = sliceFold(panel, fold);
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
      for (const r of cmp.verdict.reasons.filter((r) => r.includes("arm"))) console.log(`      ${r}`);
    }
    console.log();
  }

  console.log(`How to read this
  - Same instrument as exit-control.mts: "delta" is candidate avgR minus
    baseline avgR over the months BOTH arms traded, "p5" is the bar (must
    clear zero), "base" is BASELINE_EXIT in every row.
  - This table answers one question only: does activating the trail before
    1.0 ATR beat the 1.5/1.5 single-target ladder. It does NOT compare these
    candidates against trail 1/1.5 or trail 1.5/1.5 directly — read
    scripts/exit-control.log and scripts/exit-control-holdout.log
    side by side against this file's log for that.
  - PASS says only that this geometry beats the ladder we would have used
    anyway on these entries. It says nothing about whether the entries are
    worth taking, and the baseline entry loses to a matched random entry in
    every fold measured.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
