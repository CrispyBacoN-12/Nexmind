// Does the market regime separate the baseline's per-trade edge at all?
//
// This is a MEASUREMENT, not a gate. It answers the only question worth asking
// before writing a regime filter: if you bucket every trade by the market state
// on the day it opened, do the buckets have different avgR — and is the
// difference monotone, or is it noise wearing a gradient's clothes?
//
// Asking it this way is deliberate. The 13 confluence filters in docs/quant/
// were each written first and measured second, and all 13 died out-of-sample. A
// regime gate is the same kind of object: a veto that removes trades. So no
// threshold is chosen here. Buckets are QUINTILES, and their cut points come
// from the FIT fold alone — so the same boundaries can be reused later as
// pre-registered thresholds without having been fitted on anything held out.
//
// Read the FIT row to form a hypothesis. Read SELECT to see whether it survives
// contact with a year nobody looked at. Do NOT choose anything from the TEST
// rows; they are printed so the eventual verdict is auditable, and reading them
// as a menu is how the panel folds get spent.
//
//   npx tsx scripts/regime-conditional.mts
//   npx tsx scripts/regime-conditional.mts --ladder=trail
//
import "dotenv/config";
import { loadPanel, FOLDS, FIT_FOLD, type Fold } from "@/lib/research/panel";
import { sliceFold, PANEL_LOT, type PanelExit } from "@/lib/research/panelRun";
import {
  computeEntrySignals, simulateExits, DEFAULT_COST_MODEL, type SimTrade,
} from "@/lib/backtest/engine";
import {
  buildRegimeSeries, regimeAt, BENCHMARK, TREND_PERIOD, VOL_PERIOD,
  type RegimeSeries,
} from "@/lib/market/regime";

// The two geometries the desk actually has a claim to. `flat` is the contract
// blindTest applies to a pre-ladder row; `trail` is the ATR trail that is the
// one exit change to have cleared IS and OOS on weekly bars. Reporting the
// conditional under both is the cheap guard against a "regime effect" that is
// really an artifact of one stop placement — signals are computed once and
// simulateExits is nearly free, so the second geometry costs almost nothing.
const LADDERS: Record<string, PanelExit> = {
  flat: { tp1Mult: 1.2, slMult: 1.5, singleTarget: true, lot: PANEL_LOT, costs: DEFAULT_COST_MODEL },
  trail: {
    tp1Mult: 1.2, slMult: 1.5, singleTarget: true, lot: PANEL_LOT, costs: DEFAULT_COST_MODEL,
    trail: { activateMult: 1.5, offsetMult: 1.5 },
  },
};

const BUCKETS = 5;

interface Tagged {
  trade: SimTrade;
  breadth: number | null;
  benchAbove: boolean | null;
  vol: number | null;
}

interface Stat {
  label: string;
  trades: number;
  symbols: number;
  avgR: number | null;
  winPct: number | null;
  sharePct: number;
}

const fmt = (v: number | null, d = 3) => (v == null || !Number.isFinite(v) ? "     —" : v.toFixed(d).padStart(6));
const pct = (v: number | null) => (v == null ? "    —" : `${(v * 100).toFixed(1).padStart(4)}%`);

/** Quintile cut points of a sample: BUCKETS-1 interior boundaries. */
function cutPoints(values: number[], buckets = BUCKETS): number[] {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return [];
  const out: number[] = [];
  for (let k = 1; k < buckets; k++) {
    const pos = (s.length - 1) * (k / buckets);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    out.push(lo === hi ? s[lo] : s[lo] + (pos - lo) * (s[hi] - s[lo]));
  }
  return out;
}

/** Which bucket a value falls in, given interior cut points. */
function bucketOf(v: number, cuts: number[]): number {
  let i = 0;
  while (i < cuts.length && v >= cuts[i]) i++;
  return i;
}

