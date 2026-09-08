// The weekly deep hold-out: does the livable-fill weekly version survive
// dot-com, 2008, and the QE recovery?
//
// WHAT THIS RUN IS, AND WHAT IT IS NOT
//
// scripts/deep-holdout.mts already spent DEEP1-3 once, on 2026-09-05, on
// mr-down3 at DAILY bars and the close fill. It passed 3/3. So this run is NOT
// a virgin hold-out and it CANNOT re-establish "time-series mean reversion is
// real" — that question was answered on this data and the answer does not get
// to be re-earned by re-reading the same years.
//
// What it settles is narrower and is not answerable anywhere else in the
// project: whether the rules that cleared the WEEKLY screen at the fill the
// owner can actually place survive real bear-market structure. TEST1-3 span
// 2020-2026 and contain exactly one month of COVID crash and the 2022 drawdown.
// DEEP1 is the dot-com bust and the 2002 bottom; DEEP2 is the housing bubble,
// 2008, and the 2009 bottom. A buy-the-dip rule that only ever met V-shaped
// recoveries has not met its adversary. This run is where it does.
//
// The overlap with the daily run cuts one way that helps: the same folds, the
// same universe, the same ladder and seed, one variable moved. A weekly row
// that disagrees with its daily counterpart is a fact about bar class, and
// nothing else is different enough to explain it away.
//
// PRE-REGISTRATION — written before the first run, and not edited afterwards.
//
//   WHO IS UNDER TEST. Exactly the rules that cleared the pre-registered weekly
//   TEST criterion in scripts/weekly-test-rows.mts (beats the control median in
//   >= 2 of 3 TEST folds AND raw avgR > 0 in >= 2 of 3): mr-down3 and gap-fade.
//   Both, not one. gap-fade cleared the criterion at exactly 2/3 with a negative
//   TEST1, and I read it as the "beats a negative control while making nothing"
//   shape it has had since daily bars — but that reading was formed AFTER seeing
//   its numbers, and dropping it here on the strength of it would be moving a
//   criterion after the fact, which is the one thing this apparatus exists to
//   stop. It runs. It is judged by the same bar. Its own row answers it.
//
//   PASS, applied to each hypothesis independently:
//     (a) beats the control MEDIAN in >= 2 of 3 deep folds, AND
//     (b) beats the control P95  in >= 1 of 3, AND
//     (c) raw avgR > 0           in >= 2 of 3.
//   at DEFAULT_COST_MODEL.
//
//   (a) and (b) are scripts/deep-holdout.mts's daily bar copied line for line,
//   so a weekly verdict and a daily verdict mean the same thing. (c) is added,
//   and is the reason this bar is not the daily one: DEEP1 and DEEP2 are bear
//   markets where the random-entry control will be deeply negative, and "beats a
//   control that lost money" is a statement about the control. A rule that
//   clears (a) and (b) while losing money in two of three folds has not survived
//   anything an owner could hold.
//
//   ANYTHING LESS IS REJECTION for that rule. Not "inconclusive", not "the
//   ladder was wrong for that regime", not "retest without 2008". A rule that
//   fails here is finished on weekly bars, and nothing about it may be sized,
//   approved, or deployed afterwards.
//
//   NO OTHER ROWS. scripts/deep-holdout.mts printed its other eight mechanisms
//   as an audit trail and had to say in its own header that they were NOT A
//   MENU. This run does not print them at all. The audit value was real once;
//   a second showing of nine rows on the last untouched data is a menu no matter
//   what the caption says, and the daily log already holds that context for
//   anyone who wants to read the two side by side.
//
//   SURVIVORSHIP (second pre-registered test, mr-down3 only — see section 2).
//
// EXACTLY ONE THING DIFFERS from scripts/weekly-test-rows.mts: the folds. Bar
//   class, fill, ladder, seed, control count, fold warm-up, cost models and
//   checks are the same objects and the same values.
//
// FILL. Decided at the close of weekly bar i, filled at the open of weekly bar
//   i+1 (shift1 + entryAt "open"). NO CLOSE-FILL NUMBER IS PRINTED AS A RESULT.
//
// COST MODEL. DEFAULT_COST_MODEL (0.5bps slip + 1bp comm) decides. A 5bps+1bp
//   retail block is printed as a separate pre-registered statement.
//
// WARM-UP. WEEKLY_PANEL_WARMUP_BARS = 104 weekly bars is two years, and
//   DEEP_CACHE_START (1998-01-01) sits exactly two years before deep1's
//   2000-01-01 start. deep1 is the fold that can only just pay it; if the cache
//   is short, the participation line will say so.
//
// RESAMPLER CHECK. weeklyPanel re-derives every weekly bar from its daily
//   source and compares field by field. It throws; this script does not catch it.
//
// VOIDING CHECK. The fraction of weekly bars where open != close must be >= 0.99.
//
//   npx tsx scripts/weekly-deep-holdout.mts --checks-only
//   npx tsx scripts/weekly-deep-holdout.mts | tee scripts/weekly-deep-holdout.log
//
import "dotenv/config";
import {
  loadPanel, DEEP_FOLD_LIST, DEEP_PANEL_CACHE_PATH, FOLDS, type Fold, type Panel,
} from "@/lib/research/panel";
import { weeklyPanel, WEEKLY_PANEL_WARMUP_BARS } from "@/lib/research/weekly";
import {
  sliceFold, withSignals, simulateFold, runControl, CONTROL_RUNS, PANEL_SEED, MIN_PANEL_TRADES,
  type FoldSliceRow, type PanelExit, type PreparedSymbol,
} from "@/lib/research/panelRun";
import { LADDERS, mechanismByKey, type Mechanism } from "@/lib/research/mechanisms";
import { computeEntrySignals, WARMUP, type EntrySignals } from "@/lib/backtest/engine";
import type { Candle } from "@/lib/indicators";

