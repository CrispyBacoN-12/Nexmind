// Can the rule fire EARLIER on the same setups — causally?
//
// The two results this sits between:
//   entry-lateness.log   replaying the same signals 3 bars earlier flips the
//                        matched-control margin positive in 5/5 folds. That is
//                        lookahead: it needs to know a signal will occur.
//   entry-lag-variants   8 pre-registered gate RELAXATIONS, margin negative in
//                        all 10 cells. A relaxation admits a NEW POPULATION and
//                        lifts the control median with it; the lateness gain came
//                        from moving the SAME trades. Different claims.
//
// So the open question is the one neither run tested: a rule that fires before
// the baseline does, on the bars the baseline is ABOUT to fire on, decided with
// information available at that bar. Not "drop the gate" — "fire while the gate
// is still failing but is closing on its threshold".
//
// entry-gate-lag.log names the gate to anticipate: at the bar before an onset
// the RSI band is the sole refusing gate in 53-58% of onsets in all five folds,
// and in 4/5 the binding end is RSI > 70 — the rule standing aside from a trend
// that is running, waiting for it to cool into the band. The anticipation of
// that is "RSI is above the band and FALLING": the cool-off has started but is
// not yet certified. Symmetrically below the band. Both are decidable at bar i
// from rsi[i] and rsi[i-1]; nothing here reads forward.
//
// THE INSTRUMENT THE PREVIOUS RUN LACKED. Each anticipation variant is paired
// with a WIDENING variant that moves the same threshold by the same amount with
// no direction-of-travel test. The pair is the whole point:
//   - if approach ~ widen, direction adds nothing and this is exposure again;
//   - if approach > widen, the timing claim is separable from the exposure claim.
// `lead%` measures it directly: of the bars a variant signals on that the
// baseline does not, the share followed by a baseline signal of the same side
// within 3 bars on the same symbol. A true anticipation rule scores high; a
// relaxation that merely trades more scores near the base rate. simulateExits
// holds one position per symbol (`if (open) continue`), so a signal 2 bars early
// takes the position and the baseline's own signal is then skipped — that is the
// "same trade, earlier bar" mechanism, and lead% is how much of it is happening.
//
// PRE-REGISTERED, written before the run. A variant earns candidate status only
// by beating the baseline's margin on FIT AND SELECT AND both geometries — four
// cells — AND beating its own paired widening variant in the same four. The
// second condition is new and is the one that matters: `adx 15` already passes
// the first (it is here as `adx widen 5`, a known quantity at +0.009R) without
// being an anticipation rule at all. TEST1/TEST2/TEST3 print only under
// --holdout, to be read after the candidate list is written down. Nothing here
// is an approval: the panel gate in panelRun.ts is the approver.
//
// RESULT of the selection run (scripts/entry-anticipation.log, 2026-09-05):
// NO CANDIDATE. All four approach variants fail the pre-registered bar; the best,
// `adx approach 5`, is 3/4 and fails fit/single. There is no holdout run to do.
//
// The harness checks out first: `adx widen 5` reproduces `adx 15` from
// entry-lag-variants.log to three decimals in all four cells — +0.001 / +0.009 /
// +0.010 / +0.022 — so the baseline row is bit-identical to the previous run's
// and the new columns sit on the old numbers.
//
// The two gates then answer the direction question in OPPOSITE directions, which
// is what kills the hypothesis rather than merely failing it:
//
//   RSI pad — approach BEATS plain widening 4/4 (+0.007/+0.008/+0.015/+0.018),
//   recovering roughly two thirds of the harm widening does, and never reaching
//   the baseline. But its lead% is 60.1 against widening's 61.5: the direction
//   test threw away 69% of the extra signals (23,345 -> 7,225) and did not improve
//   onset prediction AT ALL. Whatever it recovered, it did not recover by
//   anticipating the setup.
//
//   ADX pad — approach lifts lead% from 18.0% to 31.4%, a real +13pp gain in
//   predicting the baseline's own trigger, and LOSES to plain widening 4/4
//   (-0.002/-0.007/-0.008/-0.017). Predicting the onset better made returns worse.
//
// So within this family the two things the hypothesis assumed were the same thing
// — firing earlier on the same setup, and predicting when the setup fires — are
// measurably not the same thing, and where they were separable they pointed
// opposite ways. That is consistent with the 30/30 control result read at the bar
// level: the baseline's trigger bar is negatively selected, so a rule that homes
// in on it inherits the selection. Caveat: lead% is confounded with which gate is
// padded (RSI pads score high, ADX pads low), so the cross-gate ordering is not
// evidence on its own; the within-gate pairs above are the clean comparisons.
//
// This does not prove no anticipation rule can work — it tests the family
// reachable by padding the two binding gates. It does refute the premise that
// firing earlier on the same setup is worth something causally.
//
//   npx tsx scripts/entry-anticipation.mts              # FIT + SELECT
//   npx tsx scripts/entry-anticipation.mts --holdout    # the three held-out folds
//
import "dotenv/config";
import { loadPanel, FOLDS } from "@/lib/research/panel";
import {
  sliceFold, simulateFold, runControl, PANEL_LOT,
  type PanelExit, type PreparedSymbol,
} from "@/lib/research/panelRun";
import { computeEntrySignals, barSnapshots, DEFAULT_COST_MODEL, WARMUP } from "@/lib/backtest/engine";
import { DEFAULT_THRESHOLDS, type ScanSnapshot } from "@/lib/trading/scanner";

