// PRE-REGISTERED. Written and committed BEFORE the first run. Never edited afterwards.
//
// ============================================================================
// THE HYPOTHESIS
// ============================================================================
//
// Every mechanism this project has screened -- ten across five families, on two
// ticker-disjoint universes, on daily and on weekly bars -- is a function of
// price and volume. STATE.md 4g closed the universe axis; 0b and the entry-
// lateness study closed the entry axis on three fronts. Both name the same
// remaining move, and both call it engine work: a NEW DATA CLASS.
//
// It is not engine work. `SignalSource = (symbol, candles) => EntrySignals`
// passes the SYMBOL to the rule, so a research script can close over a
// per-symbol external lookup with no change to the engine at all. What is true
// is the narrower claim: the AI proposer cannot reach a new data class, because
// a proposed rule sees a price/volume-only ScanSnapshot. A script can.
//
// So: does knowing WHEN a company announced its results -- and nothing else
// about the announcement -- produce an entry that beats a matched random entry?
//
// This is post-earnings announcement drift (PEAD), the oldest documented
// anomaly in the accounting literature, tested here in the only form the data
// supports.
//
// ============================================================================
// THE TWO RULES, DECLARED BEFORE THE RUN
// ============================================================================
//
// EDGAR gives the DATE and the TIME. It does not give the EPS surprise, and
// this project has no analyst-estimate feed and no way to acquire a
// point-in-time one for free. The standard substitute in the PEAD literature is
// the reaction-bar return itself: the market's own repricing on the session
// that absorbed the news IS the surprise, expressed in the only units that
// matter. It is fully computable from price plus date, and it adds no fitted
// parameter.
//
//   pead-drift  reaction bar closed UP -> long, closed DOWN -> short, flat -> stand aside
//   pead-fade   the exact mirror
//
// BOTH are declared here, before any number is read, because the direction is a
// genuinely open question. Drift is what the literature reports at the monthly
// horizon; fade is what a modern, heavily-arbitraged tape could plausibly show
// at the daily horizon. Choosing between them AFTER seeing the numbers would be
// selecting a sign from two draws and reporting it as a prediction -- which is
// how this project's own approval gate was too loose once already. Both are
// screened, both verdicts are printed, and the promotion bar is the same for
// each.
//
// There is no parameter to tune anywhere in either rule. That is deliberate:
// mr-down3, the only mechanism ever to pass a deep hold-out here, has zero
// fitted parameters too, and that is a large part of why it was credible.
//
// ============================================================================
// DAILY BARS -- REVERSING THE LAST TWO ROUNDS ON PURPOSE
// ============================================================================
//
// The last two screens ran on weekly bars, and this one does not. PEAD is a
// daily-horizon phenomenon, and a weekly bar SWALLOWS THE REACTION SESSION: an
// announcement made on Tuesday after the close and the market's Wednesday
// repricing land inside the same weekly candle, so the reaction return is not
// separable from the rest of the week. That would destroy the timestamp
// precision which is the entire content of the new data class. Weekly bars
// would be measuring a different, blunter hypothesis and calling it this one.
//
// ============================================================================
// THE FILL -- THE ONLY ONE THE OWNER CAN TRADE
// ============================================================================
//
//   announcement after the close of day D  (or before the open of D+1)
//     -> reaction bar is the first session that can absorb it
//     -> the rule reads that bar's close against the prior close  (both known)
//     -> shift1 moves the signal one bar forward
//     -> entryAt "open" fills at the OPEN of the following session
//
// Identical machinery to scripts/weekly-indicator-screen.mts, one bar class
// down. No engine change.
//
// The reaction bar is resolved from acceptanceDateTime, not from filingDate:
// the ET clock time decides which session is first able to react. Before 16:00
// ET the same session reacts; at or after 16:00 the next one does. filingDate
// is deliberately NOT used for timing -- EDGAR rolls it to the next business
// day for late-evening filings, which would misdate the news by a session.
//
// ============================================================================
// THREE ABORTING CHECKS, ALL READ BEFORE ANY VERDICT
// ============================================================================
//
//   COVERAGE   >= 90% of each fold's symbols must carry >= 1 tradable event,
//              and the median events per symbol per year must fall in
//              [3.5, 4.5]. A US issuer reports four times a year; a median
//              outside that band means item 2.02 is being caught wrong, and
//              every number downstream would be measuring a subsample nobody
//              chose.
//
//   TIMESTAMP  >= 60% of announcements must fall OUTSIDE 09:30-16:00 ET.
//              Companies report before the open or after the close; if the
//              parsed clock says otherwise, the timezone conversion is wrong
//              and the reaction bar is off by a session. This check exists
//              because a silently-wrong reaction bar would still produce a
//              full, plausible-looking table.
//
//   NO-LOOKAHEAD  every fired signal's ENTRY bar must be dated strictly after
//              the announcement's own ET date. Asserted per trade, on the
//              shifted signals, not argued in prose. Aborts on one violation.
//
// Plus the VOIDING CHECK carried from the weekly screen: `entryAt: "open"` is
// meaningless on a panel whose bars open where they close.
//
// ============================================================================
// THE PROMOTION BAR, FROZEN
// ============================================================================
//
// A rule ADVANCES if, at DEFAULT_COST_MODEL, in BOTH fit and select:
//
//     avgR > the matched control's MEDIAN   AND   raw avgR > 0
//
// with both folds clearing MIN_PANEL_TRADES.
//
// The `avgR > 0` clause is the deliberate repair of the hole that let two
// money-losing rules advance out of the weekly indicator screen. A margin over
// a control that loses money is a statement about the tape, not about the rule:
// the weekly deep hold-out settled that by showing the same control PAYS
// +0.11..+0.17 in 2000-2010. Never read a margin without the control's level --
// so this script prints the control's own median and p95 on every row, and the
// bar refuses anything that beats a losing control while losing money itself.
//
// The retail 5bps block is printed as a pre-registered SECOND STATEMENT and
// decides nothing. Slippage is worth ~0.027R/trade here, wider than any edge
// this project has measured, so it is reported rather than hidden -- but the
// bar is fixed at one cost model, chosen before the run.
//
// ADVANCING MEANS ONE THING: the rule has earned a TEST-fold read, written up
// as its own pre-registration. It is not an approval, it is not sizeable, and
// it does not authorise spending DEEP1-3 -- those have been read twice already
// and a third read is the owner's call.
//
// ============================================================================
// LIMITATIONS, STATED UP FRONT
// ============================================================================
//
//  * The earnings cache covers 475 of 490 names. The 15 gaps are names that
//    have since been acquired, taken private, or renamed their ticker
//    (MMC -> MRSH, BK -> BNY; EA, K, HES, DFS, ANSS, JNPR, IPG, DAY gone from
//    EDGAR's map of currently-listed filers). This is the same membership
//    survivorship .cache/bars/sp500-1d.json already carries. The rule-vs-
//    control contrast is unaffected -- both arms trade the same prepared
//    symbols, and a symbol with no events fires no signals in either -- but
//    the panel this generalises to is 475 continuing names, not 490.
//
//  * The reaction-bar return is a PROXY for the surprise, not the surprise.
//    It cannot separate "beat expectations" from "missed, but less than
//    feared", and it is contaminated by whatever else moved that session.
//
//  * FIT carries no warm-up prefix -- the cache begins 2016-01-04 and FIT
//    begins 2016-01-01 -- so it loses its first 60 bars to the engine's own
//    warm-up. On daily bars that is ~3 months of a 3-year fold.
//
//   npx tsx scripts/earnings-event-screen.mts
//   npx tsx scripts/earnings-event-screen.mts --checks-only
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

