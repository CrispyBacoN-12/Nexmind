// PRE-REGISTERED. Written and committed BEFORE the first run. Never edited afterwards.
//
// ============================================================================
// THE HYPOTHESIS
// ============================================================================
//
// STATE.md 2026-09-14 built .cache/insider/sp500-form4-ps.json (SEC Form 4,
// TRANS_CODE P/S only) and stopped at the caching half. This is the other
// half: does knowing that a company's own officers and directors bought or
// sold their own stock in the open market -- and nothing else -- produce an
// entry that beats a matched random entry?
//
// This is the second new data class this project has tried (the first,
// earnings-timing, failed in both directions -- STATE.md "NEXMIND earnings
// timing is not an entry"). Same machinery, same discipline, different
// mechanism: earnings timing carries no directional information at all (a
// company always announces; the date says nothing about content). An insider
// trade is a directional act by construction -- someone spent their own money
// to buy, or gave up shares to sell -- so if any non-price data class has a
// chance of clearing the bar, this is a more plausible candidate than the
// last one. It is still an open empirical question, not an assumed answer.
//
// ============================================================================
// THE TWO RULES, DECLARED BEFORE THE RUN
// ============================================================================
//
// insider-follow   net buying -> long, net selling -> short
// insider-fade     the exact mirror
//
// BOTH are declared here, before any number is read. The literature's modal
// finding is that insider PURCHASES predict positive abnormal returns
// (insiders buy on conviction, at personal cost, with no natural liquidity
// reason to). Insider SALES are much noisier -- diversification, taxes, and
// options exercises drive most of them, which is also why sales outnumber
// purchases 18:1 in the cache (11,398 P vs 206,322 S events). That asymmetry
// is a reason to expect a WEAK or noisy signal on the sell side, not a
// license to pick the sign after looking: follow is the literature's
// textbook direction, fade is what a tape that already prices in the routine-
// sale explanation could plausibly show. Choosing after the numbers is how
// this project's own approval gate was too loose once already, so both run,
// both verdicts print, and the promotion bar is identical for each.
//
// P and S are combined into ONE signal per symbol per bar (net dollar value,
// below), not decomposed into four separate P-only / S-only rules. Splitting
// by code would multiply the number of pre-registered candidates without
// changing the sign question, and after the earnings-screen's own aborted
// TIMESTAMP-style checks, more candidates screened at once is exactly the
// kind of multiplicity STATE.md already flagged as a past failure mode.
//
// There is no fitted parameter anywhere in either rule.
//
// ============================================================================
// SAME-BAR COLLISIONS -- ONE FIXED, PARAMETER-FREE RULE
// ============================================================================
//
// Multiple Form 4 filings can land on the same reaction bar for the same
// symbol (a cluster of officers filing the same week). Rather than a cluster-
// size threshold -- which would be a fitted parameter -- every event mapped
// to a bar is aggregated by NET DOLLAR VALUE: sum(P: shares * price) minus
// sum(S: shares * price). Net positive -> "P" for that bar, net negative ->
// "S", net exactly zero -> no signal. This is well-defined, requires no
// tuning, and treats a single $10M buy the same as ten $1M buys, which is the
// economically correct treatment of "how much conviction is behind this bar".
//
// ============================================================================
// DAILY BARS, AND WHY THIS SCREEN NEEDS NO shift1
// ============================================================================
//
// Daily bars, matching the earnings screen. Here the reason is different: a
// filing carries no reaction-session content to swallow (unlike an earnings
// announcement, nothing about the FILING ITSELF moves the price the way a
// number surprise does), so weekly bars would not swallow anything -- they
// would simply widen the look-ahead margin from ~1 trading day to ~6,
// diluting freshness for no offsetting benefit.
//
// The earnings screen needs shift1() because its signal depends on the
// REACTION BAR'S OWN CLOSE (a same-bar price feature): the rule must first
// decide at bar j's close, then shift the decision to bar j+1 before
// `entryAt: "open"` can fill it, or the fill would be look-ahead.
//
// This screen's signal depends on NOTHING about any bar's own price. It is
// fully determined by the exogenous FILING_DATE (`d`) alone. So the signal is
// placed directly at the first tradable bar j whose calendar date is
// strictly after `d`, and `entryAt: "open"` fills at bar j's own open with NO
// look-ahead: `d`'s unknown intraday time is still guaranteed to fall
// entirely before bar j's calendar date, because at least one full overnight
// gap separates a filing from the first session dated after it.
//
// ============================================================================
// FOUR ABORTING CHECKS, ALL READ BEFORE ANY VERDICT
// ============================================================================
//
//   FILING-LAG    d (FILING_DATE) must be >= td (TRANS_DATE) for >= 99% of
//                 events. An inverted ordering would mean the cache is
//                 keying the point-in-time anchor off the wrong column. The
//                 cache's own note already puts late timeliness at 0.1%
//                 (148/217,720); this check re-derives the same fact from
//                 the date columns themselves rather than trusting the
//                 upstream timeliness flag, and reports the lag distribution
//                 as a diagnostic.
//
//   COVERAGE      >= 90% of each fold's symbols must carry >= 1 tradable
//                 event. Unlike quarterly earnings, Form 4 filings have no
//                 fixed cadence to check against -- insiders trade when they
//                 trade -- so there is no event-rate BAND here, only the
//                 participation floor. The per-symbol-per-year rate is
//                 printed as informational context, not a gate.
//
//   NO-LOOKAHEAD  every fired signal's ENTRY bar must be dated strictly
//                 after its filing's own date `d`. Asserted per trade, on
//                 the actual (unshifted) signals. Aborts on one violation.
//
//   VOIDING       `entryAt: "open"` is meaningless on a panel whose bars
//                 open where they close, carried from the earnings screen.
//
// ============================================================================
// THE PROMOTION BAR, FROZEN (identical to the earnings screen)
// ============================================================================
//
// A rule ADVANCES if, at DEFAULT_COST_MODEL, in BOTH fit and select:
//
//     avgR > the matched control's MEDIAN   AND   raw avgR > 0
//
// with both folds clearing MIN_PANEL_TRADES. The retail 5bps cost model is
// printed as a pre-registered second statement and decides nothing.
//
// ADVANCING MEANS ONE THING: the rule has earned a TEST-fold read under its
// own pre-registration. It is not an approval, it is not sizeable, and it
// does not authorise spending DEEP1-3.
//
// ============================================================================
// LIMITATIONS, STATED UP FRONT
// ============================================================================
//
//  * The insider cache covers 486/490 S&P 500 names. The 4 misses (BIO,
//    FOXA, LEN, NWSA) are dual-class structures where insiders trade the
//    OTHER class, not a join defect -- documented in STATE.md 2026-09-14.
//
//  * The net-dollar-value aggregation cannot separate "one large, informed
//    buy" from "one large, routine 10b5-1 sale" -- roles and titles are
//    cached but not used by either rule, exactly as the earnings screen's
//    reaction-bar return cannot separate a beat from a smaller-than-feared
//    miss.
//
//  * FIT carries no warm-up prefix -- the cache begins where FIT begins --
//    so it loses its first WARMUP bars to the engine's own warm-up.
//
//   npx tsx scripts/insider-transaction-screen.mts
//   npx tsx scripts/insider-transaction-screen.mts --checks-only
//
// mechanisms.ts reaches db.ts at module scope, which requires DATABASE_URL.
import "dotenv/config";
import { readFileSync } from "node:fs";
import {
  FOLDS,
  PANEL_WARMUP_BARS,
  loadPanel,
  type Fold,
  type Panel,
} from "@/lib/research/panel";
import {
  CONTROL_RUNS,
  MIN_PANEL_TRADES,
  PANEL_SEED,
  runControl,
  simulateFold,
  sliceFold,
  withSignals,
  type FoldSliceRow,
  type PanelExit,
  type PreparedSymbol,
} from "@/lib/research/panelRun";
import { LADDERS } from "@/lib/research/mechanisms";
import { computeEntrySignals, WARMUP, type EntryRule, type EntrySignals } from "@/lib/backtest/engine";
import type { Candle } from "@/lib/indicators";