const holdout = process.argv.includes("--holdout");
const controlRuns = Number(process.argv.find((a) => a.startsWith("--control="))?.split("=")[1] ?? 200);
const FOLD_LIST = holdout ? [FOLDS.test1, FOLDS.test2, FOLDS.test3] : [FOLDS.fit, FOLDS.select];
/** How many bars ahead a signal may look to count as having led a baseline onset. */
const LEAD_WINDOW = 3;

const GEOMETRIES: Record<string, PanelExit> = {
  "single 1.5": { tp1Mult: 1.5, slMult: 1.5, singleTarget: true, lot: PANEL_LOT, costs: DEFAULT_COST_MODEL },
  "trail 1.5/1.5": {
    tp1Mult: 2.5, slMult: 1.5, singleTarget: true, lot: PANEL_LOT, costs: DEFAULT_COST_MODEL,
    trail: { activateMult: 1.5, offsetMult: 1.5 },
  },
};

interface Variant {
  /** Widen the RSI band by this much on BOTH ends before testing membership. */
  rsiPad?: number;
  /** Lower the ADX floor by this much. */
  adxPad?: number;
  /** Require the padded gate to be closing on its threshold, not merely inside the pad. */
  approach?: boolean;
}

// Pairs, deliberately adjacent in the list so the comparison is read as a pair.
const VARIANTS: { name: string; v: Variant }[] = [
  { name: "baseline", v: {} },
  { name: "rsi approach 5", v: { rsiPad: 5, approach: true } },
  { name: "rsi widen 5", v: { rsiPad: 5 } },
  { name: "rsi approach 10", v: { rsiPad: 10, approach: true } },
  { name: "rsi widen 10", v: { rsiPad: 10 } },
  { name: "adx approach 5", v: { adxPad: 5, approach: true } },
  { name: "adx widen 5", v: { adxPad: 5 } },
  { name: "both approach 5", v: { rsiPad: 5, adxPad: 5, approach: true } },
  { name: "both widen 5", v: { rsiPad: 5, adxPad: 5 } },
];

/**
 * decideSetup's gate chain with two gates able to reach a bar EARLY. The order
 * and the comparisons mirror scanner.ts exactly, and the confluence vetoes are
 * omitted because every one is inert at DEFAULT_THRESHOLDS — so `baseline` here
 * reproduces the desk's rule bit for bit, and its avgR must match
 * ladder-transfer.log.
 *
 * The padded region is the only new ground: a bar where a gate fails the real
 * threshold but sits within its pad. `approach` additionally requires the
 * reading to be moving toward the threshold since the previous bar, which is
 * the difference between anticipating the onset and simply accepting a looser
 * rule. Both read only bars i and i-1.
 */
function sideAt(snaps: ScanSnapshot[], i: number, v: Variant): "long" | "short" | null {
  const s = snaps[i];
  const { sma20: s20, sma50: s50, rsi: rv, adx: a, plusDI: pDI, minusDI: mDI, macdHist: hist, atr: atrVal } = s;
  if (a == null || s20 == null || s50 == null || rv == null || pDI == null || mDI == null) return null;
  const prev = i > 0 ? snaps[i - 1] : null;

  const floor = DEFAULT_THRESHOLDS.adxFloor;
  if (a <= floor - (v.adxPad ?? 0)) return null;
  if (a <= floor && v.approach) {
    // inside the ADX pad — early ground, so require it to be closing on the floor
    const pa = prev?.adx;
    if (pa == null || a <= pa) return null;
  }

  const up = s20 > s50 && pDI > mDI;
  const down = s20 < s50 && mDI > pDI;
  if (!up && !down) return null;

  const pad = v.rsiPad ?? 0;
  const lo = DEFAULT_THRESHOLDS.rsiLow;
  const hi = DEFAULT_THRESHOLDS.rsiHigh;
  if (rv < lo - pad || rv > hi + pad) return null;
  if ((rv < lo || rv > hi) && v.approach) {
    // inside the RSI pad — below the band the reading must be rising toward it,
    // above it falling toward it.
    const pr = prev?.rsi;
    if (pr == null) return null;
    if (rv < lo ? rv <= pr : rv >= pr) return null;
  }

  if (up && !(hist == null || hist > -Math.abs((atrVal ?? 1) * 0.1))) return null;
  return up ? "long" : "short";
}

