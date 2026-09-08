// The classic indicator library as STANDALONE entry rules, on weekly bars.
//
// WHY THIS EXISTS
//
// docs/quant/2026-08-23-confluence-filter-sweep-results.md rejected 13
// "confluence" filters. Read the list of what it actually tested — Bollinger %B,
// BB width, Stochastic, VWAP side, liquidity sweep, value area — and two things
// are true that the shorthand "indicators don't work here" hides:
//
//   1. Every one of them was tested as a VETO layered on top of an existing
//      entry rule, never as an entry rule in its own right. A filter that fails
//      to improve someone else's signal has not been asked whether it is a
//      signal.
//   2. ADX, MACD and an EMA cross were never in that sweep at all, and they are
//      implemented in src/lib/indicators.ts already.
//
// And everything in that sweep, like everything in scripts/mechanism-screen.mts,
// was measured on DAILY bars — the unexamined constant that
// scripts/weekly-mechanism-screen.log has since shown was load-bearing.
//
// So this closes a gap rather than re-running a closed loop. The prior is bad:
// these are still functions of the same OHLCV the project has mined out, and
// nothing derived from that data has beaten its control yet except mr-down3.
// The run is worth its cost because that cost is one script, not because the
// hypothesis is likely.
//
// PRE-REGISTRATION (fixed before the first run; not edited afterwards)
//
// HYPOTHESIS. At least one classic indicator, used as a standalone entry rule
//   with its library-default parameters, on weekly bars at the livable fill,
//   beats its matched random-entry control in BOTH fit and select.
//
// ZERO TUNING. Every parameter below is the DEFAULT ARGUMENT of the function in
//   src/lib/indicators.ts, and every threshold is the textbook one (ADX 25,
//   RSI 30/70, Stochastic 20/80, Bollinger 2 sigma). Not one number was chosen
//   by looking at a result. There is NO SWEEP: a mechanism that fails is dead,
//   not "needs a better period". This is the whole reason the run is honest —
//   thirteen filters at three thresholds each is how the 2026-08-23 sweep spent
//   its credibility, and the panel gate's control is what stands in for it here.
//
// SCREENING FOLDS. fit and select ONLY. TEST1-3 are NOT read by this script.
//   DEEP1-3 are NOT read: this script does not import DEEP_FOLDS or
//   DEEP_PANEL_CACHE_PATH, and descriptive statistics count as reading them.
//
// EXACTLY ONE THING DIFFERS from scripts/weekly-mechanism-screen.mts: which
//   rules are screened. Bar class, fill, ladder, seed, control count, fold
//   warm-up, cost models and checks are the same objects and the same values,
//   so a row here is directly comparable to a row there.
//
// FILL. Decided at the close of weekly bar i, filled at the open of weekly bar
//   i+1 (shift1 + entryAt "open"). NO CLOSE-FILL NUMBER IS PRINTED AS A RESULT.
//
// COST MODEL. DEFAULT_COST_MODEL (0.5bps slip + 1bp comm) decides. A 5bps+1bp
//   retail block is printed as a separate pre-registered statement.
//
// PROMOTION BAR. Identical to the weekly mechanism screen: a rule advances only
//   if it beats the CONTROL MEDIAN in BOTH fit and select, at
//   DEFAULT_COST_MODEL, with both folds clearing MIN_PANEL_TRADES. Advancing
//   means exactly one thing: read its TEST rows under the criterion already
//   pre-registered in scripts/weekly-test-rows.mts (beats median >=2/3 AND raw
//   avgR > 0 >=2/3). Nothing is approved from this log.
//
// CONSEQUENCE OF A FAIL. If nothing advances: the classic indicator library is
//   closed as an entry-rule source on this data, on both bar classes. Do not
//   sweep the periods, do not move the thresholds, do not combine two of them
//   and re-run — combining is what the 2026-08-23 sweep already did. It means
//   the remaining move is a NEW DATA CLASS (earnings dates, short interest,
//   index membership, breadth) as
//   docs/superpowers/specs/2026-09-08-weekly-bar-mechanism-screen-design.md
//   already states.
//
// WHY THE RULES LIVE IN THIS FILE. src/lib/research/mechanisms.ts holds
//   uncommitted work belonging to the owner. Adding rows there would make any
//   commit of this run sweep that work in with it. These six exist only for
//   this screen; if one ever survives its TEST rows, moving it into the shared
//   library is that promotion's job, not this script's.
//
// RESAMPLER CHECK. weeklyPanel re-derives every weekly bar from its daily
//   source and compares field by field. It throws; this script does not catch it.
//
// VOIDING CHECK. The fraction of weekly bars where open != close must be >= 0.99.
//
//   npx tsx scripts/weekly-indicator-screen.mts --checks-only
//   npx tsx scripts/weekly-indicator-screen.mts | tee scripts/weekly-indicator-screen.log
//
import "dotenv/config";
import { loadPanel, FOLDS, type Fold, type Panel } from "@/lib/research/panel";
import { weeklyPanel, WEEKLY_PANEL_WARMUP_BARS } from "@/lib/research/weekly";
import {
  sliceFold,
  withSignals,
  simulateFold,
  runControl,
  CONTROL_RUNS,
  PANEL_SEED,
  MIN_PANEL_TRADES,
  type FoldSliceRow,
  type PanelExit,
  type PreparedSymbol,
} from "@/lib/research/panelRun";
import { LADDERS, type Mechanism } from "@/lib/research/mechanisms";
import { computeEntrySignals, WARMUP, type EntrySignals, type EntryRule } from "@/lib/backtest/engine";
import { adx, bollinger, ema, macd, rsi, stochastic, type Candle } from "@/lib/indicators";

