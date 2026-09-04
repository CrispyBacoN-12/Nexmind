// Can the confirmation lag be removed by a rule that could actually have been
// traded?
//
// entry-lateness.log is a lookahead diagnostic: it moves a signal earlier using
// the knowledge that the signal will fire, which nobody has at the time. It said
// the loss lives in the waiting. entry-gate-lag.log then named what the rule is
// waiting on, and the answer was lopsided: at the bar before a signal onset, the
// RSI band alone refuses ~53% of them, against ~19% for trend/DI alignment, ~13%
// for the ADX floor and ~11% for the MACD check. This script is the tradeable
// form of the claim — every variant below decides from bar i's own data and
// nothing later.
//
// PRE-REGISTERED, written before any fold was run.
//
// Variants. Each moves exactly one gate of decideSetup, plus two pairs, so a
// result can be attributed to a gate rather than to a bundle:
//   baseline        DEFAULT_THRESHOLDS, the rule the desk runs today
//   adx 15          the ADX floor is a level gate on a lagging indicator
//   adx rising      ADX increasing instead of ADX past a level — true while the
//                   trend is building rather than after it is built
//   macd off        drops the "histogram not rolling over" confirmation
//   rsi low 30      admits a deeper pullback (blocked today by RSI < 35)
//   rsi high 80     admits a hotter trend (blocked today by RSI > 70)
//   rsi 30-80       both ends, to separate "which end was binding" from "the
//                   band was binding"
//   rsi 30-80 + macd off   the two largest blockers together
//
// The two RSI directions are kept apart on purpose. The gate-lag tally says the
// band blocks, not which side of it, and the two mean opposite things: relaxing
// the low end enters earlier INTO a pullback, relaxing the high end stops
// waiting for one. A single "widen the band" variant would confound them.
//
// Metric. Margin over the matched random-entry control (200 runs), NOT raw avgR.
// Every variant here admits more trades than the baseline, and on a panel where
// most names rose, more trades buys more exposure for free; only the margin says
// the bars chosen were better than random bars. Trade counts are printed so an
// improvement bought purely by trading more is visible as such.
//
// Selection rule, fixed in advance. A variant is a candidate only if, on FIT and
// SELECT, its margin beats the baseline's margin on BOTH folds and BOTH exit
// geometries — four cells. TEST1/TEST2/TEST3 print only under --holdout and are
// to be read after the candidate list is written down. Nothing here is an
// approval: the panel gate in panelRun.ts is the approver.
//
// RESULT of the selection run (scripts/entry-lag-variants.log, 2026-09-03):
// one candidate, `adx 15`, positive in all four cells by +0.001 / +0.009 /
// +0.010 / +0.022. Every other variant fails at least one cell, and the three
// RSI relaxations — the gate the lag diagnostic pointed straight at — are the
// worst of the eight. The holdout run below exists to finish `adx 15` honestly,
// not because the hypothesis survived.
//
// RESULT of the holdout run (scripts/entry-lag-variants-holdout.log, same day):
// `adx 15` is positive in all six held-out cells — 10/10 overall, the only
// variant that replicates, and the only one whose control median FALLS as its
// trade count grows (9/10 cells) while its own avgR rises. That is the signature
// entering earlier should have, and it is worth +0.009R averaged over the ten
// cells: the margin stays NEGATIVE in all ten. `adx rising` inverts on TEST3
// (−0.017 / −0.025), which is what the selection split is for; `rsi high 80` is
// negative in 10/10. Conclusion: the ADX floor is set too late, replicated — and
// that is a smaller loss, not an edge.
//
//   npx tsx scripts/entry-lag-variants.mts              # FIT + SELECT
//   npx tsx scripts/entry-lag-variants.mts --holdout    # the three held-out folds
//
import "dotenv/config";
import { loadPanel, FOLDS } from "@/lib/research/panel";
import {
  sliceFold, simulateFold, runControl, PANEL_LOT,
  type PanelExit, type PreparedSymbol,
} from "@/lib/research/panelRun";
import { computeEntrySignals, barSnapshots, DEFAULT_COST_MODEL } from "@/lib/backtest/engine";
import { DEFAULT_THRESHOLDS, type ScanSnapshot } from "@/lib/trading/scanner";

const holdout = process.argv.includes("--holdout");
const controlRuns = Number(process.argv.find((a) => a.startsWith("--control="))?.split("=")[1] ?? 200);
// --holdout runs ONLY the three held-out folds. FIT and SELECT are not re-run:
// their numbers are already in the log that the candidate list was written from,
// and reprinting them alongside the holdout invites reading the five together as
// one table, which is exactly what the split exists to prevent.
const FOLD_LIST = holdout ? [FOLDS.test1, FOLDS.test2, FOLDS.test3] : [FOLDS.fit, FOLDS.select];

const GEOMETRIES: Record<string, PanelExit> = {
  "single 1.5": { tp1Mult: 1.5, slMult: 1.5, singleTarget: true, lot: PANEL_LOT, costs: DEFAULT_COST_MODEL },
  "trail 1.5/1.5": {
    tp1Mult: 2.5, slMult: 1.5, singleTarget: true, lot: PANEL_LOT, costs: DEFAULT_COST_MODEL,
    trail: { activateMult: 1.5, offsetMult: 1.5 },
  },
};

