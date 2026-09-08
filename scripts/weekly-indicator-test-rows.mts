// The TEST rows for the two rules that advanced out of the weekly indicator screen.
//
// WHY THIS EXISTS
//
// scripts/weekly-indicator-screen.log promoted rsi-band and bb-revert: both beat
// the control median in fit AND select at DEFAULT_COST_MODEL, which is the bar
// that script pre-registered. That bar earns them exactly one thing — a read of
// their TEST rows under the criterion already fixed in
// scripts/weekly-test-rows.mts — and this script is that read.
//
// I EXPECT BOTH TO FAIL, and say so before running rather than after. Their raw
// avgR is negative in all four screened cells (rsi-band −0.156 / −0.094,
// bb-revert −0.089 / −0.037). They clear the promotion bar only because the
// matched control is more negative still: both fire mostly SHORT into the 2019
// melt-up, so a random entry with the same side mix loses badly and losing less
// reads as a margin. That is the gap-fade shape exactly.
//
// Running it anyway is the point. The promotion bar was fixed before the screen
// ran and it does not contain an avgR > 0 clause; declining to honour it now,
// on a reading formed after seeing the numbers, is moving a criterion after the
// fact. The criterion below is what catches this shape, and it was also fixed in
// advance. Let the gate do the work rather than my judgment.
//
// PRE-REGISTRATION (fixed before the first run; not edited afterwards)
//
// HYPOTHESIS. rsi-band and/or bb-revert, unmodified, on weekly bars at the
//   livable fill, still beat their matched random-entry control outside the
//   folds they were screened on.
//
// CRITERION — copied verbatim from scripts/weekly-test-rows.mts so that a row
//   here and a row there mean the same thing: a rule HOLDS if it beats the
//   control MEDIAN in at least 2 of the 3 TEST folds AND its own raw avgR is
//   greater than zero in at least 2 of the 3, at DEFAULT_COST_MODEL.
//
// FOLDS READ. test1/test2/test3 ONLY. fit and select are re-run for the
//   reproduction check below and their numbers are compared, not re-published as
//   findings. DEEP1-3 are NOT imported and NOT read.
//
// THE TEST FOLDS ARE NOT VIRGIN DATA. panel.ts says so, and
//   scripts/weekly-test-rows.log has already printed mr-down3's and gap-fade's
//   TEST rows. This log is a filter, not a verdict.
//
// CONSEQUENCE OF A FAIL. Both rules die, and with them the classic indicator
//   library as an entry-rule source on this data. Do not sweep the periods, do
//   not move the 30/70 or the 2-sigma band, do not add a trend filter and
//   re-run, do not try a third fill. The remaining move is a NEW DATA CLASS.
//
// REPRODUCTION CHECK. The two rules are declared in this file because the screen
//   declared them in ITS file (src/lib/research/mechanisms.ts holds uncommitted
//   owner work and neither script may touch it), and a .mts script that runs
//   main() at import cannot be imported from. Copied code can drift, so this
//   script re-runs fit and select for both rules and asserts the resulting avgR
//   matches the committed screen log to three decimals. It aborts on mismatch.
//   A TEST row from a rule that is not the screened rule is worse than no row.
//
//   npx tsx scripts/weekly-indicator-test-rows.mts | tee scripts/weekly-indicator-test-rows.log
//
import "dotenv/config";
import { loadPanel, TEST_FOLDS, FOLDS, type Fold, type Panel } from "@/lib/research/panel";
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
const HOLD_MIN_FOLDS = 2;

const closes = (c: Candle[]) => c.map((b) => b.c);

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

/** Verbatim from scripts/weekly-indicator-screen.mts. The reproduction check is what proves it. */
const ADVANCED: Mechanism[] = [
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

/** avgR printed by the committed screen log at DEFAULT_COST_MODEL, to three decimals. */
const SCREEN_AVG_R: Record<string, Record<string, number>> = {
  "rsi-band": { fit: -0.156, select: -0.094 },
  "bb-revert": { fit: -0.089, select: -0.037 },
};

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
  /** BacktestSummary.winRate is already a PERCENT (0-100). Do not multiply it. */
  winRate: number;
  ctrlMed: number | null;
  ctrlP95: number | null;
  medianR: number;
}

