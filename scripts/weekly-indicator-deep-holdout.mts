// The weekly indicator deep hold-out: do RSI(14) 30/70 and Bollinger(20,2)
// survive dot-com, 2008, and the QE recovery as standalone entries?
//
// WHAT THIS RUN IS, AND WHAT IT IS NOT
//
// This is the THIRD read of DEEP1-3. scripts/deep-holdout.mts spent them on
// 2026-09-05 (mr-down3, daily bars, close fill — passed 3/3) and
// scripts/weekly-deep-holdout.mts spent them again on 2026-09-08 (mr-down3 and
// gap-fade, weekly bars, livable fill — both REJECT). So these years are not
// virgin data and this run CANNOT establish anything general: not "mean
// reversion is real", not "indicators work". Every broad claim these folds could
// support has already been paid for and spent.
//
// What it settles is narrow and is not answerable anywhere else: whether the two
// rules that cleared the pre-registered weekly screen AND its TEST criterion —
// rsi-band and bb-revert — survive real bear-market structure. TEST1-3 span
// 2020-2026 and contain one month of COVID crash and the 2022 drawdown. DEEP1 is
// the dot-com bust and the 2002 bottom; DEEP2 is the housing bubble, 2008 and the
// 2009 bottom. A fade rule that has only ever met V-shaped recoveries has not met
// its adversary. This is where it does, and it is the last thing these folds are
// spent on without the owner deciding otherwise again.
//
// PRE-REGISTRATION — written before the first run, and not edited afterwards.
//
//   WHO IS UNDER TEST. Exactly the rules that cleared the weekly indicator screen
//   (scripts/weekly-indicator-screen.mts: beats the control median in BOTH fit and
//   select at DEFAULT_COST_MODEL) and then cleared the TEST criterion frozen in
//   scripts/weekly-test-rows.mts and applied in scripts/weekly-indicator-test-rows.mts
//   (beats median >= 2/3 AND raw avgR > 0 >= 2/3): rsi-band and bb-revert. Both,
//   not one. The four rules that failed the screen — adx-trend, ema-cross,
//   stoch-revert, macd-cross — are not here and are not re-tested; a failed screen
//   is a closed door, not a shortlist.
//
//   PASS, applied to each hypothesis independently:
//     (a) beats the control MEDIAN in >= 2 of 3 deep folds, AND
//     (b) beats the control P95    in >= 1 of 3, AND
//     (c) raw avgR > 0             in >= 2 of 3.
//   at DEFAULT_COST_MODEL, with no fold below the trade floor.
//
//   That bar is scripts/weekly-deep-holdout.mts's, copied clause for clause and
//   value for value, so a verdict here and a verdict there mean the same thing and
//   the two logs can be read side by side. Clause (c) is the one that matters most
//   in these folds and the reason the daily bar was not reused unchanged: DEEP1
//   and DEEP2 contain bear markets where a short-heavy rule meets a random-entry
//   control that PAYS (weekly-deep-holdout.log measured that control at +0.11 to
//   +0.17 in 2000-2010), and "beats a control that made money" and "beats a control
//   that lost money" are different claims that only raw avgR tells apart.
//
//   ANYTHING LESS IS REJECTION for that rule. Not "inconclusive", not "the ladder
//   was wrong for that regime", not "retest without 2008", not "sweep the RSI
//   period". A rule that fails here is finished on weekly bars, and nothing about
//   it may be sized, approved, or deployed afterwards.
//
//   NO OTHER ROWS. Two hypotheses, no audit mechanisms, no third rule carried
//   along "for context". A menu printed on hold-out data is a menu whatever the
//   caption says.
//
//   SURVIVORSHIP (second pre-registered test, section 3) runs on BOTH rules rather
//   than on one. Both are faders that buy weakness and sell strength, so both take
//   the winner-drift objection equally, and the quartile split re-reads the very
//   bars section 2 has already paid for — its cost is CPU, not data. Running it on
//   one rule and not the other would be a choice made after seeing which rule
//   looked better, which is the thing this apparatus exists to prevent.
//
//   MY PREDICTION, recorded before the first run: I EXPECT BOTH TO FAIL. Their
//   screen margins (+0.019 fit / +0.329 select for rsi-band, +0.018 / +0.217 for
//   bb-revert) sit on controls at -0.18 to -0.42 — they are short-heavy rules
//   beating a deeply negative control in a bull tape, and the same weekly control
//   is positive across 2000-2010. I wrote a prediction of exactly this shape into
//   scripts/weekly-indicator-test-rows.mts ("I EXPECT BOTH TO FAIL") and was WRONG:
//   both held. That is the whole reason the frozen bar decides this and I do not.
//
// EXACTLY ONE THING DIFFERS from scripts/weekly-indicator-test-rows.mts: the
//   folds. Bar class, fill, ladder, seed, control count, fold warm-up, cost models
//   and checks are the same objects and the same values.
//
// WHY THE RULES ARE COPIED HERE RATHER THAN IMPORTED
//
//   rsi-band and bb-revert are not in src/lib/research/mechanisms.ts. They are
//   defined inside scripts/weekly-indicator-screen.mts, which is pre-registered
//   and frozen — adding an export to it would be editing a script after its run.
//   So the two rule closures and their memo helpers below are copied from it
//   character for character, and NOTHING may be "cleaned up" in the copy.
//
//   A silent copy error would look exactly like a result, so it is checked rather
//   than trusted:
//
//   RULE FIDELITY CHECK (section 1, runs FIRST and aborts before DEEP is touched).
//   The copied rules are run over FIT and SELECT — folds already spent, so this
//   buys no information — and must reproduce scripts/weekly-indicator-screen.log
//   exactly: trade count equal, and avgR equal to three decimals. A mismatch means
//   the copy is not the rule that earned this hold-out, and the run aborts having
//   read nothing.
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
//   is short, the participation line will say so. RSI(14) and Bollinger(20) need
//   far less than that, so the binding constraint is the engine's own WARMUP.
//
// RESAMPLER CHECK. weeklyPanel re-derives every weekly bar from its daily source
//   and compares field by field. It throws; this script does not catch it.
//
// VOIDING CHECK. The fraction of weekly bars where open != close must be >= 0.99.
//
// LIMITATIONS this run does not fix. Membership survivorship: universe.ts is
//   TODAY's S&P 500, so the names that failed out of the index between 2000 and
//   2016 are not in a low quartile — they are not in the data at all. The
//   quartile diagnostic measures winner DRIFT among survivors and cannot reach
//   that. It stays open however flat the quartiles come out.
//
//   npx tsx scripts/weekly-indicator-deep-holdout.mts --checks-only
//   npx tsx scripts/weekly-indicator-deep-holdout.mts | tee scripts/weekly-indicator-deep-holdout.log
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
import { LADDERS, type Mechanism } from "@/lib/research/mechanisms";
import { computeEntrySignals, WARMUP, type EntrySignals, type EntryRule } from "@/lib/backtest/engine";
import { bollinger, rsi, type Candle } from "@/lib/indicators";

