// The deep hold-out: does mr-down3 survive sixteen years the panel has never seen?
//
// WHY THIS EXISTS
//
// mr-down3 — long after three consecutive lower closes, zero fitted parameters —
// is the only rule in this repo that both makes money and beats its matched
// random-entry control. Across two ticker-DISJOINT universes it beat the control
// median in 9 of 10 fold-cells and had positive raw avgR in 5/5 folds on each,
// while the desk's own baseline lost to the median 10/10. It fails exactly one
// fold, SELECT, and SELECT is a single melt-up year (2019) whose control median
// is +0.146 against FIT's +0.078 — the same fold that killed the ATR trail.
//
// That is a promising row and it is NOT a result, because three of its four
// winning cells are TEST folds whose numbers have already been read. Selecting a
// rule on numbers you have already seen is how research-29 reached the desk and
// lost -3.46R. The hold-out has to be data that was never part of any decision.
//
// THAT DATA EXISTS AND IS FREE. Every symbol in .cache/bars/sp500-1d.json starts
// on 2016-01-04 — Alpaca's equity inception, not the stocks' history. Yahoo
// serves the same names back to the 1990s and has never been asked, because
// marketData.ts only falls through to it when a provider ERRORS and Alpaca does
// not error. scripts/cache-deep-history.mts fetches the years underneath into a
// separate cache; DEEP_FOLDS in research/panel.ts cuts them into three windows,
// all strictly earlier than FIT. ~6,400 symbol-years, against the ~5,200 this
// project has used in total.
//
// PRE-REGISTRATION — written before the first run, and not edited afterwards.
//
//   HYPOTHESIS (one, not nine): mr-down3 has a real time-series mean-reversion
//   edge in US large caps.
//
//   PASS: beats the control MEDIAN in >= 2 of 3 deep folds AND beats the control
//   P95 in >= 1 of 3.
//
//   ANYTHING LESS IS REJECTION, and mean reversion closes as a family. Not
//   "inconclusive", not "retest on a different ladder", not "try 2 days instead
//   of 3". The rule already had five folds on two universes to be interesting
//   on; this is the confirmation, and a confirmation that can only pass is not
//   one.
//
//   The other eight mechanism rows are printed as an AUDIT TRAIL so the verdict
//   can be read against its own context from one log. They are NOT A MENU. None
//   of them is under test here, and none may be promoted out of this run —
//   picking the best of nine rows on the last untouched data in the project is
//   precisely the failure this whole apparatus exists to prevent. If one of them
//   looks interesting, that is a NEW pre-registration on data that does not
//   exist yet.
//
//   SURVIVORSHIP (second pre-registered test, same run — see below).
//
// WHY THE LADDER AND SEED ARE NOT FLAGS HERE
//
// The flat 1.2/1.5 ladder and PANEL_SEED are the ones mechanism-screen ran, so
// every row below is directly comparable to scripts/mechanism-screen-control.log
// line for line. LADDERS and MECHANISMS are IMPORTED from
// src/lib/research/mechanisms.ts — the same objects that screen ran, not copies
// of them, so the two logs cannot drift apart.
//
//   npx tsx scripts/deep-holdout.mts | tee scripts/deep-holdout.log
//   npx tsx scripts/deep-holdout.mts --control=20      (fast smoke run, NOT a result)
//
import "dotenv/config";
import {
  loadPanel, DEEP_FOLD_LIST, DEEP_PANEL_CACHE_PATH, FOLDS, type Fold,
} from "@/lib/research/panel";
import {
  sliceFold, withSignals, simulateFold, runControl, CONTROL_RUNS, PANEL_SEED,
  type FoldSliceRow,
} from "@/lib/research/panelRun";
import { LADDERS, MECHANISMS, mechanismByKey, type Mechanism } from "@/lib/research/mechanisms";
import { computeEntrySignals, WARMUP } from "@/lib/backtest/engine";
import type { Candle } from "@/lib/indicators";

/** The one row under test. Everything else printed is context. */
const HYPOTHESIS = "mr-down3";

const EXIT = LADDERS.flat;