const INSIDER_CACHE_PATH = ".cache/insider/sp500-form4-ps.json";

const EXIT = LADDERS.flat;
const RETAIL_COSTS = { slippageBps: 5, commissionBps: 1 };
const SCREEN_FOLDS: Fold[] = [FOLDS.fit, FOLDS.select];

/** `entryAt: "open"` is a no-op on a panel whose bars open where they close. */
const MIN_OPEN_DIFFERS = 0.99;

/** COVERAGE CHECK bar. No fixed cadence exists for Form 4 filings, so there is
 *  a participation floor only -- no events-per-year band. */
const MIN_FOLD_COVERAGE = 0.9;

/** FILING-LAG CHECK bar. d (FILING_DATE) must be >= td (TRANS_DATE) for the
 *  overwhelming majority; the cache's own timeliness flag already puts late
 *  filings at 0.1%. */
const MIN_FILING_ON_OR_AFTER_TRANS = 0.99;

interface InsiderEvent {
  d: string;
  td: string;
  code: "P" | "S";
  shares: number;
  price: number;
  timeliness: "" | "E" | "L";
  roles: string[];
  title: string | null;
}

interface InsiderCache {
  fetchedAt: string;
  quartersFrom: string;
  quartersThrough: string;
  notPublished: string[];
  symbols: number;
  events: number;
  data: Record<string, InsiderEvent[]>;
}

