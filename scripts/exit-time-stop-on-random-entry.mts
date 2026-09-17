// Can a bar-count TIME STOP alone manufacture edge out of an entry with ZERO
// informational content — the one exit-geometry class exit-on-random-entry.mts
// could not test?
//
// WHY THIS EXISTS
//
// exit-on-random-entry.mts (2026-09-14) fixed entries at exactly zero
// information and swept all 6 LADDER_OPTIONS geometries. Primary bar: all 6
// "pass" (control p5 > 0 in both fit and select). Mandatory long/short
// diagnostic: all 6 FAIL — every geometry's control is strongly positive
// long-only and strongly negative short-only in every fold, the signature of
// long-side drift wearing an exit-geometry costume
// (nexmind-regime-side-is-beta), not a management discovery. That script's own
// closing text named the gap: "it does not close exit research outright
// (untested geometries, e.g. a bar-count time stop, are not expressible by
// PanelExit yet)".
//
// PanelExit.maxBars now exists (this session's engine change,
// SimPosition.barsHeld / ExitOptions.maxBars in backtest/engine.ts). Its
// mechanic matters to this script's design: the time stop is checked ONLY
// when the bar's action is "hold" —
//
//   if (action.kind === "hold" && pos.maxBars != null && pos.barsHeld >= pos.maxBars)
//
// i.e. it is a backstop layered ON TOP of whatever SL/TP/trail logic already
// ran and found no trigger, never a standalone geometry. So every value swept
// here is applied atop BASELINE_EXIT (the flat single 1.5/1.5 ladder — the
// same "exit the desk would have used anyway" both prior exit scripts used as
// their baseline), not tested bare with no TP/SL. A trade still closes early
// on either a normal SL/TP touch OR the clock, whichever comes first.
//
// PRE-REGISTRATION (fixed before the first run; not edited afterwards)
//
// HYPOTHESIS. At least one value of maxBars in {1, 2, 3, 5, 8, 13, 21, 34}
// (managed bars, layered atop BASELINE_EXIT), run on matched-random entries
// (not on any named mechanism), has a random-control avgR whose 5th
// percentile across 200 independent random draws is positive in BOTH fit and
// select. The value set is fixed in advance: a short end dense enough to
// resolve whether truncating the hold well before a 1.5-ATR target is
// normally reached changes anything (1-5 bars), a middle stretch spanning one
// to several weeks (8, 13, 21), and a long end (34 bars, ~7 weeks) chosen to
// sit close to where the time stop should rarely bind at all — at large
// maxBars this geometry converges to bare BASELINE_EXIT, i.e. exactly the
// "single 1.5/1.5" row exit-on-random-entry.mts already measured and found to
// FAIL the diagnostic. That convergence is a built-in continuity check on
// this script's own harness, not a new finding at the long end.
//
// This is the same DIFFERENT statistic exit-on-random-entry.mts used, not the
// usual one in this repo. Elsewhere the question is "does the RULE beat its
// control's p95" — here there is no rule, and the question is "is the CONTROL
// ITSELF reliably above zero". p5 (not p95, not the median) is the
// pre-registered bar: one bad-luck placement in twenty should still make
// money, or the geometry has not shown a reliable effect, only a lucky one.
//
// POPULATION. matchedRandomSignals seeded from decideSetup()'s own signal
// count and long/short mix (the same template runControl uses everywhere else
// in this repo), identical construction to exit-on-random-entry.mts. ATRs
// pass through untouched, so every geometry sizes its stop off the real
// volatility of the bar it lands on.
//
// FOLDS. fit and select ONLY, at DEFAULT_COST_MODEL, daily bars, close fill —
// same convention as exit-on-random-entry.mts. TEST1-3 and DEEP1-3 are not
// read. A maxBars value that clears fit and select is a SCREENING candidate,
// nothing more.
//
// SECONDARY, DIAGNOSTIC CHECK (not a pass/fail bar): for any maxBars value
// that clears the primary bar, the same random population is rebuilt
// long-only and short-only (same total count, forced side) and re-measured.
// A genuine time-stop effect should be visible, even if smaller, on the SHORT
// side too; an effect that is long-only IS the beta
// nexmind-regime-side-is-beta.md already named, wearing a time-stop costume,
// not a new finding.
//
// WHAT THIS CANNOT SHOW. Even a clean pass here is not a strategy — it would
// say a specific hold-length cap, applied to noise atop the flat ladder, nets
// positive on THIS universe's own long-run drift. Turning that into something
// tradeable still needs an entry (nexmind-broker-webull-whole-shares: ~5
// whole-share slots at $2-3k capital cannot take every eligible bar on every
// symbol). That is a separate, later question.
//
//   npx tsx scripts/exit-time-stop-on-random-entry.mts | tee scripts/exit-time-stop-on-random-entry.log
//
import "dotenv/config";
import { loadPanel, FOLDS, type Fold } from "@/lib/research/panel";
import {
  prepareFold, simulateFold, runControl, CONTROL_RUNS, PANEL_SEED, BASELINE_EXIT,
  type PreparedSymbol, type PanelExit,
} from "@/lib/research/panelRun";
import { computeEntrySignals, DEFAULT_COST_MODEL } from "@/lib/backtest/engine";
import { percentile } from "@/lib/research/control";

const SCREEN_FOLDS: Fold[] = [FOLDS.fit, FOLDS.select];
const MAXBARS_VALUES: number[] = [1, 2, 3, 5, 8, 13, 21, 34];