function fmt(x: number, w = 6): string {
  return `${x >= 0 ? "+" : ""}${x.toFixed(3)}`.padStart(w);
}

/**
 * Of the bars this variant signals on that the baseline does not, the share
 * followed by a baseline signal of the SAME side within LEAD_WINDOW bars.
 * Exposure scores near the base rate; anticipation scores far above it.
 */
function leadShare(
  base: ("long" | "short" | null)[][],
  cand: ("long" | "short" | null)[][],
): { extra: number; led: number } {
  let extra = 0;
  let led = 0;
  for (let k = 0; k < base.length; k++) {
    const b = base[k];
    const c = cand[k];
    for (let i = WARMUP; i < c.length; i++) {
      if (!c[i] || b[i]) continue;
      extra++;
      for (let j = i + 1; j <= Math.min(i + LEAD_WINDOW, c.length - 1); j++) {
        if (b[j] === c[i]) {
          led++;
          break;
        }
      }
    }
  }
  return { extra, led };
}

async function main() {
  const panel = await loadPanel();
  console.log(
    `panel: ${panel.symbols.length} symbols · control ${controlRuns} runs per cell · lead window ${LEAD_WINDOW} bars`,
  );
  console.log(
    holdout
      ? `folds: TEST1/TEST2/TEST3 — held out. Read only after the candidate list is written down.\n`
      : `folds: FIT + SELECT only (selection). Re-run with --holdout once the candidates are chosen.\n`,
  );

  for (const fold of FOLD_LIST) {
    const slices = sliceFold(panel, fold);
    // The one expensive step, paid once per symbol per fold: every variant below
    // is a different reading of the SAME snapshots.
    const snapsBySymbol = slices.map((s) => barSnapshots(s.candles));
    const baseSides = slices.map(
      (s, k) => computeEntrySignals(s.candles, undefined, (i) => sideAt(snapsBySymbol[k], i, {}), snapsBySymbol[k]).sides,
    );

    for (const [geoName, exit] of Object.entries(GEOMETRIES)) {
      console.log(`${fold.name} · ${geoName}`);
      console.log(
        `  ${"variant".padEnd(17)}${"trades".padStart(8)}${"avgR".padStart(9)}${"ctrl med".padStart(10)}${"margin".padStart(9)}${"vs base".padStart(9)}${"extra sig".padStart(11)}${"lead%".padStart(8)}`,
      );
      let baseMargin: number | null = null;
      for (const { name, v } of VARIANTS) {
        const sides = slices.map((s, k) =>
          computeEntrySignals(s.candles, undefined, (i) => sideAt(snapsBySymbol[k], i, v), snapsBySymbol[k]),
        );
        const prepared: PreparedSymbol[] = slices.map((s, k) => ({ ...s, signals: sides[k] }));
        const run = simulateFold(prepared, fold, exit);
        const ctrl = runControl(prepared, fold, exit, controlRuns);
        const r = run.summary.avgR;
        if (r == null || !ctrl) {
          console.log(`  ${name.padEnd(17)}${String(run.summary.trades).padStart(8)}${"—".padStart(9)}`);
          continue;
        }
        const margin = r - ctrl.median;
        if (name === "baseline") baseMargin = margin;
        const delta = baseMargin == null ? "" : fmt(margin - baseMargin, 9);
        const { extra, led } = leadShare(baseSides, sides.map((s) => s.sides));
        const lead = extra === 0 ? "—" : `${((100 * led) / extra).toFixed(1)}%`;
        console.log(
          `  ${name.padEnd(17)}${String(run.summary.trades).padStart(8)}${fmt(r, 9)}${fmt(ctrl.median, 10)}${fmt(margin, 9)}${delta}${String(extra).padStart(11)}${lead.padStart(8)}`,
        );
      }
      console.log();
    }
  }

  console.log(`How to read this
  - "margin" is avgR minus the matched control's median — the only column that
    can support a claim. avgR alone rises whenever a variant simply trades more
    on a panel that drifted up.
  - "vs base" is the margin minus the baseline's margin in the same cell.
  - "lead%" is the discriminator. Each approach variant must beat BOTH the
    baseline AND its paired widen variant; if approach ~ widen on margin, the
    direction-of-travel test bought nothing and this is the exposure result again.
  - A variant whose extra-signal count balloons while its margin barely moves has
    bought exposure, not timing.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