/** Quartiles, so "top" and "bottom" each hold a quarter of the names. */
const SURVIVORSHIP_BUCKETS = 4;

interface Row {
  fold: Fold;
  trades: number;
  symbolsTraded: number;
  avgR: number | null;
  winRate: number;
  controlMed: number | null;
  controlP95: number | null;
}

const fmt = (v: number | null, d = 3) => (v == null || !Number.isFinite(v) ? "     —" : v.toFixed(d).padStart(6));
const signOf = (v: number | null) => (v == null ? "?" : v > 0 ? "+" : v < 0 ? "-" : "0");

/** One mechanism over one fold, with its matched control. */
function runCell(
  mech: Mechanism,
  slice: FoldSliceRow[],
  fold: Fold,
  controlRuns: number,
): Row {
  const prepared = withSignals(slice, (_sym, candles) =>
    computeEntrySignals(candles, undefined, mech.rule ? mech.rule(candles) : undefined),
  );
  // The control gets the SAME exit object, so it fills where the rule fills.
  const exit = mech.entryAt ? { ...EXIT, entryAt: mech.entryAt } : EXIT;
  const run = simulateFold(prepared, fold, exit);
  const ctrl = controlRuns > 0 ? runControl(prepared, fold, exit, controlRuns, PANEL_SEED) : null;
  return {
    fold,
    trades: run.trades.length,
    symbolsTraded: run.symbolsTraded,
    avgR: run.summary.avgR,
    winRate: run.summary.winRate,
    controlMed: ctrl?.median ?? null,
    controlP95: ctrl?.p95 ?? null,
  };
}

function printRows(label: string, blurb: string, rows: Row[]) {
  console.log(`\n${label}`);
  if (blurb) console.log(`  ${blurb}`);
  console.log("    fold      trades  symbols    avgR     win%   ctrl med  ctrl p95   margin");
  for (const r of rows) {
    const margin = r.avgR != null && r.controlP95 != null ? r.avgR - r.controlP95 : null;
    const beat = r.avgR != null && r.controlMed != null ? (r.avgR > r.controlMed ? "  beats-median" : "  LOSES-to-median") : "";
    console.log(
      `    ${r.fold.name.padEnd(8)} ${String(r.trades).padStart(7)} ${String(r.symbolsTraded).padStart(8)}  ` +
        `${fmt(r.avgR)}  ${r.winRate.toFixed(1).padStart(5)}%  ${fmt(r.controlMed)}   ${fmt(r.controlP95)}   ${fmt(margin)}${beat}`,
    );
  }
  console.log(`    signs ${rows.map((r) => signOf(r.avgR)).join("")}`);
}

/**
 * A symbol's annualised return over whatever part of the deep window it traded.
 *
 * ANNUALISED, not total, because ~14 of every 50 S&P names listed after 2000 and
 * a total return would rank a 2012 listing below a 2000 one purely for having
 * existed less. The question the bucket asks is "did this name compound well",
 * and that is a rate.
 *
 * This is hindsight by construction — the bucket is knowable only at the end of
 * the window. That is the entire point: survivorship IS hindsight, and the only
 * way to measure what it is worth is to hand it to the rule deliberately and see
 * whether the rule needs it.
 */
function annualisedReturn(bars: Candle[]): number | null {
  if (bars.length < 2) return null;
  const first = bars[0], last = bars[bars.length - 1];
  if (!(first.c > 0) || !(last.c > 0)) return null;
  const years = (last.t - first.t) / (365.25 * 86_400);
  if (years < 1) return null;
  return (last.c / first.c) ** (1 / years) - 1;
}

