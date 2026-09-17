// Can trade management alone manufacture edge out of an entry with ZERO
// informational content?
//
// WHY THIS EXISTS
//
// The OHLCV price-action ENTRY axis is closed on both bar classes: daily
// mr-down3 passed a deep hold-out but only at an unplaceable fill
// (nexmind-mr-down3-passed-holdout), and the weekly livable-fill version was
// REJECTED at the same deep hold-out (weekly-deep-holdout.log). Two prior
// scripts already asked whether EXIT geometry alone is worth anything:
//
//   - exit-control.mts / exit-control-holdout.log (2026-09-05): ATR trail
//     1.5/1.5 vs the flat 1.5/1.5 ladder, on the DESK'S OWN entries
//     (decideSetup). Zero candidates cleared the pre-registered bar (p5 > 0 on
//     BOTH fit and select) — the trail wins FIT and loses SELECT.
//
// Both of those measured an exit CHANGE on an entry already known to have
// NEGATIVE selection value (loses to random entry in 30/30 control cells,
// entry-lateness.log). That is a confound this script removes on purpose: if
// the entries themselves are actively anti-informative, a exit's apparent
// value on top of them says nothing about what the exit does to a NEUTRAL
// signal. This script holds entries at exactly zero information —
// matched-random, same count/side-mix/eligible bars as decideSetup() would
// have produced — and asks the question directly: does ANY exit geometry make
// pure noise entries reliably profitable?
//
// PRE-REGISTRATION (fixed before the first run; not edited afterwards)
//
// HYPOTHESIS. At least one geometry in LADDER_OPTIONS, run on matched-random
// entries (not on any named mechanism), has a random-control avgR whose 5th
// percentile across 200 independent random draws is positive in BOTH fit and
// select.
//
// This is a DIFFERENT statistic than every other control in this repo prints.
// Elsewhere the question is "does the RULE beat its control's p95" — here
// there is no rule, and the question is "is the CONTROL ITSELF reliably above
// zero". p5 (not p95, not the median) is the pre-registered bar: one bad-luck
// placement in twenty should still make money, or the geometry has not shown
// a reliable effect, only a lucky one.
//
// POPULATION. matchedRandomSignals seeded from decideSetup()'s own signal
// count and long/short mix (the same template runControl uses everywhere
// else in this repo) — chosen only because it is the one mechanism already
// computed as "baseline" in every panel script, not because its count/mix is
// special. ATRs pass through untouched, exactly as matchedRandomSignals
// always does, so every geometry sizes its stop off the real volatility of
// the bar it lands on.
//
// FOLDS. fit and select ONLY, at DEFAULT_COST_MODEL, daily bars, close fill —
// the same convention exit-control.mts already established for exit-only
// questions. TEST1-3 and DEEP1-3 are not read. A geometry that clears fit and
// select is a SCREENING candidate, nothing more: reading TEST before spending
// DEEP is the same promotion bar every other script in this repo follows.
//
// SECONDARY, DIAGNOSTIC CHECK (not a pass/fail bar): for any geometry that
// clears the primary bar, the same random population is rebuilt long-only and
// short-only (same total count, forced side) and re-measured. On this
// universe 69-87% of names rise in any given window (control.ts), so a
// TRAIL — which lets a winner run and cuts a loser early — can look like "the
// exit found edge" while actually just harvesting long-side drift. A
// mechanical effect should be visible, even if smaller, on the SHORT side
// too; an effect that is long-only IS the beta nexmind-regime-side-is-beta.md
// already named, wearing an exit-geometry costume, not a new finding.
//
// WHAT THIS CANNOT SHOW. Even a clean pass here is not a strategy — it would
// say a specific exit geometry, applied to noise, nets positive on THIS
// universe's own long-run drift. Turning that into something tradeable still
// needs an entry (if only to decide which of ~500 eligible names gets one of
// a handful of capital slots — an entry that fires on every eligible bar for
// every symbol is not implementable at 5 whole-share slots,
// nexmind-broker-webull-whole-shares). That is a separate, later question.
//
//   npx tsx scripts/exit-on-random-entry.mts | tee scripts/exit-on-random-entry.log
//
import "dotenv/config";
import { loadPanel, FOLDS, type Fold } from "@/lib/research/panel";
import {
  prepareFold, simulateFold, runControl, CONTROL_RUNS, PANEL_SEED,
  type PreparedSymbol, type PanelExit,
} from "@/lib/research/panelRun";
import { LADDER_OPTIONS, type ExitLadder } from "@/lib/research/runResearch";
import { computeEntrySignals, DEFAULT_COST_MODEL } from "@/lib/backtest/engine";
import { percentile } from "@/lib/research/control";