function statsFor(rows: Tagged[], label: string, denominator: number): Stat {
  const rs = rows.map((r) => r.trade.rMultiple).filter((r): r is number => r != null && Number.isFinite(r));
  const wins = rows.filter((r) => r.trade.outcome === "win").length;
  return {
    label,
    trades: rows.length,
    symbols: new Set(rows.map((r) => r.trade.symbol)).size,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    winPct: rows.length ? wins / rows.length : null,
    sharePct: denominator ? (rows.length / denominator) * 100 : 0,
  };
}

function printTable(title: string, stats: Stat[]) {
  console.log(`\n  ${title}`);
  console.log("    bucket                 trades  symbols    avgR    win%   share");
  for (const s of stats) {
    console.log(
      `    ${s.label.padEnd(20)} ${String(s.trades).padStart(7)} ${String(s.symbols).padStart(8)}  ` +
        `${fmt(s.avgR)}  ${pct(s.winPct)}  ${s.sharePct.toFixed(0).padStart(4)}%`,
    );
  }
}

/** Run the baseline across one fold and tag every trade with the regime on its entry date. */
function runFold(
  panel: ReturnType<typeof loadPanel>,
  fold: Fold,
  regime: RegimeSeries,
  exit: PanelExit,
): Tagged[] {
  const slices = sliceFold(panel, fold);
  const out: Tagged[] = [];
  for (const s of slices) {
    // No `entry` callback: computeEntrySignals falls through to decideSetup(),
    // which IS the trend-pullback rule the desk runs. Using the desk's own
    // baseline rather than a research candidate keeps this a measurement of the
    // REGIME and not of some candidate's quirks.
    const signals = computeEntrySignals(s.candles);
    const r = simulateExits(s.symbol, s.candles, signals, {
      lot: exit.lot ?? PANEL_LOT,
      singleTarget: exit.singleTarget ?? true,
      tp1Mult: exit.tp1Mult,
      slMult: exit.slMult,
      trail: exit.trail,
      costs: exit.costs ?? DEFAULT_COST_MODEL,
      entryFrom: s.entryFrom,
    });
    for (const t of r.trades) {
      // openedAt, not closedAt: the gate would have to decide at entry, using
      // only what was on the screen that morning. Tagging by the exit date
      // would let the regime know how the trade turned out.
      const bar = regimeAt(regime, Math.floor(t.openedAt.getTime() / 1000));
      out.push({ trade: t, breadth: bar?.breadth ?? null, benchAbove: bar?.benchAbove ?? null, vol: bar?.realizedVol ?? null });
    }
  }
  return out;
}