interface Relax {
  adxFloor?: number;
  /** "rising" replaces the level test with adx[i] > adx[i-1]. */
  adxMode?: "rising";
  rsiLow?: number;
  rsiHigh?: number;
  /** false drops the MACD-not-rolling-over check on longs. */
  macdGate?: boolean;
}

const VARIANTS: { name: string; relax: Relax }[] = [
  { name: "baseline", relax: {} },
  { name: "adx 15", relax: { adxFloor: 15 } },
  { name: "adx rising", relax: { adxMode: "rising" } },
  { name: "macd off", relax: { macdGate: false } },
  { name: "rsi low 30", relax: { rsiLow: 30 } },
  { name: "rsi high 80", relax: { rsiHigh: 80 } },
  { name: "rsi 30-80", relax: { rsiLow: 30, rsiHigh: 80 } },
  { name: "rsi30-80+macd", relax: { rsiLow: 30, rsiHigh: 80, macdGate: false } },
];

/**
 * decideSetup's gate chain, re-expressed so one gate at a time can be moved.
 * The order and the comparisons mirror scanner.ts exactly, and the confluence
 * vetoes are omitted because every one of them is inert at DEFAULT_THRESHOLDS —
 * so `baseline` here must reproduce the desk's rule bit for bit. The baseline
 * row is the check that it does: its avgR has to match ladder-transfer.log.
 */
function sideAt(snaps: ScanSnapshot[], i: number, r: Relax): "long" | "short" | null {
  const s = snaps[i];
  const { sma20: s20, sma50: s50, rsi: rv, adx: a, plusDI: pDI, minusDI: mDI, macdHist: hist, atr: atrVal } = s;
  if (a == null || s20 == null || s50 == null || rv == null || pDI == null || mDI == null) return null;

  if (r.adxMode === "rising") {
    const prev = i > 0 ? snaps[i - 1].adx : null;
    if (prev == null || a <= prev) return null;
  } else if (a <= (r.adxFloor ?? DEFAULT_THRESHOLDS.adxFloor)) {
    return null;
  }

  const up = s20 > s50 && pDI > mDI;
  const down = s20 < s50 && mDI > pDI;
  if (!up && !down) return null;
  if (rv < (r.rsiLow ?? DEFAULT_THRESHOLDS.rsiLow) || rv > (r.rsiHigh ?? DEFAULT_THRESHOLDS.rsiHigh)) return null;
  if (r.macdGate !== false && up && !(hist == null || hist > -Math.abs((atrVal ?? 1) * 0.1))) return null;

  return up ? "long" : "short";
}

function fmt(x: number, w = 6): string {
  return `${x >= 0 ? "+" : ""}${x.toFixed(3)}`.padStart(w);
}

async function main() {
  const panel = await loadPanel();
  console.log(`panel: ${panel.symbols.length} symbols · control ${controlRuns} runs per cell`);
  console.log(holdout
    ? `folds: TEST1/TEST2/TEST3 — held out. Read only after the candidate list is written down.\n`
    : `folds: FIT + SELECT only (selection). Re-run with --holdout once the candidates are chosen.\n`);

  for (const fold of FOLD_LIST) {
    const slices = sliceFold(panel, fold);
    // The one expensive step, paid once per symbol per fold: every variant below
    // is a different reading of the SAME snapshots.
    const snapsBySymbol = slices.map((s) => barSnapshots(s.candles));

    for (const [geoName, exit] of Object.entries(GEOMETRIES)) {
      console.log(`${fold.name} · ${geoName}`);
      console.log(`  ${"variant".padEnd(16)}${"trades".padStart(8)}${"avgR".padStart(9)}${"ctrl med".padStart(10)}${"margin".padStart(9)}${"vs base".padStart(9)}`);
      let baseMargin: number | null = null;
      for (const v of VARIANTS) {
        const prepared: PreparedSymbol[] = slices.map((s, k) => ({
          ...s,
          signals: computeEntrySignals(s.candles, undefined, (i) => sideAt(snapsBySymbol[k], i, v.relax), snapsBySymbol[k]),
        }));
        const run = simulateFold(prepared, fold, exit);
        const ctrl = runControl(prepared, fold, exit, controlRuns);
        const r = run.summary.avgR;
        if (r == null || !ctrl) {
          console.log(`  ${v.name.padEnd(16)}${String(run.summary.trades).padStart(8)}${"—".padStart(9)}`);
          continue;
        }
        const margin = r - ctrl.median;
        if (v.name === "baseline") baseMargin = margin;
        const delta = baseMargin == null ? "" : fmt(margin - baseMargin, 9);
        console.log(
          `  ${v.name.padEnd(16)}${String(run.summary.trades).padStart(8)}${fmt(r, 9)}${fmt(ctrl.median, 10)}${fmt(margin, 9)}${delta}`,
        );
      }
      console.log();
    }
  }

  console.log(`How to read this
  - "margin" is avgR minus the matched control's median. It is the only column
    that can support a claim; avgR alone rises whenever a variant simply trades
    more on a panel that drifted up.
  - "vs base" is the margin minus the baseline's margin in the same cell. A
    variant earns candidate status only by being positive here on FIT AND SELECT
    AND both geometries — four cells, pre-registered above.
  - A variant whose trade count balloons while its margin barely moves has bought
    exposure, not timing, and the control is what makes that visible.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