async function main() {
  const controlRuns = Number(process.argv.find((a) => a.startsWith("--control="))?.split("=")[1] ?? CONTROL_RUNS);

  console.log("loading deep panel cache…");
  const panel = loadPanel(DEEP_PANEL_CACHE_PATH);
  console.log(`panel ${panel.cachePath} — ${panel.symbols.length} symbols, fetchedAt ${panel.fetchedAt}`);
  const dropped = Object.entries(panel.droppedBars).sort((a, b) => b[1] - a[1]);
  if (dropped.length) {
    const total = dropped.reduce((a, [, n]) => a + n, 0);
    console.log(
      `  dropped ${total} placeholder bar(s) across ${dropped.length} symbol(s): ` +
        dropped.slice(0, 12).map(([sym, n]) => `${sym} ${n}`).join(", ") +
        (dropped.length > 12 ? `, …` : ""),
    );
  }
  console.log(
    `ladder=flat ${JSON.stringify(EXIT.trail ?? "no trail")}  control=${controlRuns}  seed=${PANEL_SEED}  WARMUP=${WARMUP}`,
  );
  console.log(`deep folds all end before FIT begins (${FOLDS.fit.from}):`);
  for (const f of DEEP_FOLD_LIST) console.log(`  ${f.name}  ${f.from}..${f.to}  — ${f.regime}`);

  // Cut once, share across every mechanism: slicing is per-fold, signals are
  // per-mechanism, and nine passes over the cache would produce identical slices.
  const slices = new Map<string, FoldSliceRow[]>();
  for (const fold of DEEP_FOLD_LIST) {
    const s = sliceFold(panel, fold);
    slices.set(fold.name, s);
    console.log(`  ${fold.name}: ${s.length} symbols participate`);
  }

  // -------------------------------------------------------------------------
  // 1. The hold-out table.
  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(78)}\n1. DEEP HOLD-OUT — one hypothesis (${HYPOTHESIS}), eight audit rows\n${"=".repeat(78)}`);

  const hypothesisRows: Row[] = [];
  for (const mech of MECHANISMS) {
    const rows = DEEP_FOLD_LIST.map((fold) => runCell(mech, slices.get(fold.name)!, fold, controlRuns));
    printRows(mech.key === HYPOTHESIS ? `${mech.key}   <-- THE HYPOTHESIS` : `${mech.key}   (audit row, not under test)`, mech.blurb, rows);
    if (mech.key === HYPOTHESIS) hypothesisRows.push(...rows);
  }

  // -------------------------------------------------------------------------
  // 2. Survivorship diagnostic.
  //
  // PRE-REGISTERED, fixed before the run:
  //
  //   The S&P 500 list in universe.ts is TODAY's membership, so every name in it
  //   is a 26-year survivor and every dip it ever had was, in fact, bought. That
  //   flatters a buy-the-dip rule more than it flatters the random-entry control,
  //   which does not aim at dips — so PANEL_SURVIVORSHIP_CAVEAT's claim that the
  //   margin cancels the bias is true for a LEVEL and not obviously true here.
  //   Measure it rather than assume it.
  //
  //   There are no delisted names to compare against, so use the survivors' own
  //   spread as a proxy: bucket by each symbol's annualised return over its own
  //   deep-window history, and run the hypothesis inside each quartile.
  //
  //   REJECT, whatever the aggregate said: margin over the control median is
  //   positive ONLY in the top quartile and <= 0 in the bottom. That is the
  //   signature of an edge that is really the index's own drift concentrated in
  //   the names that made it.
  //
  //   WINNER-DRIFT OBJECTION FALLS: margin positive in the bottom quartile as
  //   well as the top. A rule that works on the losers is not living on the fact
  //   that the winners won.
  //
  //   WHAT THIS VERDICT DOES NOT COVER, whichever way it lands. Every symbol in
  //   this test is a symbol that still exists. Bucketing survivors by how well
  //   they did measures winner DRIFT; it cannot measure the names that left —
  //   Lehman, WorldCom, Bear Stearns are not in a low quartile, they are not in
  //   the universe at all. Membership survivorship is untouched by this test and
  //   stays open no matter how flat the quartiles come out. Naming the verdict
  //   after the whole family of objections is what would overstate it.
  //
  //   Anything else — positive in the middle only, mixed by fold — is reported
  //   as MIXED and read as neither.
  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(78)}\n2. SURVIVORSHIP DIAGNOSTIC — ${HYPOTHESIS} by the symbol's own deep-window return\n${"=".repeat(78)}`);

  const mech = mechanismByKey(HYPOTHESIS);
  const ranked = panel.symbols
    .map((s) => ({ symbol: s, cagr: annualisedReturn(panel.bars[s] ?? []) }))
    .filter((x): x is { symbol: string; cagr: number } => x.cagr != null)
    .sort((a, b) => a.cagr - b.cagr);

  // Proportional boundaries, not a fixed width: `Math.floor(len / B)` per bucket
  // leaves `len % B` symbols over, and slicing `q*per .. (q+1)*per` drops them
  // off the TOP of the ranking — the best performers in the universe, the exact
  // names the winners-bounce objection is about. These boundaries partition the
  // whole list, with buckets differing by at most one symbol.
  const bound = (q: number) => Math.floor((q * ranked.length) / SURVIVORSHIP_BUCKETS);
  console.log(
    `${ranked.length} symbols with >= 1y of deep history, ` +
      `${Array.from({ length: SURVIVORSHIP_BUCKETS }, (_, q) => bound(q + 1) - bound(q)).join("/")} per quartile ` +
      `(every symbol in exactly one bucket, none dropped)`,
  );

  const quartileMedianMargins: number[][] = [];
  for (let q = 0; q < SURVIVORSHIP_BUCKETS; q++) {
    const bucket = ranked.slice(bound(q), bound(q + 1));
    const label = `Q${q + 1}${q === 0 ? " (worst compounders)" : q === SURVIVORSHIP_BUCKETS - 1 ? " (best compounders)" : ""}`;
    const rows = DEEP_FOLD_LIST.map((fold) =>
      runCell(mech, sliceFold(panel, fold, bucket.map((b) => b.symbol)), fold, controlRuns),
    );
    printRows(
      `${HYPOTHESIS} · ${label}`,
      `annualised return ${(bucket[0].cagr * 100).toFixed(1)}% .. ${(bucket[bucket.length - 1].cagr * 100).toFixed(1)}%`,
      rows,
    );
    quartileMedianMargins.push(
      rows.map((r) => (r.avgR != null && r.controlMed != null ? r.avgR - r.controlMed : NaN)),
    );
  }

  // -------------------------------------------------------------------------
  // 3. Verdict, read mechanically against the two rules above.
  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(78)}\n3. VERDICT\n${"=".repeat(78)}`);

  const beatMedian = hypothesisRows.filter((r) => r.avgR != null && r.controlMed != null && r.avgR > r.controlMed).length;
  const beatP95 = hypothesisRows.filter((r) => r.avgR != null && r.controlP95 != null && r.avgR > r.controlP95).length;
  const n = hypothesisRows.length;
  const holdoutPass = beatMedian >= 2 && beatP95 >= 1;

  console.log(`\nhold-out rule: beats control median >= 2/${n} AND beats control p95 >= 1/${n}`);
  console.log(`  beats median: ${beatMedian}/${n}   beats p95: ${beatP95}/${n}`);
  console.log(`  -> ${holdoutPass ? "PASS" : "REJECT"}`);

  const meanMargin = (xs: number[]) => {
    const ok = xs.filter((x) => Number.isFinite(x));
    return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : NaN;
  };
  const bottom = meanMargin(quartileMedianMargins[0]);
  const top = meanMargin(quartileMedianMargins[SURVIVORSHIP_BUCKETS - 1]);
  console.log(`\nsurvivorship rule: mean margin over control median, averaged across the three deep folds`);
  quartileMedianMargins.forEach((m, q) => console.log(`  Q${q + 1}: ${fmt(meanMargin(m))}`));
  const survivorship =
    top > 0 && bottom <= 0
      ? "REJECT — positive only where the names compounded; this is the index's drift, not an edge"
      : bottom > 0 && top > 0
        ? "WINNER-DRIFT OBJECTION FALLS — the rule works on the worst compounders too " +
          "(delisting survivorship is NOT tested here and stays open)"
        : "MIXED — neither pre-registered signature; read as neither";
  console.log(`  -> ${survivorship}`);

  console.log(
    `\nBoth rules were written into the header of this file before it was first run.\n` +
      `The eight non-${HYPOTHESIS} rows above are an audit trail. Promoting one of them from\n` +
      `this log would spend the last untouched data in the project on a rule chosen after\n` +
      `seeing its numbers, which is the exact mistake this run exists to avoid.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