const isoOf = (c: Candle) => new Date(c.t * 1000).toISOString().slice(0, 10);
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Index of the first candle dated on or after `iso`, or -1. */
function firstBarOnOrAfter(dates: string[], iso: string): number {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] < iso) lo = mid + 1;
    else hi = mid;
  }
  return lo < dates.length ? lo : -1;
}

/** reaction bar index -> the filing date (`d`) that produced it, kept for the audit. */
type ReactionMap = Map<number, string>;

/**
 * Map one symbol's filings onto its fold candles, aggregating same-bar
 * collisions by NET DOLLAR VALUE. Net positive -> "long" bucket (treated as
 * a "P" bar), net negative -> "short" bucket ("S" bar), net exactly zero ->
 * no signal on that bar.
 */
function reactionBars(candles: Candle[], events: InsiderEvent[]): { map: ReactionMap; net: Map<number, number> } {
  const dates = candles.map(isoOf);
  const net = new Map<number, number>();
  const map: ReactionMap = new Map();
  for (const e of events) {
    // Strictly after `d`: d has day precision only, so its unknown intraday
    // time could fall anywhere in that session — only the FOLLOWING calendar
    // date is guaranteed to be entirely after the filing.
    const j = firstBarOnOrAfter(dates, nextDay(e.d));
    if (j <= 0) continue; // -1 = after the last bar; 0 = no prior close to compare against
    const value = e.shares * e.price * (e.code === "P" ? 1 : -1);
    net.set(j, (net.get(j) ?? 0) + value);
    const prev = map.get(j);
    map.set(j, prev && prev > e.d ? prev : e.d);
  }
  return { map, net };
}

/** Net dollar value at bar i decides the side; zero net fires no signal. */
function insiderRule(net: Map<number, number>, fade: boolean): EntryRule {
  return (i: number) => {
    const v = net.get(i);
    if (!v) return null;
    const follow = v > 0 ? "long" : "short";
    if (!fade) return follow;
    return follow === "long" ? "short" : "long";
  };
}

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

/** 1R as a fraction of price, over the bars the rule actually fires on. */
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