const EXIT = LADDERS.flat;
const RETAIL_COSTS = { slippageBps: 5, commissionBps: 1 };
const MIN_OPEN_DIFFERS = 0.99;

const HOLD_MIN_MEDIAN = 2;
const HOLD_MIN_P95 = 1;
const HOLD_MIN_POSITIVE = 2;

const SURVIVORSHIP_BUCKETS = 4;

// --- the two rules, copied character for character from the frozen ------------
// --- scripts/weekly-indicator-screen.mts. Do not tidy, rename or re-express. ---

const closes = (c: Candle[]) => c.map((b) => b.c);

const SCREENED: Mechanism[] = [
  {
    key: "rsi-band",
    blurb: "RSI(14) oversold below 30 / overbought above 70",
    rule:
      (c) =>
      (i): ReturnType<EntryRule> => {
        const v = rsiOf(c)[i];
        if (v == null) return null;
        if (v < 30) return "long";
        if (v > 70) return "short";
        return null;
      },
  },
  {
    key: "bb-revert",
    blurb: "close outside the Bollinger(20, 2 sigma) band, faded",
    rule:
      (c) =>
      (i): ReturnType<EntryRule> => {
        const { upper, lower } = bbOf(c);
        const [u, l] = [upper[i], lower[i]];
        if (u == null || l == null) return null;
        if (c[i].c < l) return "long";
        if (c[i].c > u) return "short";
        return null;
      },
  },
];