const EARNINGS_CACHE_PATH = ".cache/earnings/sp500-8k-item202.json";

const EXIT = LADDERS.flat;
const RETAIL_COSTS = { slippageBps: 5, commissionBps: 1 };
const SCREEN_FOLDS: Fold[] = [FOLDS.fit, FOLDS.select];

/** `entryAt: "open"` is a no-op on a panel whose bars open where they close. */
const MIN_OPEN_DIFFERS = 0.99;

/** COVERAGE CHECK bars. Four announcements a year is what a US issuer files. */
const MIN_FOLD_COVERAGE = 0.9;
const MIN_EVENTS_PER_YEAR = 3.5;
const MAX_EVENTS_PER_YEAR = 4.5;

/** TIMESTAMP CHECK bar. Companies report before the open or after the close. */
const MIN_OUTSIDE_SESSION = 0.6;

/** ET minutes-since-midnight for the regular session. */
const OPEN_MINUTES = 9 * 60 + 30;
const CLOSE_MINUTES = 16 * 60;

interface Announcement {
  d: string;
  t: string;
}

interface EarningsCache {
  fetchedAt: string;
  windowFrom: string;
  symbols: number;
  announcements: number;
  events: Record<string, Announcement[]>;
}

const ET_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** The ET calendar date and clock minute of a UTC acceptance timestamp. */
function easternAt(utcIso: string): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    ET_FORMAT.formatToParts(new Date(utcIso))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  // Some ICU builds render midnight as hour "24" under hour12:false.
  const minutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes };
}