/** Build the (unshifted) signals for one fold, keeping the reaction map for the audit. */
function livableFold(
  slices: FoldSliceRow[],
  events: Record<string, InsiderEvent[]>,
  fade: boolean,
): { prepared: PreparedSymbol[]; reactions: Map<string, ReactionMap> } {
  const reactions = new Map<string, ReactionMap>();
  const prepared = withSignals(slices, (symbol, candles) => {
    const { map, net } = reactionBars(candles, events[symbol] ?? []);
    reactions.set(symbol, map);
    return computeEntrySignals(candles, undefined, insiderRule(net, fade));
  });
  return { prepared, reactions };
}

/**
 * NO-LOOKAHEAD CHECK.
 *
 * A side at index i was set directly from filings mapped to bar i. The entry
 * fills at bar i's OPEN, so bar i's date must be strictly after the filing's
 * own date `d`. Anything else means the trade was placed on a filing it
 * could not yet have seen.
 */
function noLookaheadViolations(prepared: PreparedSymbol[], reactions: Map<string, ReactionMap>): string[] {
  const bad: string[] = [];
  for (const p of prepared) {
    const map = reactions.get(p.symbol);
    if (!map) continue;
    for (let i = 0; i < p.signals.sides.length; i++) {
      if (!p.signals.sides[i]) continue;
      const filed = map.get(i);
      if (!filed) {
        bad.push(`${p.symbol} bar ${i}: signal with no filing behind it`);
        continue;
      }
      const entry = isoOf(p.candles[i]);
      if (!(entry > filed)) bad.push(`${p.symbol}: entry ${entry} not after filing ${filed}`);
    }
  }
  return bad;
}