// Per-series memo. withSignals calls rule(candles) once per symbol, but the
// EntryRule it returns is invoked per bar; recomputing ADX inside that closure
// would be O(bars^2). The key is the array identity, which sliceFold hands out
// one of per symbol per fold.
function memo<T>(compute: (c: Candle[]) => T): (c: Candle[]) => T {
  const cache = new WeakMap<Candle[], T>();
  return (c) => {
    let v = cache.get(c);
    if (v === undefined) {
      v = compute(c);
      cache.set(c, v);
    }
    return v;
  };
}

const rsiOf = memo((c: Candle[]) => rsi(closes(c)));
const bbOf = memo((c: Candle[]) => bollinger(closes(c)));

/**
 * What scripts/weekly-indicator-screen.log recorded at DEFAULT_COST_MODEL, read
 * off that log and transcribed here before this script was first run. The trade
 * count is the sharper of the two: it is a direct function of which bars the rule
 * fires on, so a copy that drifted by one threshold cannot match it by luck.
 */
const FIDELITY: Record<string, Record<string, { trades: number; avgR: number }>> = {
  "rsi-band": {
    fit: { trades: 3342, avgR: -0.156 },
    select: { trades: 939, avgR: -0.094 },
  },
  "bb-revert": {
    fit: { trades: 3548, avgR: -0.089 },
    select: { trades: 1115, avgR: -0.037 },
  },
};

