// What does the same-bar-close fill, and the inherited MT5-gold cost model, cost
// the baseline rule's measured edge?
//
// WHY THIS EXISTS
//
// Two assumptions in src/lib/backtest/engine.ts were inherited rather than
// derived for the current instrument:
//
//   1. FILL TIMING. decideSetup reads bar i's close and simulateExits fills at
//      bar i's close. That is decidable only as an MOC order priced off a print
//      that has not happened yet. HKUDS/Vibe-Trading's engine refuses this by
//      construction — it fills every order at the NEXT bar's open, and says so
//      (agent/backtest/engines/base.py, historical_base_price).
//   2. COSTS. DEFAULT_COST_MODEL is 0.5bps slippage + 1bp commission and its
//      comment says it was calibrated to an MT5 Raw/ECN GOLD account. The desk
//      trades US equities on Webull. Vibe-Trading's global_equity.py assumes
//      slippage_us = 5bps, ten times higher.
//
// Next-bar-open is built WITHOUT touching the engine: shift the signal array
// right by one bar and fill with entryAt "open". engine.ts then sizes the stop
// off atrs[i-1] — which after the shift is the SIGNAL bar's ATR, known at the
// time the decision was made — and manages the entry bar, both of which are
// exactly what a next-open fill requires.
//
// Every cell is read against its OWN matched control, because changing the fill
// changes the control too; raw avgR across cells is not comparable, the MARGIN is.
//
// Controls run at 100 draws, not the gate's 200. This is a diagnostic; no
// candidate is being approved from it and no number here is a verdict.
//
//   npx tsx scripts/probe-fill-and-costs.mts
import "dotenv/config";
import { loadPanel, FOLDS, type FoldName } from "@/lib/research/panel";
import {
  sliceFold, withSignals, simulateFold, runControl, BASELINE_EXIT, PANEL_SEED,
  type PreparedSymbol, type PanelExit,
} from "@/lib/research/panelRun";
import { computeEntrySignals, type EntrySignals, type CostModel } from "@/lib/backtest/engine";

const CONTROL_DRAWS = 100;
const ALL: FoldName[] = ["fit", "select", "test1", "test2", "test3"];

/** Push every signal one bar later, so a close-derived decision fills at the next open. */
const shift1 = (s: EntrySignals): EntrySignals => {
  const sides: EntrySignals["sides"] = new Array(s.sides.length).fill(null);
  for (let i = 0; i + 1 < s.sides.length; i++) sides[i + 1] = s.sides[i];
  return { sides, atrs: s.atrs };
};

const panel = await loadPanel();
const base: Record<string, PreparedSymbol[]> = {};
for (const f of ALL) {
  base[f] = withSignals(sliceFold(panel, FOLDS[f]), (_s, c) => computeEntrySignals(c));
  console.log(`template ${f}: ${base[f].length} symbols`);
}
const shifted: Record<string, PreparedSymbol[]> = Object.fromEntries(
  ALL.map((f) => [f, base[f].map((p) => ({ ...p, signals: shift1(p.signals) }))]),
);

const COSTS: { label: string; costs: CostModel }[] = [
  { label: "0.5bps (current DEFAULT_COST_MODEL)", costs: { slippageBps: 0.5, commissionBps: 1 } },
  { label: "5bps (Vibe-Trading slippage_us)", costs: { slippageBps: 5, commissionBps: 1 } },
];
const FILLS: { label: string; prep: Record<string, PreparedSymbol[]>; entryAt: PanelExit["entryAt"] }[] = [
  { label: "same-bar close (current)", prep: base, entryAt: "close" },
  { label: "next-bar open", prep: shifted, entryAt: "open" },
];

for (const fill of FILLS) {
  for (const c of COSTS) {
    const exit: PanelExit = { ...BASELINE_EXIT, costs: c.costs, entryAt: fill.entryAt };
    console.log("");
    console.log(`### fill=${fill.label}  costs=${c.label}`);
    console.log(`fold     trades   avgR      ctrl p95   margin`);
    for (const f of ALL) {
      const run = simulateFold(fill.prep[f], FOLDS[f], exit);
      const ctrl = runControl(fill.prep[f], FOLDS[f], exit, CONTROL_DRAWS, PANEL_SEED);
      const avgR = run.summary.avgR;
      const margin = avgR != null && ctrl ? avgR - ctrl.p95 : null;
      console.log(
        `${f.padEnd(9)}${String(run.trades.length).padStart(6)}   ` +
          `${(avgR ?? NaN).toFixed(4).padStart(8)}  ${(ctrl?.p95 ?? NaN).toFixed(4).padStart(9)}  ` +
          `${(margin ?? NaN).toFixed(4).padStart(8)}`,
      );
    }
  }
}
