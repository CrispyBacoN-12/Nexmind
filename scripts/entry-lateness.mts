// Was the move already underway by the time the entry rule fired?
//
// THIS IS A DIAGNOSTIC AND CANNOT BE TRADED. Shifting an entry earlier uses
// information that did not exist yet — you only learn the rule fired at bar t,
// so entering at t-k is lookahead by construction. Nothing here is a candidate
// strategy and no number from it may be quoted as an edge. It answers exactly
// one question, which is a question about the PAST: at the moment the rule
// committed, how much of the move had already happened?
//
// Why ask it. ladder-transfer.log put the desk's baseline entry rule below a
// matched random control in 30 of 30 (ladder x fold) cells, and the deficit
// grows monotonically in 5/5 folds as the target widens (select: -0.130 at
// 1.5 ATR to -0.255 at 3.0). A rule that merely had no edge would sit near the
// control at every target width. A deficit that scales with how far price must
// still travel is the signature of committing late — the rule waits for ADX >
// 20, a completed pullback, DI alignment and a MACD histogram that is not
// rolling over, and every one of those is a condition that can only be true
// after the move has started.
//
// So: replay the SAME signals k bars earlier and read whether avgR rises with
// k. If it does, the information was already in the bars the rule was still
// waiting on, and "add another confirmation filter" — which is what all 13
// rejected confluence filters did — was always going to make it worse.
//
// The control is recomputed at every k, so each row is compared against a null
// with that row's own trade count and long/short mix.
//
//   npx tsx scripts/entry-lateness.mts
//
import "dotenv/config";
import { loadPanel, FOLDS } from "@/lib/research/panel";
import { sliceFold, simulateFold, runControl, PANEL_LOT, type PanelExit, type PreparedSymbol } from "@/lib/research/panelRun";
import { computeEntrySignals, WARMUP, DEFAULT_COST_MODEL, type EntrySignals } from "@/lib/backtest/engine";

const FOLD_LIST = Object.values(FOLDS);
const SHIFTS = [0, 1, 2, 3, 5, 8];
const controlRuns = Number(process.argv.find((a) => a.startsWith("--control="))?.split("=")[1] ?? 100);

/** The two geometries that bracket the effect: the tightest target, and the trail that lets the whole move run. */
const GEOMETRIES: Record<string, PanelExit> = {
  "single 1.5": { tp1Mult: 1.5, slMult: 1.5, singleTarget: true, lot: PANEL_LOT, costs: DEFAULT_COST_MODEL },
  "trail 1.5/1.5": {
    tp1Mult: 2.5, slMult: 1.5, singleTarget: true, lot: PANEL_LOT, costs: DEFAULT_COST_MODEL,
    trail: { activateMult: 1.5, offsetMult: 1.5 },
  },
};

/**
 * Move every entry k bars earlier, keeping the ATR of the bar actually entered
 * on — the same treatment matchedRandomSignals gives the control, so the R
 * denominator is the width a stop placed at that bar would really have had.
 *
 * Entries that would land before the first tradable bar are dropped rather than
 * clamped: clamping would pile several signals onto one bar and quietly change
 * the trade count, which is the one thing every arm here has to hold fixed.
 */
function shiftEarlier(sig: EntrySignals, entryFrom: number, k: number): EntrySignals {
  const n = sig.sides.length;
  const start = Math.max(WARMUP, entryFrom);
  const sides: ("long" | "short" | null)[] = new Array(n).fill(null);
  for (let i = start; i < n; i++) {
    const s = sig.sides[i];
    if (!s) continue;
    const j = i - k;
    if (j < start) continue;
    if (sides[j]) continue; // two signals collapsing onto one bar — keep the first
    sides[j] = s;
  }
  return { sides, atrs: sig.atrs };
}

async function main() {
  const panel = await loadPanel();
  console.log(`DIAGNOSTIC ONLY — shifting an entry earlier is lookahead and cannot be traded.\n`);
  console.log(`panel: ${panel.symbols.length} symbols · control ${controlRuns} runs per cell\n`);

  const slices = new Map(FOLD_LIST.map((f) => [f.name, sliceFold(panel, f)]));
  const base = new Map<string, PreparedSymbol[]>();
  for (const fold of FOLD_LIST) {
    base.set(fold.name, slices.get(fold.name)!.map((s) => ({ ...s, signals: computeEntrySignals(s.candles) })));
  }

  for (const [geoName, exit] of Object.entries(GEOMETRIES)) {
    console.log(`${geoName}   —   avgR  (margin over matched control)`);
    console.log("  " + "shift".padEnd(10) + FOLD_LIST.map((f) => f.name.padStart(20)).join(""));
    for (const k of SHIFTS) {
      const cells = FOLD_LIST.map((fold) => {
        const prepared = base.get(fold.name)!.map((p) => ({
          ...p,
          signals: k === 0 ? p.signals : shiftEarlier(p.signals, p.entryFrom, k),
        }));
        const run = simulateFold(prepared, fold, exit);
        const ctrl = runControl(prepared, fold, exit, controlRuns);
        const r = run.summary.avgR;
        if (r == null || !ctrl) return "—".padStart(20);
        const m = r - ctrl.median;
        return `${(r >= 0 ? "+" : "") + r.toFixed(3)} (${(m >= 0 ? "+" : "") + m.toFixed(3)})`.padStart(20);
      });
      console.log("  " + `t-${k}`.padEnd(10) + cells.join(""));
    }
    console.log("");
  }

  console.log(`How to read this
  - avgR rising with k means the move was already running when the rule fired,
    and the rule's confirmation conditions were paid for out of the move itself.
  - The MARGIN is the part that matters. avgR alone rises for free if an earlier
    entry simply buys more exposure; only the margin says the earlier bar was a
    better bar than a random one. A margin that climbs toward zero as k grows
    locates the loss in the waiting, not in the symbol selection.
  - A margin that stays flat and negative at every k says the opposite: the rule
    is picking the wrong NAMES, not the wrong bars, and entering sooner on the
    same names would not have helped.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