const isoOf = (c: Candle) => new Date(c.t * 1000).toISOString().slice(0, 10);
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * The first session that can absorb an announcement.
 *
 * Before 16:00 ET the announcement lands while that session is still open (or
 * before it opens), so that session reacts. At or after 16:00 the next one
 * does. This is the whole reason the cache stores a TIMESTAMP.
 */
function effectiveDate(a: Announcement): string {
  const et = easternAt(a.t);
  return et.minutes < CLOSE_MINUTES ? et.date : nextDay(et.date);
}

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

/** reaction bar index -> the ET date of the announcement that produced it. */
type ReactionMap = Map<number, string>;

/**
 * Map one symbol's announcements onto its fold candles.
 *
 * When two announcements collapse onto the same reaction bar (a rare
 * amended-then-refiled pair), the LATER ET date is kept, which is the stricter
 * input to the no-lookahead assertion.
 */
function reactionBars(candles: Candle[], events: Announcement[]): ReactionMap {
  const dates = candles.map(isoOf);
  const out: ReactionMap = new Map();
  for (const a of events) {
    const j = firstBarOnOrAfter(dates, effectiveDate(a));
    if (j <= 0) continue; // -1 = after the last bar; 0 = no prior close to compare against
    const et = easternAt(a.t).date;
    const prev = out.get(j);
    out.set(j, prev && prev > et ? prev : et);
  }
  return out;
}

/** The reaction-bar return, read causally: bar j's close against bar j-1's. */
function peadRule(candles: Candle[], reaction: ReactionMap, fade: boolean): EntryRule {
  return (i: number) => {
    if (!reaction.has(i)) return null;
    const now = candles[i]?.c;
    const prev = candles[i - 1]?.c;
    if (!(now > 0) || !(prev > 0) || now === prev) return null;
    const drift = now > prev ? "long" : "short";
    if (!fade) return drift;
    return drift === "long" ? "short" : "long";
  };
}

/** Decide at the close of bar i, fill at the open of bar i+1. */
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

/** Build the shifted, livable signals for one fold, keeping the reaction map for the audit. */
function livableFold(
  slices: FoldSliceRow[],
  events: Record<string, Announcement[]>,
  fade: boolean,
): { prepared: PreparedSymbol[]; reactions: Map<string, ReactionMap> } {
  const reactions = new Map<string, ReactionMap>();
  const prepared = withSignals(slices, (symbol, candles) => {
    const map = reactionBars(candles, events[symbol] ?? []);
    reactions.set(symbol, map);
    return computeEntrySignals(candles, undefined, peadRule(candles, map, fade));
  }).map((p) => ({ ...p, signals: shift1(p.signals) }));
  return { prepared, reactions };
}

/**
 * NO-LOOKAHEAD CHECK.
 *
 * After shift1, a side at index i was decided by the rule at index i-1 -- the
 * reaction bar. The entry fills at bar i's OPEN, so bar i's date must be
 * strictly after the announcement's own ET date. Anything else means the trade
 * was placed on news it could not have had.
 */
function noLookaheadViolations(prepared: PreparedSymbol[], reactions: Map<string, ReactionMap>): string[] {
  const bad: string[] = [];
  for (const p of prepared) {
    const map = reactions.get(p.symbol);
    if (!map) continue;
    for (let i = 1; i < p.signals.sides.length; i++) {
      if (!p.signals.sides[i]) continue;
      const announced = map.get(i - 1);
      if (!announced) {
        bad.push(`${p.symbol} bar ${i}: signal with no reaction bar behind it`);
        continue;
      }
      const entry = isoOf(p.candles[i]);
      if (!(entry > announced)) bad.push(`${p.symbol}: entry ${entry} not after announcement ${announced}`);
    }
  }
  return bad;
}