const SCREEN_FOLDS: Fold[] = [FOLDS.fit, FOLDS.select];

const label = (g: ExitLadder) =>
  g.trail ? `trail ${g.trail.activateMult}/${g.trail.offsetMult}` : `single ${g.tp1Mult}/${g.slMult}`;

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
  console.log("exit geometry on matched-random entries — fit + select only, daily bars, close fill");
  console.log("PRE-REGISTERED: see this script's header. Nothing here may be approved.\n");

  const panel = loadPanel();
  console.log(`panel ${panel.cachePath} — ${panel.symbols.length} symbols, fetchedAt ${panel.fetchedAt}`);
  console.log(`ladder: ${LADDER_OPTIONS.length} geometries  control=${CONTROL_RUNS} runs  seed=${PANEL_SEED}  costs=DEFAULT_COST_MODEL\n`);

  const prepared: Record<string, PreparedSymbol[]> = {};
  for (const fold of SCREEN_FOLDS) {
    prepared[fold.name] = prepareFold(panel, fold, (_sym, candles) => computeEntrySignals(candles));
  }

  const clearsBothFolds = new Set<string>();
  const perFoldPass: Record<string, Set<string>> = { fit: new Set(), select: new Set() };

  for (const fold of SCREEN_FOLDS) {
    const rows = prepared[fold.name];
    console.log(`${fold.name} (${fold.from}..${fold.to}, ${fold.regime})`);
    console.log(`  ${"geometry".padEnd(16)}${"real avgR".padStart(10)}${"ctrl p5".padStart(10)}${"ctrl med".padStart(10)}${"ctrl p95".padStart(10)}  verdict`);

    for (const geo of LADDER_OPTIONS) {
      const exit: PanelExit = { ...geo, costs: DEFAULT_COST_MODEL };
      const real = simulateFold(rows, fold, exit).summary.avgR;
      const ctrl = runControl(rows, fold, exit, CONTROL_RUNS, PANEL_SEED);
      const p5 = ctrl ? percentile(ctrl.avgRs, 0.05) : null;
      const pass = p5 != null && Number.isFinite(p5) && p5 > 0;
      if (pass) perFoldPass[fold.name].add(label(geo));
      console.log(
        `  ${label(geo).padEnd(16)}${fmt(real)}${fmt(p5)}${fmt(ctrl?.median)}${fmt(ctrl?.p95)}  ${pass ? "RANDOM CLEARS ZERO" : "—"}`,
      );
    }
    console.log();
  }

  for (const g of LADDER_OPTIONS) {
    if (perFoldPass.fit.has(label(g)) && perFoldPass.select.has(label(g))) clearsBothFolds.add(label(g));
  }

  console.log("=".repeat(100));
  console.log("PROMOTION BAR: matched-random control's p5 > 0 in BOTH fit and select.");
  if (!clearsBothFolds.size) {
    console.log("NO CANDIDATE. No exit geometry makes noise reliably profitable on this population/fold pair.");
    console.log("Per this script's header: this closes the general 'exit alone rescues any entry' hypothesis");
    console.log("for LADDER_OPTIONS on this panel; it does not close exit research outright (untested geometries,");
    console.log("e.g. a bar-count time stop, are not expressible by PanelExit yet).");
  } else {
    console.log(`CANDIDATES: ${[...clearsBothFolds].join(", ")} — running the long-only / short-only diagnostic.\n`);
    for (const gLabel of clearsBothFolds) {
      const geo = LADDER_OPTIONS.find((g) => label(g) === gLabel)!;
      const exit: PanelExit = { ...geo, costs: DEFAULT_COST_MODEL };
      console.log(`${gLabel}`);
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
    console.log("geometry; a candidate positive on longs only and flat/negative on shorts is long-side drift wearing");
    console.log("an exit-geometry costume (nexmind-regime-side-is-beta), not a management discovery.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