const EXIT = LADDERS.flat; // the ladder every screen and hold-out in this repo ran
const RETAIL_COSTS = { slippageBps: 5, commissionBps: 1 };
const SCREEN_FOLDS: Fold[] = [FOLDS.fit, FOLDS.select];
const MIN_OPEN_DIFFERS = 0.99;

// --- the six rules ---------------------------------------------------------
//
// Each closure computes its indicator ONCE over the symbol's whole series, then
// the returned EntryRule indexes it at i. Every series here is causal — value
// [i] is a function of candles 0..i only — so indexing at i reads nothing the
// decision could not have known. Cross rules read i-1 and i, both <= i.
//
// A "cross" is tested strictly: the relation must be false at i-1 and true at i,
// so a rule that is simply above its signal line for a year fires once, not
// fifty times. That is the difference between a signal and an exposure, and
// scripts/regime-by-side.log is what happens when it is not enforced.

const closes = (c: Candle[]) => c.map((b) => b.c);

/** True when `a` sits below `b` at i-1 and above it at i. Nulls are never a cross. */
function crossedAbove(a: (number | null)[], b: (number | null)[], i: number): boolean {
  if (i < 1) return false;
  const [a0, b0, a1, b1] = [a[i - 1], b[i - 1], a[i], b[i]];
  return a0 != null && b0 != null && a1 != null && b1 != null && a0 <= b0 && a1 > b1;
}