/** The rules that cleared the weekly TEST criterion. Both are under test; neither is context. */
const HYPOTHESES = ["mr-down3", "gap-fade"] as const;

/** The survivorship diagnostic is about mean reversion's dip-buying, so it runs on the dip-buyer. */
const SURVIVORSHIP_SUBJECT = "mr-down3";
const SURVIVORSHIP_BUCKETS = 4;

const EXIT = LADDERS.flat;
const RETAIL_COSTS = { slippageBps: 5, commissionBps: 1 };
const MIN_OPEN_DIFFERS = 0.99;

const HOLD_MIN_MEDIAN = 2;
const HOLD_MIN_P95 = 1;
const HOLD_MIN_POSITIVE = 2;

/** Push every signal one bar later, so a close-derived decision fills at the next open. */
const shift1 = (s: EntrySignals): EntrySignals => {
  const sides: EntrySignals["sides"] = new Array(s.sides.length).fill(null);
  for (let i = 0; i + 1 < s.sides.length; i++) sides[i + 1] = s.sides[i];
  return { sides, atrs: s.atrs };
};

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** VOIDING CHECK. If a week collapsed to one print, entryAt "open" means nothing. */
function openDiffersFraction(panel: Panel): number {
  let bars = 0;
  let differs = 0;
  for (const symbol of panel.symbols) {
    for (const b of panel.bars[symbol]) {
      bars++;
      if (b.o !== b.c) differs++;
    }
  }
  return bars ? differs / bars : NaN;
}

/** Realised 1R as a fraction of price on the bars a rule fires on. */
function medianSignalR(prepared: PreparedSymbol[], slMult: number): number {
  const rs: number[] = [];
  for (const p of prepared) {
    const { sides, atrs } = p.signals;
    for (let i = 0; i < atrs.length; i++) {
      if (!sides[i]) continue;
      const r = (slMult * atrs[i]) / p.candles[i]?.c;
      if (r > 0 && r < 1) rs.push(r);
    }
  }
  rs.sort((a, b) => a - b);
  return quantile(rs, 0.5);
}

