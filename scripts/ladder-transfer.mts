// Does a FIT-chosen exit ladder transfer to folds nobody looked at?
//
// This is a MEASUREMENT, not a gate, and it is the precondition for letting
// anything — a grid or the AI — *choose* an exit.
//
// `sweepLadder` in runResearch.ts picks one of LADDER_OPTIONS per candidate by
// maximising raw avgR on FIT. Two things about that are worth checking before
// building on it:
//
//   1. It is an 8-way fit on one fold, selected on raw avgR with NO matched
//      control. That is the exact shape of trap #1 in STATE.md §5 — on this
//      universe a friendlier target prints a better avgR for free.
//   2. Breadth quintiles and vol quintiles both died the same death: cut points
//      fitted on 2016-2018 measured a different market by 2022. A ladder is
//      another FIT-fitted constant. Nobody has checked whether it transfers.
//
// So: run every LADDER_OPTION over every fold on the desk's own baseline entry
// rule, and read the ORDERING. If the FIT ranking survives into SELECT and the
// TEST folds, per-candidate ladder selection is doing real work. If it does
// not, `sweepLadder` is fitting noise and every candidate should get one fixed
// ladder instead — which is a deletion, not a feature.
//
// Entry signals are computed once per fold and reused across all eight
// geometries (simulateExits is nearly free), so the whole matrix costs about
// one backtest per fold.
//
//   npx tsx scripts/ladder-transfer.mts
//
import "dotenv/config";
import { loadPanel, FOLDS, FIT_FOLD } from "@/lib/research/panel";

/** FOLDS is keyed by name; this is the chronological order the tables are read in. */
const FOLD_LIST = Object.values(FOLDS);
import { sliceFold, simulateFold, runControl, PANEL_LOT, type PanelExit, type PreparedSymbol } from "@/lib/research/panelRun";
import { computeEntrySignals, DEFAULT_COST_MODEL } from "@/lib/backtest/engine";
import { LADDER_OPTIONS, type ExitLadder } from "@/lib/research/runResearch";

const controlRuns = Number(process.argv.find((a) => a.startsWith("--control="))?.split("=")[1] ?? 0);

function ladderName(l: ExitLadder): string {
  return l.trail ? `trail ${l.trail.activateMult}/${l.trail.offsetMult}` : `single ${l.tp1Mult.toFixed(1)}`;
}

function toPanelExit(l: ExitLadder): PanelExit {
  return {
    tp1Mult: l.tp1Mult, slMult: l.slMult, trail: l.trail, singleTarget: true,
    lot: PANEL_LOT, costs: DEFAULT_COST_MODEL,
  };
}

/** Ranks, 1 = best avgR. Nulls rank last. */
function ranksOf(values: (number | null)[]): number[] {
  const order = values.map((v, i) => ({ v: v ?? -Infinity, i })).sort((a, b) => b.v - a.v);
  const ranks = new Array<number>(values.length);
  order.forEach((o, k) => { ranks[o.i] = k + 1; });
  return ranks;
}