const label = (maxBars: number) => `maxBars=${maxBars}`;

const fmt = (x: number | null | undefined, w = 8) =>
  x == null || !Number.isFinite(x) ? "—".padStart(w) : `${x >= 0 ? "+" : ""}${x.toFixed(3)}`.padStart(w);

/** Force every real signal to one side, keeping the count identical, before handing it to runControl's own shuffle. */
function forcedSide(prepared: PreparedSymbol[], side: "long" | "short"): PreparedSymbol[] {
  return prepared.map((p) => ({
    ...p,
    signals: { sides: p.signals.sides.map((s) => (s ? side : s)), atrs: p.signals.atrs },
  }));
}

async function main() {
  console.log("bar-count time stop atop BASELINE_EXIT on matched-random entries — fit + select only, daily bars, close fill");
  console.log("PRE-REGISTERED: see this script's header. Nothing here may be approved.\n");

  const panel = loadPanel();
  console.log(`panel ${panel.cachePath} — ${panel.symbols.length} symbols, fetchedAt ${panel.fetchedAt}`);
  console.log(`maxBars sweep: {${MAXBARS_VALUES.join(", ")}}  atop BASELINE_EXIT (${BASELINE_EXIT.tp1Mult}/${BASELINE_EXIT.slMult})  control=${CONTROL_RUNS} runs  seed=${PANEL_SEED}  costs=DEFAULT_COST_MODEL\n`);

  const prepared: Record<string, PreparedSymbol[]> = {};
  for (const fold of SCREEN_FOLDS) {
    prepared[fold.name] = prepareFold(panel, fold, (_sym, candles) => computeEntrySignals(candles));
  }

  const clearsBothFolds = new Set<number>();
  const perFoldPass: Record<string, Set<number>> = { fit: new Set(), select: new Set() };

  for (const fold of SCREEN_FOLDS) {
    const rows = prepared[fold.name];
    console.log(`${fold.name} (${fold.from}..${fold.to}, ${fold.regime})`);
    console.log(`  ${"geometry".padEnd(14)}${"real avgR".padStart(10)}${"ctrl p5".padStart(10)}${"ctrl med".padStart(10)}${"ctrl p95".padStart(10)}  verdict`);

    for (const maxBars of MAXBARS_VALUES) {
      const exit: PanelExit = { ...BASELINE_EXIT, maxBars, costs: DEFAULT_COST_MODEL };
      const real = simulateFold(rows, fold, exit).summary.avgR;
      const ctrl = runControl(rows, fold, exit, CONTROL_RUNS, PANEL_SEED);
      const p5 = ctrl ? percentile(ctrl.avgRs, 0.05) : null;
      const pass = p5 != null && Number.isFinite(p5) && p5 > 0;
      if (pass) perFoldPass[fold.name].add(maxBars);
      console.log(
        `  ${label(maxBars).padEnd(14)}${fmt(real)}${fmt(p5)}${fmt(ctrl?.median)}${fmt(ctrl?.p95)}  ${pass ? "RANDOM CLEARS ZERO" : "—"}`,
      );
    }
    console.log();
  }

  for (const maxBars of MAXBARS_VALUES) {
    if (perFoldPass.fit.has(maxBars) && perFoldPass.select.has(maxBars)) clearsBothFolds.add(maxBars);
  }

  console.log("=".repeat(100));
  console.log("PROMOTION BAR: matched-random control's p5 > 0 in BOTH fit and select.");
  if (!clearsBothFolds.size) {
    console.log("NO CANDIDATE. No maxBars value atop BASELINE_EXIT makes noise reliably profitable on this population/fold pair.");
    console.log("Per this script's header: this closes the bar-count time-stop class the same way exit-on-random-entry.mts");
    console.log("closed LADDER_OPTIONS — the ladder-and-target-and-time-stop exit family, applied to zero-information entries,");
    console.log("does not manufacture edge on this population. The remaining untried axis is the DATA CLASS behind the");
    console.log("entry itself, not another exit-geometry variant.");
  } else {
    console.log(`CANDIDATES: ${[...clearsBothFolds].map(label).join(", ")} — running the long-only / short-only diagnostic.\n`);
    for (const maxBars of clearsBothFolds) {
      const exit: PanelExit = { ...BASELINE_EXIT, maxBars, costs: DEFAULT_COST_MODEL };
      console.log(`${label(maxBars)}`);
      console.log(`  ${"fold".padEnd(8)}${"side".padStart(7)}${"ctrl p5".padStart(10)}${"ctrl med".padStart(10)}${"ctrl p95".padStart(10)}`);
      for (const fold of SCREEN_FOLDS) {
        for (const side of ["long", "short"] as const) {
          const rows = forcedSide(prepared[fold.name], side);
          const ctrl = runControl(rows, fold, exit, CONTROL_RUNS, PANEL_SEED);
          const p5 = ctrl ? percentile(ctrl.avgRs, 0.05) : null;
          console.log(`  ${fold.name.padEnd(8)}${side.padStart(7)}${fmt(p5)}${fmt(ctrl?.median)}${fmt(ctrl?.p95)}`);
        }
      }
      console.log();
    }
    console.log("Read the side-split narrowly: a candidate positive on BOTH sides is a mechanical effect of the");
    console.log("time stop; a candidate positive on longs only and flat/negative on shorts is long-side drift wearing");
    console.log("an exit-geometry costume (nexmind-regime-side-is-beta), not a management discovery.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