interface Row {
  fold: Fold;
  trades: number;
  symbolsTraded: number;
  avgR: number | null;
  /** BacktestSummary.winRate is already a PERCENT (0-100), not a fraction. Do not multiply it. */
  winRate: number;
  ctrlMed: number | null;
  ctrlP95: number | null;
  medianR: number;
}

/** Signals for one fold at the livable fill: decided on bar i, pushed to fill at bar i+1's open. */
function livablePrepared(slices: FoldSliceRow[], mech: Mechanism): PreparedSymbol[] {
  return withSignals(slices, (_sym, candles) =>
    computeEntrySignals(candles, undefined, mech.rule ? mech.rule(candles) : undefined),
  ).map((p) => ({ ...p, signals: shift1(p.signals) }));
}

function runRow(prepared: PreparedSymbol[], fold: Fold, exit: PanelExit): Omit<Row, "fold"> {
  const run = simulateFold(prepared, fold, exit);
  const ctrl = runControl(prepared, fold, exit, CONTROL_RUNS, PANEL_SEED);
  return {
    trades: run.trades.length,
    symbolsTraded: run.symbolsTraded,
    avgR: run.summary.avgR,
    winRate: run.summary.winRate,
    ctrlMed: ctrl?.median ?? null,
    ctrlP95: ctrl?.p95 ?? null,
    medianR: medianSignalR(prepared, exit.slMult),
  };
}

const f3 = (v: number | null) => (v == null || !Number.isFinite(v) ? "    —" : v.toFixed(3).padStart(7));

function printHeader(): void {
  console.log("    fold      trades  symbols     avgR     win%   ctrl med  ctrl p95   margin      1R  verdict");
}

function printRow(r: Row): void {
  const margin = r.avgR != null && r.ctrlMed != null ? r.avgR - r.ctrlMed : null;
  const verdict = margin == null ? "no-control" : margin > 0 ? "beats-median" : "LOSES-to-median";
  const p95 = r.avgR != null && r.ctrlP95 != null && r.avgR > r.ctrlP95 ? " +p95" : "";
  const thin = r.trades < MIN_PANEL_TRADES ? "  BELOW-TRADE-FLOOR" : "";
  console.log(
    `    ${r.fold.name.padEnd(8)}${String(r.trades).padStart(8)}${String(r.symbolsTraded).padStart(9)}  ` +
      `${f3(r.avgR)}  ${r.winRate.toFixed(1).padStart(5)}%  ` +
      `${f3(r.ctrlMed)}  ${f3(r.ctrlP95)}  ${f3(margin)}  ${(100 * r.medianR).toFixed(2).padStart(6)}%  ${verdict}${p95}${thin}`,
  );
}

/**
 * A symbol's annualised return over whatever part of the deep window it traded.
 *
 * ANNUALISED, not total, because the S&P names that listed later would rank
 * below the ones that listed earlier purely for having existed less. The
 * question the bucket asks is "did this name compound well", and that is a rate.
 *
 * Hindsight by construction — the bucket is knowable only at the end of the
 * window. That is the point: survivorship IS hindsight, and the only way to
 * measure what it is worth is to hand it to the rule deliberately.
 */
function annualisedReturn(bars: Candle[]): number | null {
  if (bars.length < 2) return null;
  const first = bars[0], last = bars[bars.length - 1];
  if (!(first.c > 0) || !(last.c > 0)) return null;
  const years = (last.t - first.t) / (365.25 * 86_400);
  if (years < 1) return null;
  return (last.c / first.c) ** (1 / years) - 1;
}

const meanFinite = (xs: number[]) => {
  const ok = xs.filter((x) => Number.isFinite(x));
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : NaN;
};