// --- everything below is the weekly deep hold-out's machinery, unchanged -------

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
function livablePrepared(slices: FoldSliceRow[], rule: NonNullable<Mechanism["rule"]>): PreparedSymbol[] {
  return withSignals(slices, (_sym, candles) =>
    computeEntrySignals(candles, undefined, rule(candles)),
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

/**
 * RULE FIDELITY CHECK. Scoped into its own function so the FIT/SELECT panel is
 * unreachable — and collectable — before the much larger deep cache is loaded.
 * No control runs: the anchors are avgR and trade count, neither of which the
 * control touches.
 */
function fidelityCheck(): string[] {
  const failures: string[] = [];

  console.log("\nloading the fit/select panel cache…");
  const daily = loadPanel();
  console.log(`panel ${daily.cachePath} — ${daily.symbols.length} symbols, fetchedAt ${daily.fetchedAt}`);
  const weekly = weeklyPanel(daily);
  console.log(`resampled to ${weekly.symbols.length} symbols of weekly bars (asserted against daily)`);

  const exit: PanelExit = { ...EXIT, entryAt: "open" };
  for (const mech of SCREENED) {
    for (const fold of [FOLDS.fit, FOLDS.select]) {
      const want = FIDELITY[mech.key]?.[fold.name];
      if (!want) throw new Error(`no fidelity anchor for ${mech.key}/${fold.name}`);
      const slice = sliceFold(weekly, fold, weekly.symbols, WEEKLY_PANEL_WARMUP_BARS);
      const run = simulateFold(livablePrepared(slice, mech.rule!), fold, exit);
      const gotR = run.summary.avgR;
      const okTrades = run.trades.length === want.trades;
      const okR = gotR != null && Math.abs(gotR - want.avgR) < 5e-4;
      console.log(
        `  ${mech.key.padEnd(10)} ${fold.name.padEnd(7)} trades ${String(run.trades.length).padStart(5)} ` +
          `(logged ${want.trades})   avgR ${f3(gotR)} (logged ${want.avgR.toFixed(3)})   ` +
          `${okTrades && okR ? "match" : "MISMATCH"}`,
      );
      if (!okTrades) failures.push(`${mech.key}/${fold.name}: ${run.trades.length} trades, log says ${want.trades}`);
      if (!okR) failures.push(`${mech.key}/${fold.name}: avgR ${gotR}, log says ${want.avgR}`);
    }
  }
  return failures;
}

async function main() {
  const checksOnly = process.argv.includes("--checks-only");

  console.log("weekly indicator deep hold-out — rsi-band and bb-revert on 2000-2016, weekly bars, livable fill");
  console.log("PRE-REGISTERED: see this script's header. This is the THIRD read of DEEP1-3 (daily mr-down3");
  console.log("2026-09-05; weekly mr-down3 + gap-fade 2026-09-08), so it settles only whether these two");
  console.log("indicator rules survive 2000-2002 and 2008. It cannot re-establish anything general.");

  // -------------------------------------------------------------------------
  // 1. Rule fidelity — before anything reads DEEP.
  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(120)}\n1. RULE FIDELITY CHECK — the copied rules must reproduce scripts/weekly-indicator-screen.log\n${"=".repeat(120)}`);
  const failures = fidelityCheck();
  if (failures.length) {
    console.error(`\nRULE FIDELITY CHECK: FAIL\n  ${failures.join("\n  ")}`);
    console.error("\naborting: the rules copied into this file are not the rules that earned this hold-out.");
    console.error("DEEP1-3 were not read. Fix the copy against scripts/weekly-indicator-screen.mts and re-run.");
    process.exit(1);
  }
  console.log("\nRULE FIDELITY CHECK: pass — both rules reproduce the screen exactly on fit and select.");

  // -------------------------------------------------------------------------
  // 2. The hold-out table.
  // -------------------------------------------------------------------------
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

  console.log(`\n${"=".repeat(120)}\n2. WEEKLY DEEP HOLD-OUT — two hypotheses, no audit rows\n${"=".repeat(120)}`);

  const decidingRows = new Map<string, Row[]>();

  for (const block of blocks) {
    console.log(`\n${"-".repeat(120)}\n${block.label}\n${"-".repeat(120)}`);
    for (const mech of SCREENED) {
      console.log(`\n${mech.key}`);
      console.log(`  ${mech.blurb}`);
      printHeader();
      const rows: Row[] = [];
      for (const fold of DEEP_FOLD_LIST) {
        const prepared = livablePrepared(slices.get(fold.name)!, mech.rule!);
        const r: Row = { fold, ...runRow(prepared, fold, block.exit) };
        printRow(r);
        rows.push(r);
      }
      if (block.decides) decidingRows.set(mech.key, rows);
    }
  }

  // -------------------------------------------------------------------------
  // 3. Survivorship diagnostic, on BOTH rules.
  //
  // PRE-REGISTERED, fixed before the run, and the same rule scripts/deep-holdout.mts
  // and scripts/weekly-deep-holdout.mts used, so all three verdicts are comparable:
  //
  //   The S&P 500 list in universe.ts is TODAY's membership, so every name in it
  //   is a survivor and every dip it ever had was, in fact, bought. That flatters
  //   a fade rule more than it flatters a random-entry control, which does not aim
  //   at dips. Measure it rather than assume it.
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
  console.log(`\n${"=".repeat(120)}\n3. SURVIVORSHIP DIAGNOSTIC — by the symbol's own deep-window annualised return\n${"=".repeat(120)}`);

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

  const quartilesByRule = new Map<string, number[][]>();

  for (const mech of SCREENED) {
    const quartileMargins: number[][] = [];
    for (let q = 0; q < SURVIVORSHIP_BUCKETS; q++) {
      const bucket = ranked.slice(bound(q), bound(q + 1));
      const label = q === 0 ? "Q1 (worst compounders)" : q === SURVIVORSHIP_BUCKETS - 1 ? `Q${q + 1} (best compounders)` : `Q${q + 1}`;
      console.log(`\n${mech.key} · ${label}`);
      console.log(`  annualised return ${(bucket[0].cagr * 100).toFixed(1)}% .. ${(bucket[bucket.length - 1].cagr * 100).toFixed(1)}%`);
      printHeader();
      const margins: number[] = [];
      for (const fold of DEEP_FOLD_LIST) {
        const slice = sliceFold(weekly, fold, bucket.map((b) => b.symbol), WEEKLY_PANEL_WARMUP_BARS);
        const r: Row = { fold, ...runRow(livablePrepared(slice, mech.rule!), fold, decidingExit) };
        printRow(r);
        margins.push(r.avgR != null && r.ctrlMed != null ? r.avgR - r.ctrlMed : NaN);
      }
      quartileMargins.push(margins);
    }
    quartilesByRule.set(mech.key, quartileMargins);
  }

  // -------------------------------------------------------------------------
  // 4. Verdict, read mechanically against the two pre-registered rules.
  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(120)}\n4. VERDICT\n${"=".repeat(120)}`);

  const n = DEEP_FOLD_LIST.length;
  console.log(`\nhold-out bar: beats control median >= ${HOLD_MIN_MEDIAN}/${n} AND beats control p95 >= ${HOLD_MIN_P95}/${n} ` +
    `AND raw avgR > 0 >= ${HOLD_MIN_POSITIVE}/${n}, at DEFAULT_COST_MODEL`);
  for (const mech of SCREENED) {
    const rows = decidingRows.get(mech.key)!;
    const med = rows.filter((r) => r.avgR != null && r.ctrlMed != null && r.avgR > r.ctrlMed).length;
    const p95 = rows.filter((r) => r.avgR != null && r.ctrlP95 != null && r.avgR > r.ctrlP95).length;
    const pos = rows.filter((r) => r.avgR != null && r.avgR > 0).length;
    const thin = rows.filter((r) => r.trades < MIN_PANEL_TRADES).length;
    const pass = med >= HOLD_MIN_MEDIAN && p95 >= HOLD_MIN_P95 && pos >= HOLD_MIN_POSITIVE && thin === 0;
    console.log(`  ${mech.key.padEnd(10)} beats median ${med}/${n}   beats p95 ${p95}/${n}   avgR>0 ${pos}/${n}` +
      `${thin ? `   ${thin} fold(s) BELOW TRADE FLOOR` : ""}   -> ${pass ? "PASS" : "REJECT"}`);
  }

  console.log(`\nsurvivorship rule: mean margin over the control median, averaged across the three deep folds`);
  for (const mech of SCREENED) {
    const qm = quartilesByRule.get(mech.key)!;
    console.log(`  ${mech.key}: ${qm.map((m, q) => `Q${q + 1} ${f3(meanFinite(m))}`).join("  ")}`);
    const bottom = meanFinite(qm[0]);
    const top = meanFinite(qm[SURVIVORSHIP_BUCKETS - 1]);
    console.log(`    -> ${
      top > 0 && bottom <= 0
        ? "REJECT — positive only where the names compounded; this is the index's drift, not an edge"
        : bottom > 0 && top > 0
          ? "WINNER-DRIFT OBJECTION FALLS — the rule works on the worst compounders too " +
            "(MEMBERSHIP survivorship is NOT tested here and stays open)"
          : "MIXED — neither pre-registered signature; read as neither"
    }`);
  }

  console.log(`\nBoth rules were written into the header of this file before it was first run, together with a`);
  console.log(`prediction that both would fail. A REJECT here closes that mechanism on weekly bars; it is not a`);
  console.log(`request for a different ladder, a swept period, or a fold to drop.`);
}

await main();