async function main() {
  const ladderKey = (process.argv.find((a) => a.startsWith("--ladder="))?.split("=")[1] ?? "flat").trim();
  const exit = LADDERS[ladderKey];
  if (!exit) {
    console.error(`unknown --ladder=${ladderKey}; expected one of: ${Object.keys(LADDERS).join(", ")}`);
    process.exit(1);
  }

  console.log("loading panel cache…");
  const panel = loadPanel();
  console.log(`panel ${panel.symbols.length} symbols, fetchedAt ${panel.fetchedAt}`);
  // Printed, not silent: the sanitizer changes every number below it, so a log
  // that does not say what it removed is not reproducible from the cache alone.
  const dropped = Object.entries(panel.droppedBars).sort((a, b) => b[1] - a[1]);
  if (dropped.length) {
    const total = dropped.reduce((a, [, n]) => a + n, 0);
    console.log(
      `  dropped ${total} placeholder bar(s) (o==h==l==c, no volume) across ${dropped.length} symbol(s): ` +
        dropped.map(([sym, n]) => `${sym} ${n}`).join(", "),
    );
  }

  console.log(`building regime series from ${BENCHMARK} (trend ${TREND_PERIOD}d, vol ${VOL_PERIOD}d)…`);
  const regime = buildRegimeSeries(panel.bars);
  const usable = regime.bars.filter((b) => b.breadth != null && b.benchAbove != null);
  console.log(
    `regime ${regime.bars.length} sessions, ${usable.length} with a full trend window ` +
      `(median breadth denominator ${median(usable.map((b) => b.breadthN)).toFixed(0)} names)`,
  );

  // Cut points come from the FIT fold's SESSIONS — not from its trades, and not
  // from the whole series. Deriving them on all folds would let a boundary be
  // set by data the verdict is meant to be tested against.
  const fitFrom = Date.parse(`${FIT_FOLD.from}T00:00:00Z`) / 1000;
  const fitTo = Date.parse(`${FIT_FOLD.to}T00:00:00Z`) / 1000;
  const fitBars = regime.bars.filter((b) => b.t >= fitFrom && b.t < fitTo);
  const breadthCuts = cutPoints(fitBars.map((b) => b.breadth).filter((v): v is number => v != null));
  const volCuts = cutPoints(fitBars.map((b) => b.realizedVol).filter((v): v is number => v != null));

  console.log(`\nquintile cut points, derived from ${FIT_FOLD.name} sessions only (${fitBars.length} sessions):`);
  console.log(`  breadth  ${breadthCuts.map((v) => v.toFixed(3)).join("  ")}`);
  console.log(`  vol      ${volCuts.map((v) => v.toFixed(3)).join("  ")}`);
  console.log(`\nbaseline: trend-pullback (decideSetup), ladder "${ladderKey}" ` +
    `tp1 ${exit.tp1Mult} / sl ${exit.slMult}${exit.trail ? ` / trail ${exit.trail.activateMult}:${exit.trail.offsetMult}` : ""}, ` +
    `costs ${DEFAULT_COST_MODEL.slippageBps}bps slip + ${DEFAULT_COST_MODEL.commissionBps}bps comm`);

  for (const fold of Object.values(FOLDS)) {
    const started = process.hrtime.bigint();
    const tagged = runFold(panel, fold, regime, exit);
    const secs = Number(process.hrtime.bigint() - started) / 1e9;
    const n = tagged.length;
    const all = statsFor(tagged, "ALL", n);

    console.log(`\n${"=".repeat(78)}`);
    console.log(
      `${fold.name.toUpperCase()}  ${fold.from}..${fold.to}  (${fold.regime})  ` +
        `— ${n} trades, avgR ${fmt(all.avgR)}, ${secs.toFixed(0)}s`,
    );

    const untagged = tagged.filter((t) => t.breadth == null || t.benchAbove == null).length;
    if (untagged) console.log(`  ${untagged} trade(s) opened on a session with no regime reading — excluded from the buckets below`);
    const known = tagged.filter((t) => t.breadth != null && t.benchAbove != null);

    printTable("by breadth quintile (FIT cut points; low = few names above their SMA200)", [
      ...Array.from({ length: BUCKETS }, (_, b) =>
        statsFor(known.filter((t) => bucketOf(t.breadth!, breadthCuts) === b), `Q${b + 1} breadth`, n)),
      all,
    ]);

    printTable(`by ${BENCHMARK} vs its own SMA200`, [
      statsFor(known.filter((t) => t.benchAbove === true), "above", n),
      statsFor(known.filter((t) => t.benchAbove === false), "below", n),
      all,
    ]);

    const withVol = known.filter((t) => t.vol != null);
    printTable("by realized-vol quintile (FIT cut points; Q5 = most volatile)", [
      ...Array.from({ length: BUCKETS }, (_, b) =>
        statsFor(withVol.filter((t) => bucketOf(t.vol!, volCuts) === b), `Q${b + 1} vol`, n)),
      all,
    ]);
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log(
    "READ THIS BEFORE ACTING ON THE TABLE ABOVE\n" +
      "  - Buckets differing by a few hundredths of R on a few hundred trades is not a\n" +
      "    regime effect. The panel's own trade floor is 200 per fold, and its names are\n" +
      "    correlated at rho 0.24-0.47, so a bucket's N is worth well under its face value.\n" +
      "  - Breadth is computed on TODAY's index membership. It reads HIGH exactly where the\n" +
      "    real index was shedding names, and there is no matched control to cancel that\n" +
      "    here the way there is for a strategy's avgR.\n" +
      "  - A gradient that appears in FIT and not in SELECT is the same result the 13\n" +
      "    rejected confluence filters produced. Only a bucket ordering that holds in FIT,\n" +
      "    SELECT and all three TEST folds is worth turning into a gate.",
  );
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