async function main() {
  const checksOnly = process.argv.includes("--checks-only");

  console.log("insider-transaction screen — SEC Form 4 open-market P/S filings as a standalone entry");
  console.log("PRE-REGISTERED: see this script's header. Two rules, both declared before the run, zero fitted");
  console.log("parameters. Daily bars, same-bar fill (no shift1 needed), fit + select only. Nothing here may be approved.");

  const cache = JSON.parse(readFileSync(INSIDER_CACHE_PATH, "utf8")) as InsiderCache;
  console.log(`\ninsider cache ${INSIDER_CACHE_PATH} — ${cache.symbols} symbols, ${cache.events} P/S events, ` +
    `${cache.quartersFrom}..${cache.quartersThrough} (not yet published: ${cache.notPublished.join(", ") || "none"}), ` +
    `fetchedAt ${cache.fetchedAt}`);

  // FILING-LAG CHECK — read before anything else, because an inverted d/td
  // ordering would mean the point-in-time anchor is keyed off the wrong
  // column and every reaction bar below would be mis-dated.
  let onOrAfter = 0;
  let before = 0;
  const lagsDays: number[] = [];
  for (const evs of Object.values(cache.data)) {
    for (const e of evs) {
      const lag = (Date.parse(e.d) - Date.parse(e.td)) / 86_400_000;
      if (lag >= 0) onOrAfter++;
      else before++;
      lagsDays.push(lag);
    }
  }
  const totalEv = onOrAfter + before;
  const lagFrac = onOrAfter / totalEv;
  lagsDays.sort((a, b) => a - b);
  console.log(`FILING-LAG CHECK (d >= td): ${onOrAfter}/${totalEv} (${(100 * lagFrac).toFixed(2)}%) ` +
    `— bar ${(100 * MIN_FILING_ON_OR_AFTER_TRANS).toFixed(0)}%. lag days: p50=${quantile(lagsDays, 0.5).toFixed(1)} ` +
    `p95=${quantile(lagsDays, 0.95).toFixed(1)} max=${lagsDays[lagsDays.length - 1].toFixed(1)}`);
  if (!(lagFrac >= MIN_FILING_ON_OR_AFTER_TRANS)) {
    console.error("aborting: FILING-LAG. Too many events have a filing date before the trade date — " +
      "the point-in-time anchor is wrong and every reaction bar below would be mis-dated.");
    process.exit(1);
  }

  console.log("\nloading daily panel cache…");
  const panel = loadPanel();
  console.log(`panel ${panel.cachePath} — ${panel.symbols.length} symbols, fetchedAt ${panel.fetchedAt}`);

  // VOIDING CHECK.
  const frac = openDiffersFraction(panel);
  console.log(`VOIDING CHECK (daily bars with open != close): ${(100 * frac).toFixed(2)}% ` +
    `— bar is ${(100 * MIN_OPEN_DIFFERS).toFixed(0)}%`);
  if (!(frac >= MIN_OPEN_DIFFERS)) {
    console.error("aborting: VOID. A bar whose open equals its close makes the livable fill identical to the close fill.");
    process.exit(1);
  }

  // COVERAGE CHECK, per fold, over TRADABLE bars only. No events-per-year
  // band — Form 4 filings have no fixed cadence to check against.
  const slices: Record<string, FoldSliceRow[]> = {};
  for (const fold of SCREEN_FOLDS) {
    const rows = sliceFold(panel, fold, panel.symbols, PANEL_WARMUP_BARS);
    slices[fold.name] = rows;
    const years = (Date.parse(fold.to) - Date.parse(fold.from)) / (365.25 * 24 * 3600 * 1000);
    let covered = 0;
    const perYear: number[] = [];
    for (const row of rows) {
      const { net } = reactionBars(row.candles, cache.data[row.symbol] ?? []);
      let n = 0;
      for (const [idx, v] of net) if (idx >= row.entryFrom && v !== 0) n++;
      if (n > 0) covered++;
      perYear.push(n / years);
    }
    perYear.sort((a, b) => a - b);
    const median = quantile(perYear, 0.5);
    const coverage = rows.length ? covered / rows.length : 0;
    const tradable = rows.length ? rows[0].candles.length - rows[0].entryFrom : 0;
    console.log(`  ${fold.name}: ${rows.length} symbols participate, ` +
      `${rows.length ? rows[0].entryFrom : 0} warm-up + ${tradable} tradable bars (first symbol)`);
    console.log(`    COVERAGE CHECK: ${covered}/${rows.length} carry a tradable event (${(100 * coverage).toFixed(1)}%, ` +
      `bar ${(100 * MIN_FOLD_COVERAGE).toFixed(0)}%), median ${median.toFixed(2)} events/symbol/year (informational, ` +
      `no fixed cadence for Form 4) over ${years.toFixed(2)}y`);
    if (!(coverage >= MIN_FOLD_COVERAGE)) {
      console.error(`aborting: COVERAGE. ${fold.name} is not a sample of the panel.`);
      process.exit(1);
    }
  }

  const RULES = [
    { key: "insider-follow", fade: false, blurb: "net buying -> long, net selling -> short (literature's textbook direction)" },
    { key: "insider-fade", fade: true, blurb: "the mirror: net buying -> short, net selling -> long" },
  ];

  // NO-LOOKAHEAD CHECK, on the signals the screen will actually trade.
  console.log("\nNO-LOOKAHEAD CHECK (every entry bar dated strictly after its filing's own date):");
  const built = new Map<string, PreparedSymbol[]>();
  for (const rule of RULES) {
    for (const fold of SCREEN_FOLDS) {
      const { prepared, reactions } = livableFold(slices[fold.name], cache.data, rule.fade);
      const bad = noLookaheadViolations(prepared, reactions);
      const fired = prepared.reduce((a, p) => a + p.signals.sides.filter(Boolean).length, 0);
      console.log(`  ${rule.key} ${fold.name}: ${fired} signals, ${bad.length} violations`);
      if (bad.length) {
        console.error(`aborting: NO-LOOKAHEAD. ${bad.length} violation(s):\n  ` + bad.slice(0, 10).join("\n  "));
        process.exit(1);
      }
      built.set(`${rule.key}:${fold.name}`, prepared);
    }
  }
  console.log("NO-LOOKAHEAD CHECK: pass");

  if (checksOnly) {
    console.log("\n--checks-only: stopping before the screen.");
    return;
  }

  console.log(`\nfill: filing d -> first tradable bar j dated strictly after d -> entry at bar j's own OPEN (no shift1)`);
  console.log(`ladder=flat tp1=${EXIT.tp1Mult} sl=${EXIT.slMult}  control=${CONTROL_RUNS} runs  seed=${PANEL_SEED}  ` +
    `engine WARMUP=${WARMUP} bars  fold warm-up=${PANEL_WARMUP_BARS} bars  trade floor=${MIN_PANEL_TRADES}`);
  console.log(`NOTE: FIT has NO warm-up prefix (the cache starts the day FIT does), so it loses its first ` +
    `${WARMUP} bars to the engine's own warm-up.`);

  const blocks: { label: string; exit: PanelExit; decides: boolean }[] = [
    { label: "DEFAULT_COST_MODEL (0.5bps slip + 1bp comm) — THIS BLOCK DECIDES", exit: { ...EXIT, entryAt: "open" }, decides: true },
    { label: "retail (5bps slip + 1bp comm) — pre-registered second statement", exit: { ...EXIT, entryAt: "open", costs: RETAIL_COSTS }, decides: false },
  ];

  const promoted: string[] = [];

  for (const block of blocks) {
    console.log(`\n${"=".repeat(120)}\n${block.label}\n${"=".repeat(120)}`);
    for (const rule of RULES) {
      console.log(`\n${rule.key}`);
      console.log(`  ${rule.blurb}`);
      console.log("    fold      trades  symbols     avgR     win%   ctrl med  ctrl p95   margin      1R  verdict");

      let clears = 0;
      for (const fold of SCREEN_FOLDS) {
        const prepared = built.get(`${rule.key}:${fold.name}`)!;
        const r = runRow(prepared, fold, block.exit);
        const enough = r.trades >= MIN_PANEL_TRADES;
        const margin = r.avgR != null && r.ctrlMed != null ? r.avgR - r.ctrlMed : null;
        const beats = margin != null && margin > 0;
        const positive = r.avgR != null && r.avgR > 0;
        const ok = enough && beats && positive;
        if (ok) clears++;
        const verdict = !enough
          ? "THIN"
          : ok
            ? "clears"
            : beats
              ? "beats-median but avgR<=0"
              : positive
                ? "loses to median"
                : "loses to median, avgR<=0";
        console.log(
          `    ${fold.name.padEnd(8)} ${String(r.trades).padStart(7)} ${String(r.symbolsTraded).padStart(8)} ` +
            `${f3(r.avgR)} ${r.winRate.toFixed(1).padStart(8)} ${f3(r.ctrlMed)} ${f3(r.ctrlP95)} ${f3(margin)} ` +
            `${(100 * r.medianR).toFixed(2).padStart(6)}%  ${verdict}`,
        );
      }

      if (block.decides) {
        const advance = clears === SCREEN_FOLDS.length;
        console.log(`  => ${advance ? "ADVANCES" : "FAILS"} (${clears}/${SCREEN_FOLDS.length} folds clear the frozen bar)`);
        if (advance) promoted.push(rule.key);
      }
    }
  }

  console.log(`\n${"=".repeat(120)}`);
  console.log(`VERDICT (frozen bar: beats the control MEDIAN and raw avgR > 0, in BOTH folds, at DEFAULT_COST_MODEL)`);
  console.log(promoted.length ? `  ADVANCES: ${promoted.join(", ")}` : "  ADVANCES: none");
  console.log(`  Advancing earns a TEST-fold read under its own pre-registration, and nothing else.`);
  console.log(`  It is not an approval, it is not sizeable, and it does not authorise spending DEEP1-3.`);
  console.log(`  A margin is only readable against the control's own LEVEL — both are printed above.`);
}

await main();