async function main() {
  const checksOnly = process.argv.includes("--checks-only");

  console.log("weekly deep hold-out — mr-down3 and gap-fade on 2000-2016, weekly bars, livable fill");
  console.log("PRE-REGISTERED: see this script's header. DEEP1-3 were already spent once on mr-down3 at");
  console.log("DAILY bars (scripts/deep-holdout.log, 2026-09-05, passed 3/3), so this is not a virgin");
  console.log("hold-out. What it can settle is whether the weekly version survives 2000-2002 and 2008.");

  console.log("\nloading deep panel cache…");
  const daily = loadPanel(DEEP_PANEL_CACHE_PATH);
  console.log(`panel ${daily.cachePath} — ${daily.symbols.length} symbols, fetchedAt ${daily.fetchedAt}`);
  const dropped = Object.entries(daily.droppedBars).sort((a, b) => b[1] - a[1]);
  if (dropped.length) {
    const total = dropped.reduce((a, [, n]) => a + n, 0);
    console.log(`  dropped ${total} placeholder bar(s) across ${dropped.length} symbol(s): ` +
      dropped.slice(0, 12).map(([sym, n]) => `${sym} ${n}`).join(", ") + (dropped.length > 12 ? ", …" : ""));
  }

  // RESAMPLER CHECK — inside weeklyPanel; it throws, and nothing catches it.
  console.log("\nresampling to weekly bars (every bar asserted against its daily source)…");
  const weekly = weeklyPanel(daily);
  const totalWeeks = weekly.symbols.reduce((a, s) => a + weekly.bars[s].length, 0);
  console.log(`RESAMPLER CHECK: pass — ${weekly.symbols.length} symbols, ${totalWeeks} weekly bars from ${weekly.cachePath}`);

  // VOIDING CHECK.
  const frac = openDiffersFraction(weekly);
  console.log(`VOIDING CHECK (weekly bars with open != close): ${(100 * frac).toFixed(2)}% ` +
    `— bar is ${(100 * MIN_OPEN_DIFFERS).toFixed(0)}%`);
  if (!(frac >= MIN_OPEN_DIFFERS)) {
    console.error("aborting: VOID. A weekly bar whose open equals its close makes the livable fill identical to the close fill.");
    process.exit(1);
  }

  console.log(`\ndeep folds all end before FIT begins (${FOLDS.fit.from}):`);
  for (const f of DEEP_FOLD_LIST) console.log(`  ${f.name}  ${f.from}..${f.to}  — ${f.regime}`);

  const slices = new Map<string, FoldSliceRow[]>();
  for (const fold of DEEP_FOLD_LIST) {
    const s = sliceFold(weekly, fold, weekly.symbols, WEEKLY_PANEL_WARMUP_BARS);
    slices.set(fold.name, s);
    const tradable = s.length ? s[0].candles.length - s[0].entryFrom : 0;
    console.log(`  ${fold.name}: ${s.length} symbols participate, ` +
      `${s.length ? s[0].entryFrom : 0} warm-up + ${tradable} tradable weekly bars (first symbol)`);
  }

  if (checksOnly) {
    console.log("\n--checks-only: stopping before the hold-out.");
    return;
  }

  console.log(`\nfill: decided at the close of weekly bar i, filled at the open of bar i+1`);
  console.log(`ladder=flat tp1=${EXIT.tp1Mult} sl=${EXIT.slMult}  control=${CONTROL_RUNS} runs  seed=${PANEL_SEED}  ` +
    `engine WARMUP=${WARMUP} bars  fold warm-up=${WEEKLY_PANEL_WARMUP_BARS} weekly bars  trade floor=${MIN_PANEL_TRADES}`);

  const blocks: { label: string; exit: PanelExit; decides: boolean }[] = [
    { label: "DEFAULT_COST_MODEL (0.5bps slip + 1bp comm) — THIS BLOCK DECIDES", exit: { ...EXIT, entryAt: "open" }, decides: true },
    { label: "retail (5bps slip + 1bp comm) — pre-registered second statement", exit: { ...EXIT, entryAt: "open", costs: RETAIL_COSTS }, decides: false },
  ];

  // -------------------------------------------------------------------------
  // 1. The hold-out table.
  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(120)}\n1. WEEKLY DEEP HOLD-OUT — two hypotheses, no audit rows\n${"=".repeat(120)}`);

  const decidingRows = new Map<string, Row[]>();

  for (const block of blocks) {
    console.log(`\n${"-".repeat(120)}\n${block.label}\n${"-".repeat(120)}`);
    for (const key of HYPOTHESES) {
      const mech = mechanismByKey(key);
      if (!mech.rule) throw new Error(`${key} has no rule; this run cannot proceed`);
      if (mech.entryAt) throw new Error(`${key} pins entryAt=${mech.entryAt}; the livable fill would not be the fill under test`);
      console.log(`\n${mech.key}`);
      console.log(`  ${mech.blurb}`);
      printHeader();
      const rows: Row[] = [];
      for (const fold of DEEP_FOLD_LIST) {
        const prepared = livablePrepared(slices.get(fold.name)!, mech);
        const r: Row = { fold, ...runRow(prepared, fold, block.exit) };
        printRow(r);
        rows.push(r);
      }
      if (block.decides) decidingRows.set(key, rows);
    }
  }

  // -------------------------------------------------------------------------
  // 2. Survivorship diagnostic.
  //
  // PRE-REGISTERED, fixed before the run, and the same rule scripts/deep-holdout.mts
  // used on daily bars so the two verdicts are comparable:
  //
  //   The S&P 500 list in universe.ts is TODAY's membership, so every name in it
  //   is a survivor and every dip it ever had was, in fact, bought. That flatters
  //   a buy-the-dip rule more than it flatters a random-entry control, which does
  //   not aim at dips. Measure it rather than assume it.
  //
  //   REJECT, whatever the aggregate said: mean margin over the control median is
  //   positive ONLY in the top quartile and <= 0 in the bottom. That is an edge
  //   that is really the index's own drift concentrated in the names that made it.
  //
  //   WINNER-DRIFT OBJECTION FALLS: margin positive in the bottom quartile as
  //   well as the top.
  //
  //   WHAT THIS DOES NOT COVER either way: every symbol here is a symbol that
  //   still exists. Bucketing survivors by how well they did measures winner
  //   DRIFT; it cannot measure the names that left. Lehman and WorldCom are not
  //   in a low quartile, they are not in the universe at all. MEMBERSHIP
  //   survivorship stays open no matter how flat the quartiles come out.
  //
  //   Anything else — positive in the middle only, mixed by fold — is MIXED and
  //   read as neither.
  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(120)}\n2. SURVIVORSHIP DIAGNOSTIC — ${SURVIVORSHIP_SUBJECT} by the symbol's own deep-window return\n${"=".repeat(120)}`);

  const subject = mechanismByKey(SURVIVORSHIP_SUBJECT);
  const decidingExit = blocks[0].exit;
  const ranked = weekly.symbols
    .map((s) => ({ symbol: s, cagr: annualisedReturn(weekly.bars[s] ?? []) }))
    .filter((x): x is { symbol: string; cagr: number } => x.cagr != null)
    .sort((a, b) => a.cagr - b.cagr);

  // Proportional boundaries, not a fixed width: a fixed width drops len % B
  // symbols off the TOP of the ranking — the best performers, the exact names
  // the winners-bounce objection is about.
  const bound = (q: number) => Math.floor((q * ranked.length) / SURVIVORSHIP_BUCKETS);
  console.log(`${ranked.length} symbols with >= 1y of deep history, ` +
    `${Array.from({ length: SURVIVORSHIP_BUCKETS }, (_, q) => bound(q + 1) - bound(q)).join("/")} per quartile ` +
    `(every symbol in exactly one bucket, none dropped)`);

  const quartileMargins: number[][] = [];
  for (let q = 0; q < SURVIVORSHIP_BUCKETS; q++) {
    const bucket = ranked.slice(bound(q), bound(q + 1));
    const label = q === 0 ? "Q1 (worst compounders)" : q === SURVIVORSHIP_BUCKETS - 1 ? `Q${q + 1} (best compounders)` : `Q${q + 1}`;
    console.log(`\n${SURVIVORSHIP_SUBJECT} · ${label}`);
    console.log(`  annualised return ${(bucket[0].cagr * 100).toFixed(1)}% .. ${(bucket[bucket.length - 1].cagr * 100).toFixed(1)}%`);
    printHeader();
    const margins: number[] = [];
    for (const fold of DEEP_FOLD_LIST) {
      const slice = sliceFold(weekly, fold, bucket.map((b) => b.symbol), WEEKLY_PANEL_WARMUP_BARS);
      const r: Row = { fold, ...runRow(livablePrepared(slice, subject), fold, decidingExit) };
      printRow(r);
      margins.push(r.avgR != null && r.ctrlMed != null ? r.avgR - r.ctrlMed : NaN);
    }
    quartileMargins.push(margins);
  }

  // -------------------------------------------------------------------------
  // 3. Verdict, read mechanically against the two pre-registered rules.
  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(120)}\n3. VERDICT\n${"=".repeat(120)}`);

  const n = DEEP_FOLD_LIST.length;
  console.log(`\nhold-out bar: beats control median >= ${HOLD_MIN_MEDIAN}/${n} AND beats control p95 >= ${HOLD_MIN_P95}/${n} ` +
    `AND raw avgR > 0 >= ${HOLD_MIN_POSITIVE}/${n}, at DEFAULT_COST_MODEL`);
  for (const key of HYPOTHESES) {
    const rows = decidingRows.get(key)!;
    const med = rows.filter((r) => r.avgR != null && r.ctrlMed != null && r.avgR > r.ctrlMed).length;
    const p95 = rows.filter((r) => r.avgR != null && r.ctrlP95 != null && r.avgR > r.ctrlP95).length;
    const pos = rows.filter((r) => r.avgR != null && r.avgR > 0).length;
    const thin = rows.filter((r) => r.trades < MIN_PANEL_TRADES).length;
    const pass = med >= HOLD_MIN_MEDIAN && p95 >= HOLD_MIN_P95 && pos >= HOLD_MIN_POSITIVE && thin === 0;
    console.log(`  ${key.padEnd(10)} beats median ${med}/${n}   beats p95 ${p95}/${n}   avgR>0 ${pos}/${n}` +
      `${thin ? `   ${thin} fold(s) BELOW TRADE FLOOR` : ""}   -> ${pass ? "PASS" : "REJECT"}`);
  }

  console.log(`\nsurvivorship rule: mean margin over the control median, averaged across the three deep folds`);
  quartileMargins.forEach((m, q) => console.log(`  Q${q + 1}: ${f3(meanFinite(m))}`));
  const bottom = meanFinite(quartileMargins[0]);
  const top = meanFinite(quartileMargins[SURVIVORSHIP_BUCKETS - 1]);
  console.log(`  -> ${
    top > 0 && bottom <= 0
      ? "REJECT — positive only where the names compounded; this is the index's drift, not an edge"
      : bottom > 0 && top > 0
        ? "WINNER-DRIFT OBJECTION FALLS — the rule works on the worst compounders too " +
          "(MEMBERSHIP survivorship is NOT tested here and stays open)"
        : "MIXED — neither pre-registered signature; read as neither"
  }`);

  console.log(`\nBoth rules were written into the header of this file before it was first run. A REJECT here`);
  console.log(`closes that mechanism on weekly bars; it is not a request for a different ladder or a fold to drop.`);
}

await main();