const SCREENED: Mechanism[] = [
  {
    key: "adx-trend",
    blurb: "trend strength: ADX(14) above 25, direction from which DI leads",
    rule:
      (c) =>
      (i): ReturnType<EntryRule> => {
        const { adx: a, plusDI, minusDI } = adxOf(c);
        const [av, p, m] = [a[i], plusDI[i], minusDI[i]];
        if (av == null || p == null || m == null || av <= 25) return null;
        return p > m ? "long" : "short";
      },
  },
  {
    key: "macd-cross",
    blurb: "MACD(12,26,9) line crossing its signal line",
    rule:
      (c) =>
      (i): ReturnType<EntryRule> => {
        const { macdLine, signalLine } = macdOf(c);
        if (crossedAbove(macdLine, signalLine, i)) return "long";
        if (crossedAbove(signalLine, macdLine, i)) return "short";
        return null;
      },
  },
  {
    key: "ema-cross",
    blurb: "EMA(20) crossing EMA(50) — the textbook trend-following entry",
    rule:
      (c) =>
      (i): ReturnType<EntryRule> => {
        const { fast, slow } = emaPairOf(c);
        if (crossedAbove(fast, slow, i)) return "long";
        if (crossedAbove(slow, fast, i)) return "short";
        return null;
      },
  },
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
  {
    key: "stoch-revert",
    blurb: "Stochastic %K(14,3,3) below 20 / above 80, faded",
    rule:
      (c) =>
      (i): ReturnType<EntryRule> => {
        const v = stochOf(c).k[i];
        if (v == null) return null;
        if (v < 20) return "long";
        if (v > 80) return "short";
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

const adxOf = memo((c: Candle[]) => adx(c));
const macdOf = memo((c: Candle[]) => macd(closes(c)));
const emaPairOf = memo((c: Candle[]) => ({ fast: ema(closes(c), 20), slow: ema(closes(c), 50) }));
const rsiOf = memo((c: Candle[]) => rsi(closes(c)));
const bbOf = memo((c: Candle[]) => bollinger(closes(c)));
const stochOf = memo((c: Candle[]) => stochastic(c));

// --- everything below is the weekly mechanism screen's machinery, unchanged --

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
  const checksOnly = process.argv.includes("--checks-only");

  console.log("weekly indicator screen — ADX / MACD / EMA / RSI / Bollinger / Stochastic as STANDALONE entries");
  console.log("PRE-REGISTERED: see this script's header. Library-default parameters, textbook thresholds,");
  console.log("no sweep. fit + select only. Nothing here may be approved.");

  console.log("\nloading daily panel cache…");
  const daily = loadPanel();
  console.log(`panel ${daily.cachePath} — ${daily.symbols.length} symbols, fetchedAt ${daily.fetchedAt}`);

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

  const slices: Record<string, FoldSliceRow[]> = {};
  for (const fold of SCREEN_FOLDS) {
    slices[fold.name] = sliceFold(weekly, fold, weekly.symbols, WEEKLY_PANEL_WARMUP_BARS);
    const rows = slices[fold.name];
    const tradable = rows.length ? rows[0].candles.length - rows[0].entryFrom : 0;
    console.log(`  ${fold.name}: ${rows.length} symbols participate, ` +
      `${rows.length ? rows[0].entryFrom : 0} warm-up + ${tradable} tradable weekly bars (first symbol)`);
  }

  if (checksOnly) {
    console.log("\n--checks-only: stopping before the screen.");
    return;
  }

  console.log(`\nfill: decided at the close of weekly bar i, filled at the open of bar i+1 ` +
    `(Friday 16:00 ET -> Monday 09:30 ET = Saturday 03:00 -> Monday 20:30 Thai)`);
  console.log(`ladder=flat tp1=${EXIT.tp1Mult} sl=${EXIT.slMult}  control=${CONTROL_RUNS} runs  seed=${PANEL_SEED}  ` +
    `engine WARMUP=${WARMUP} bars  fold warm-up=${WEEKLY_PANEL_WARMUP_BARS} weekly bars  trade floor=${MIN_PANEL_TRADES}`);
  console.log(`NOTE: FIT has NO warm-up prefix (the cache starts the day FIT does), so it loses its first ` +
    `${WARMUP} weekly bars to the engine's own warm-up — the same constraint the mechanism screen ran under.`);

  const blocks: { label: string; exit: PanelExit; decides: boolean }[] = [
    { label: "DEFAULT_COST_MODEL (0.5bps slip + 1bp comm) — THIS BLOCK DECIDES", exit: { ...EXIT, entryAt: "open" }, decides: true },
    { label: "retail (5bps slip + 1bp comm) — pre-registered second statement", exit: { ...EXIT, entryAt: "open", costs: RETAIL_COSTS }, decides: false },
  ];

  const promoted: string[] = [];

  for (const block of blocks) {
    console.log(`\n${"=".repeat(120)}\n${block.label}\n${"=".repeat(120)}`);
    for (const mech of SCREENED) {
      console.log(`\n${mech.key}`);
      console.log(`  ${mech.blurb}`);
      console.log("    fold      trades  symbols     avgR     win%   ctrl med  ctrl p95   margin      1R  verdict");
      let beats = 0;
      let thin = 0;
      for (const fold of SCREEN_FOLDS) {
        const prepared = livablePrepared(slices[fold.name], mech.rule!);
        const r = runRow(prepared, fold, block.exit);
        printRow({ fold, ...r });
        if (r.avgR != null && r.ctrlMed != null && r.avgR > r.ctrlMed) beats++;
        if (r.trades < MIN_PANEL_TRADES) thin++;
      }
      if (block.decides && beats === SCREEN_FOLDS.length && thin === 0) promoted.push(mech.key);
    }
  }

  console.log(`\n${"=".repeat(120)}`);
  console.log("PROMOTION BAR: beats the control MEDIAN in BOTH fit and select, at DEFAULT_COST_MODEL, both folds above the trade floor.");
  console.log(promoted.length
    ? `ADVANCES: ${promoted.join(", ")} — read its TEST rows under the criterion pre-registered in ` +
      `scripts/weekly-test-rows.mts (beats median >=2/3 AND raw avgR > 0 >=2/3). Nothing is approved from this log.`
    : `NO CANDIDATE. Per this script's header: the classic indicator library is closed as an entry-rule source ` +
      `on this data, on both bar classes. Do not sweep the periods, do not move the thresholds, do not combine ` +
      `two of them and re-run. The remaining move is a NEW DATA CLASS.`);
  console.log(`\nEvery parameter above is a library default and every threshold is the textbook one. No number here`);
  console.log(`was chosen by looking at a result, which is the only reason six rules on two folds is readable at all.`);
}

await main();