function livablePrepared(slices: FoldSliceRow[], rule: NonNullable<Mechanism["rule"]>): PreparedSymbol[] {
  return withSignals(slices, (_sym, candles) => computeEntrySignals(candles, undefined, rule(candles)))
    .map((p) => ({ ...p, signals: shift1(p.signals) }));
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

function printRow(r: Row): void {
  const margin = r.avgR != null && r.ctrlMed != null ? r.avgR - r.ctrlMed : null;
  const verdict = margin == null ? "no-control" : margin > 0 ? "beats-median" : "LOSES-to-median";
  const thin = r.trades < MIN_PANEL_TRADES ? "  BELOW-TRADE-FLOOR" : "";
  console.log(
    `    ${r.fold.name.padEnd(8)}${String(r.trades).padStart(8)}${String(r.symbolsTraded).padStart(9)}  ` +
      `${f3(r.avgR)}  ${r.winRate.toFixed(1).padStart(5)}%  ` +
      `${f3(r.ctrlMed)}  ${f3(r.ctrlP95)}  ${f3(margin)}  ${(100 * r.medianR).toFixed(2).padStart(6)}%  ${verdict}${thin}`,
  );
}

async function main() {
  console.log("weekly indicator TEST rows — rsi-band, bb-revert");
  console.log("PRE-REGISTERED: see this script's header. HOLDS = beats the control median in >=2 of 3 TEST folds");
  console.log("AND raw avgR > 0 in >=2 of 3, at DEFAULT_COST_MODEL. Nothing is approved from this log.");

  console.log("\nloading daily panel cache…");
  const daily = loadPanel();
  console.log(`panel ${daily.cachePath} — ${daily.symbols.length} symbols, fetchedAt ${daily.fetchedAt}`);

  console.log("\nresampling to weekly bars (every bar asserted against its daily source)…");
  const weekly = weeklyPanel(daily);
  const totalWeeks = weekly.symbols.reduce((a, s) => a + weekly.bars[s].length, 0);
  console.log(`RESAMPLER CHECK: pass — ${weekly.symbols.length} symbols, ${totalWeeks} weekly bars`);

  const frac = openDiffersFraction(weekly);
  console.log(`VOIDING CHECK (weekly bars with open != close): ${(100 * frac).toFixed(2)}% — bar is ${(100 * MIN_OPEN_DIFFERS).toFixed(0)}%`);
  if (!(frac >= MIN_OPEN_DIFFERS)) {
    console.error("aborting: VOID.");
    process.exit(1);
  }

  const decidingExit: PanelExit = { ...EXIT, entryAt: "open" };
  const retailExit: PanelExit = { ...EXIT, entryAt: "open", costs: RETAIL_COSTS };

  // REPRODUCTION CHECK — the screened rules, the screened folds, the screened numbers.
  console.log(`\n${"=".repeat(120)}\nREPRODUCTION CHECK — do the copied rules reproduce scripts/weekly-indicator-screen.log?\n${"=".repeat(120)}`);
  for (const fold of [FOLDS.fit, FOLDS.select]) {
    const slice = sliceFold(weekly, fold, weekly.symbols, WEEKLY_PANEL_WARMUP_BARS);
    for (const mech of ADVANCED) {
      const got = runRow(livablePrepared(slice, mech.rule!), fold, decidingExit).avgR;
      const want = SCREEN_AVG_R[mech.key][fold.name];
      const ok = got != null && Math.abs(got - want) < 5e-4;
      console.log(`  ${mech.key.padEnd(10)} ${fold.name.padEnd(7)} avgR ${f3(got)}  screen says ${want.toFixed(3).padStart(7)}  ${ok ? "match" : "MISMATCH"}`);
      if (!ok) {
        console.error(`aborting: ${mech.key} on ${fold.name} does not reproduce the screen. The copied rule is not the screened rule.`);
        process.exit(1);
      }
    }
  }

  const slices: Record<string, FoldSliceRow[]> = {};
  for (const fold of TEST_FOLDS) {
    slices[fold.name] = sliceFold(weekly, fold, weekly.symbols, WEEKLY_PANEL_WARMUP_BARS);
    const rows = slices[fold.name];
    const tradable = rows.length ? rows[0].candles.length - rows[0].entryFrom : 0;
    console.log(`  ${fold.name}: ${rows.length} symbols participate, ` +
      `${rows.length ? rows[0].entryFrom : 0} warm-up + ${tradable} tradable weekly bars (first symbol)`);
  }

  console.log(`\nladder=flat tp1=${EXIT.tp1Mult} sl=${EXIT.slMult}  control=${CONTROL_RUNS} runs  seed=${PANEL_SEED}  ` +
    `engine WARMUP=${WARMUP}  fold warm-up=${WEEKLY_PANEL_WARMUP_BARS} weekly bars  trade floor=${MIN_PANEL_TRADES}`);

  const blocks: { label: string; exit: PanelExit; decides: boolean }[] = [
    { label: "DEFAULT_COST_MODEL (0.5bps slip + 1bp comm) — THIS BLOCK DECIDES", exit: decidingExit, decides: true },
    { label: "retail (5bps slip + 1bp comm) — pre-registered second statement", exit: retailExit, decides: false },
  ];

  const verdicts: string[] = [];

  for (const block of blocks) {
    console.log(`\n${"=".repeat(120)}\n${block.label}\n${"=".repeat(120)}`);
    for (const mech of ADVANCED) {
      console.log(`\n${mech.key}`);
      console.log(`  ${mech.blurb}`);
      console.log("    fold      trades  symbols     avgR     win%   ctrl med  ctrl p95   margin      1R  verdict");
      let beats = 0;
      let positive = 0;
      let thin = 0;
      for (const fold of TEST_FOLDS) {
        const r: Row = { fold, ...runRow(livablePrepared(slices[fold.name], mech.rule!), fold, block.exit) };
        printRow(r);
        if (r.avgR != null && r.ctrlMed != null && r.avgR > r.ctrlMed) beats++;
        if (r.avgR != null && r.avgR > 0) positive++;
        if (r.trades < MIN_PANEL_TRADES) thin++;
      }
      if (block.decides) {
        const holds = beats >= HOLD_MIN_FOLDS && positive >= HOLD_MIN_FOLDS && thin === 0;
        verdicts.push(`  ${mech.key.padEnd(10)} beats-median ${beats}/${TEST_FOLDS.length}, avgR>0 ${positive}/${TEST_FOLDS.length}` +
          `${thin ? `, ${thin} fold(s) BELOW TRADE FLOOR` : ""} => ${holds ? "HOLDS" : "FAILS"}`);
      }
    }
  }

  console.log(`\n${"=".repeat(120)}`);
  console.log(`CRITERION: beats the control median in >=${HOLD_MIN_FOLDS} of ${TEST_FOLDS.length} TEST folds AND raw avgR > 0 in >=${HOLD_MIN_FOLDS} of ${TEST_FOLDS.length}.`);
  for (const v of verdicts) console.log(v);
  console.log(`\nA FAIL closes the classic indicator library on this data, per this script's header —`);
  console.log(`no period sweep, no threshold move, no added filter, no third fill.`);
}

await main();