/** Spearman rho between two rank vectors of the same length (no ties expected on continuous avgR). */
function spearman(a: number[], b: number[]): number {
  const n = a.length;
  const d2 = a.reduce((acc, x, i) => acc + (x - b[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

async function main() {
  const panel = await loadPanel();
  console.log(`panel: ${panel.symbols.length} symbols, ${FOLD_LIST.length} folds, ${LADDER_OPTIONS.length} ladders`);
  console.log(`entry rule: the desk's own baseline (computeEntrySignals defaults) — the ladder is the only thing varying\n`);

  const prepared = new Map<string, PreparedSymbol[]>();
  for (const fold of FOLD_LIST) {
    const t0 = Date.now();
    prepared.set(
      fold.name,
      sliceFold(panel, fold).map((s) => ({ ...s, signals: computeEntrySignals(s.candles) })),
    );
    console.log(`  prepared ${fold.name} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }

  // avgR[ladderIndex][foldName]
  const avgR: (number | null)[][] = [];
  const trades: number[][] = [];
  for (const l of LADDER_OPTIONS) {
    const rowR: (number | null)[] = [];
    const rowT: number[] = [];
    for (const fold of FOLD_LIST) {
      const run = simulateFold(prepared.get(fold.name)!, fold, toPanelExit(l));
      rowR.push(run.summary.avgR ?? null);
      rowT.push(run.summary.trades);
    }
    avgR.push(rowR);
    trades.push(rowT);
  }

  const w = 16;
  console.log(`\navgR by ladder × fold  (rank in parentheses, 1 = best in that fold)`);
  console.log("  " + "ladder".padEnd(w) + FOLD_LIST.map((f) => f.name.padStart(14)).join(""));
  const rankByFold = FOLD_LIST.map((_, fi) => ranksOf(avgR.map((r) => r[fi])));
  LADDER_OPTIONS.forEach((l, li) => {
    const cells = FOLD_LIST.map((_, fi) => {
      const v = avgR[li][fi];
      return `${v == null ? "  —" : (v >= 0 ? "+" : "") + v.toFixed(3)} (${rankByFold[fi][li]})`.padStart(14);
    });
    console.log("  " + ladderName(l).padEnd(w) + cells.join(""));
  });
  console.log("  " + "trades".padEnd(w) + FOLD_LIST.map((_, fi) => String(trades[0][fi]).padStart(14)).join(""));

  // Does the FIT ordering survive?
  const fitIdx = FOLD_LIST.findIndex((f) => f.name === FIT_FOLD.name);
  const fitRanks = rankByFold[fitIdx];
  const fitBest = fitRanks.indexOf(1);
  console.log(`\nFIT picks: ${ladderName(LADDER_OPTIONS[fitBest])}  (this is what sweepLadder would select)`);
  console.log("  " + "fold".padEnd(w) + "rho vs FIT".padStart(12) + "FIT pick's rank".padStart(18) + "best in fold".padStart(20));
  for (let fi = 0; fi < FOLD_LIST.length; fi++) {
    if (fi === fitIdx) continue;
    const rho = spearman(fitRanks, rankByFold[fi]);
    console.log(
      "  " + FOLD_LIST[fi].name.padEnd(w) +
      rho.toFixed(2).padStart(12) +
      `${rankByFold[fi][fitBest]} of ${LADDER_OPTIONS.length}`.padStart(18) +
      ladderName(LADDER_OPTIONS[rankByFold[fi].indexOf(1)]).padStart(20),
    );
  }

  if (controlRuns > 0) {
    // Run on EVERY fold, not just FIT. The pattern this is here to test — the
    // control's margin widening as the exit lets more upside run — is a claim
    // about the gate itself, and a claim from one fold is the same mistake the
    // 13 confluence filters were.
    console.log(`
margin over the matched random-entry control (${controlRuns} runs)`);
    console.log("  " + "ladder".padEnd(w) + FOLD_LIST.map((f) => f.name.padStart(12)).join(""));
    for (let li = 0; li < LADDER_OPTIONS.length; li++) {
      const exit = toPanelExit(LADDER_OPTIONS[li]);
      const cells = FOLD_LIST.map((fold, fi) => {
        const c = runControl(prepared.get(fold.name)!, fold, exit, controlRuns);
        const r = avgR[li][fi];
        if (r == null || !c) return "—".padStart(12);
        const m = r - c.median;
        return ((m >= 0 ? "+" : "") + m.toFixed(3)).padStart(12);
      });
      console.log("  " + ladderName(LADDER_OPTIONS[li]).padEnd(w) + cells.join(""));
    }
    console.log("  (rule avgR minus the control MEDIAN — negative means random entry did better)");
  }

  console.log(`
How to read this
  - rho near +1 means the FIT ordering of ladders survived into that fold, and
    picking a ladder on FIT is defensible. Near 0 or negative means the FIT
    ranking carried no information about the fold, and sweepLadder is choosing
    on noise — the same way breadth and vol cut points failed (STATE.md §5).
  - "FIT pick's rank" is the direct cost: if the FIT winner lands mid-table or
    worse out of sample, per-candidate ladder selection is buying nothing.
  - The control block answers the separate question of whether ANY of these
    geometries beats random entry under the same exit. Note it cannot credit an
    exit on its own — the control gets the same ladder — so a uniform shift
    across the column is expected and is not evidence about the ladder.
`);
}

main().catch((e) => { console.error(e); process.exit(1); });