async function main() {
  const checksOnly = process.argv.includes("--checks-only");

  console.log("earnings-event screen — SEC EDGAR 8-K item 2.02 announcement TIMESTAMPS as a standalone entry");
  console.log("PRE-REGISTERED: see this script's header. Two rules, both declared before the run, zero fitted");
  console.log("parameters. Daily bars, livable next-open fill, fit + select only. Nothing here may be approved.");

  const cache = JSON.parse(readFileSync(EARNINGS_CACHE_PATH, "utf8")) as EarningsCache;
  console.log(`\nearnings cache ${EARNINGS_CACHE_PATH} — ${cache.symbols} symbols, ${cache.announcements} announcements, ` +
    `from ${cache.windowFrom}, fetchedAt ${cache.fetchedAt}`);

  // TIMESTAMP CHECK — read before anything else, because a wrong timezone
  // produces a complete and plausible-looking table off the wrong session.
  let pre = 0;
  let during = 0;
  let post = 0;
  for (const evs of Object.values(cache.events)) {
    for (const a of evs) {
      const m = easternAt(a.t).minutes;
      if (m < OPEN_MINUTES) pre++;
      else if (m < CLOSE_MINUTES) during++;
      else post++;
    }
  }
  const total = pre + during + post;
  const outside = (pre + post) / total;
  console.log(`TIMESTAMP CHECK (ET clock of acceptanceDateTime): before 09:30 ${(100 * pre / total).toFixed(1)}%, ` +
    `during session ${(100 * during / total).toFixed(1)}%, after 16:00 ${(100 * post / total).toFixed(1)}% ` +
    `— outside ${(100 * outside).toFixed(1)}%, bar is ${(100 * MIN_OUTSIDE_SESSION).toFixed(0)}%`);
  if (!(outside >= MIN_OUTSIDE_SESSION)) {
    console.error("aborting: TIMESTAMP. Too many announcements land mid-session — the ET conversion is wrong, " +
      "and every reaction bar below would be off by a session.");
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

  // COVERAGE CHECK, per fold, over TRADABLE bars only.
  const slices: Record<string, FoldSliceRow[]> = {};
  for (const fold of SCREEN_FOLDS) {
    const rows = sliceFold(panel, fold, panel.symbols, PANEL_WARMUP_BARS);
    slices[fold.name] = rows;
    const years = (Date.parse(fold.to) - Date.parse(fold.from)) / (365.25 * 24 * 3600 * 1000);
    let covered = 0;
    const perYear: number[] = [];
    for (const row of rows) {
      const map = reactionBars(row.candles, cache.events[row.symbol] ?? []);
      let n = 0;
      for (const idx of map.keys()) if (idx >= row.entryFrom) n++;
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
      `bar ${(100 * MIN_FOLD_COVERAGE).toFixed(0)}%), median ${median.toFixed(2)} events/symbol/year ` +
      `(band ${MIN_EVENTS_PER_YEAR}-${MAX_EVENTS_PER_YEAR}) over ${years.toFixed(2)}y`);
    if (!(coverage >= MIN_FOLD_COVERAGE)) {
      console.error(`aborting: COVERAGE. ${fold.name} is not a sample of the panel.`);
      process.exit(1);
    }
    if (!(median >= MIN_EVENTS_PER_YEAR && median <= MAX_EVENTS_PER_YEAR)) {
      console.error(`aborting: COVERAGE. ${fold.name}'s event rate is not a quarterly reporting cadence — ` +
        `item 2.02 is being caught wrong.`);
      process.exit(1);
    }
  }

  const RULES = [
    { key: "pead-drift", fade: false, blurb: "reaction bar closed UP -> long, DOWN -> short (post-earnings drift)" },
    { key: "pead-fade", fade: true, blurb: "the mirror: reaction bar closed UP -> short, DOWN -> long" },
  ];

  // NO-LOOKAHEAD CHECK, on the signals the screen will actually trade.
  console.log("\nNO-LOOKAHEAD CHECK (every entry bar dated strictly after its announcement's ET date):");
  const built = new Map<string, PreparedSymbol[]>();
  for (const rule of RULES) {
    for (const fold of SCREEN_FOLDS) {
      const { prepared, reactions } = livableFold(slices[fold.name], cache.events, rule.fade);
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

  console.log(`\nfill: announcement -> reaction bar j (read at its close) -> entry at the OPEN of bar j+1`);
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
