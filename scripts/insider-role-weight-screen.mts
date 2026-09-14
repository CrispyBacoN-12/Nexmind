// PRE-REGISTERED. Written and committed BEFORE the first run. Never edited afterwards.
//
// ============================================================================
// THE HYPOTHESIS
// ============================================================================
//
// scripts/insider-transaction-screen.mts (STATE.md 2026-09-14, commit eefc842)
// aggregated same-bar Form 4 P/S filings by RAW net dollar value and found
// nothing: insider-follow beat its control but lost money outright,
// insider-fade was profitable but lost to its own control's median. That
// memo's own "what is NOT closed" section named the untried axis: roles and
// titles are cached (REPORTINGOWNER.RPTOWNER_RELATIONSHIP) but neither rule
// used them. This script is that axis.
//
// The economic prior, stated by cache-insider-transactions.mts's own header
// before this script existed: an Officer's trade and a 10%-owner's trade are
// not the same act. A CFO or CEO buying in the open market is spending
// personal money on a claim about the business they run day to day. A
// 10%-owner is very often an institutional holder (an index fund, an
// activist, a PE sponsor) whose Form 4 reflects portfolio mechanics --
// rebalancing, fund flows, a block trade -- with no particular claim about
// where the stock goes next. A Director sits between the two: closer to the
// business than a passive holder, further from it than a full-time officer.
// If the raw screen's null result is because a large, uninformative
// 10%-owner block trade can dominate the NET DOLLAR VALUE on a bar and drown
// out a much smaller but more informed officer trade, ROLE-WEIGHTING the
// dollar value should recover signal the raw screen could not see. If it
// does not, the failure is not "the aggregation hid it" and the data class
// is closed on this axis too.
//
// ============================================================================
// THE WEIGHT, FIXED BEFORE ANY NUMBER IS READ
// ============================================================================
//
// A fixed ORDINAL rank, not a magnitude fit to any return: Officer (highest
// information content) > Director > TenPercentOwner/Other (lowest, most
// likely to be portfolio mechanics rather than a claim about the business).
// The ranks are the integers 3 / 2 / 1 -- the smallest set of numbers that
// can express "strictly more senior, strictly more weight" with no other
// property. They were chosen for that ordering alone, before this script was
// run once, and are not to be tuned if the screen fails.
//
//   roles include Officer or OfficerOther            -> weight 3
//   roles include Director or DirectorOther (no       -> weight 2
//     Officer/OfficerOther)
//   everything else (TenPercentOwner,                 -> weight 1
//     TenPercentOwnerOther, Other)
//
// A joint filer can carry more than one role (e.g. an officer who also sits
// on the board); the HIGHEST rank present wins, because the more senior
// relationship is the one that dominates the information content of the
// trade. This is the same "union across all reporting owners on the
// accession" join cache-insider-transactions.mts already performs -- this
// script only adds a rank on top of the set it already produces.
//
// ============================================================================
// THE TWO RULES, DECLARED BEFORE THE RUN (unchanged mirror-pair convention)
// ============================================================================
//
// insider-role-follow   net role-weighted buying -> long, net selling -> short
// insider-role-fade     the exact mirror
//
// Same reasoning as the raw screen for running both: the literature's modal
// finding favours follow, but choosing a side after looking is exactly how
// this project's own approval gate was too loose once already
// (nexmind-research-approval-gate-too-loose). Both run, both verdicts print,
// identical promotion bar.
//
// ============================================================================
// SAME-BAR COLLISIONS -- WEIGHTED, STILL PARAMETER-FREE ON THE COLLISION RULE
// ============================================================================
//
// Every event mapped to a bar contributes weight(e) * shares * price * sign,
// summed. Net positive -> "P" bucket, net negative -> "S", net exactly zero
// -> no signal. This is the raw screen's rule with one multiplier inserted;
// nothing about how collisions combine is new or fitted.
//
// ============================================================================
// EVERYTHING ELSE IS UNCHANGED FROM THE RAW SCREEN
// ============================================================================
//
// Daily bars, no shift1 (the signal still depends on nothing about any bar's
// own price -- only the weight multiplier is new, and it is exogenous, fixed
// at filing time, same as shares and price already were). entryAt: "open".
// FIT + SELECT only. Same frozen promotion bar:
//
//     avgR > the matched control's MEDIAN   AND   raw avgR > 0
//
// in BOTH folds at DEFAULT_COST_MODEL, both folds clearing MIN_PANEL_TRADES.
// Retail costs are a pre-registered second statement that decides nothing.
// Advancing earns a TEST-fold read and nothing else -- not an approval, not
// sizeable, does not authorise DEEP1-3.
//
// ============================================================================
// ONE NEW DIAGNOSTIC CHECK, INFORMATIONAL ONLY, NO GATE
// ============================================================================
//
// ROLE-MIX CHECK reports what fraction of events in each fold fall into each
// weight bucket, and what fraction of TOTAL DOLLAR VALUE each bucket
// contributes. This is printed so a reader can see whether the weighting
// scheme had anything to bite on (if 10%-owner dollar value is a small
// share of the total, weighting it down cannot matter much) -- it is not a
// pass/fail bar.
//
// ============================================================================
// LIMITATIONS, STATED UP FRONT
// ============================================================================
//
//  * Same 486/490 coverage and same four missing dual-class names as the raw
//    screen (BIO, FOXA, LEN, NWSA) -- unchanged, this script reads the same
//    cache.
//
//  * The role classification is per FILING (REPORTINGOWNER.RPTOWNER_
//    RELATIONSHIP), not per person over time -- there is no cached insider
//    identifier, so "weight by transaction size relative to this specific
//    filer's own history" (the other untried axis named in the prior memo)
//    is NOT what this script tests and cannot be tested without recaching
//    with an owner CIK.
//
//  * The rank 3/2/1 is one fixed scheme, not a swept parameter. If it fails,
//    the correct read is "this ordinal weighting did not help", not license
//    to try 5/2/1 or 3/1/1 next -- that would be the exact multiplicity this
//    project has already flagged as a failure mode.
//
// ============================================================================
// PRICE-SANITY CHECK -- ADDED BEFORE THE FIRST REAL RUN (2026-09-14)
// ============================================================================
//
// The ROLE-MIX CHECK above is what caught this: the first --checks-only pass
// showed the Director bucket carrying "100.0% of total dollar value" at
// $21,424,157.10B -- not a real economic quantity. Root cause: a small
// fraction of the underlying cache's Form 4 P/S events (SEC's own bulk data,
// not a bug in cache-insider-transactions.mts's join logic, as far as this
// investigation could establish) carry a per-share `price` wildly
// inconsistent with the security's real traded price -- confirmed against
// this project's own panel bar cache, e.g. AMD 2017-08-04: reported
// $525,600,000/share vs a real close of $13.12.
//
// A flat dollar-VALUE ceiling was considered and rejected: tens of billions
// in total value is routinely real (BlackRock ~$12.78B in BLK at $414.96/sh
// in 2020; Blackstone's ~$2-4B blocks in HLT at $30-55/sh, 2015-2018; and
// similar for CFG, GM, NRG, KDP, NDAQ, GOOGL, UBER, FANG, BKR) -- excluding by
// value would have thrown out real, well-documented institutional block
// sales. The corruption is specifically in PRICE PER SHARE, not transaction
// size, so that is what is checked: each event's `price` is compared against
// the panel's own daily close nearest its transaction date `td`. An event is
// DROPPED (never sign-flipped, never repriced) from the net-value aggregation
// if `price` falls outside [close/10, close*10]. An event whose `td` has no
// panel bar within 10 days (before the panel's 2016-01-04 start, mostly) has
// nothing to check it against and is KEPT -- there is no evidence it is bad,
// only an absence of evidence either way. The 10x band is a plausibility
// judgment, not a fitted parameter: every corrupted price found during
// diagnosis was off by 4-6 orders of magnitude, and every real large trade
// checked had an entirely ordinary per-share price.
//
// This check runs once, up front, and its effect is disclosed in full
// (counts and example events printed) rather than gated -- unlike
// FILING-LAG/VOIDING/COVERAGE, which abort because there is no correction to
// apply, a corrupted price has a well-defined correction (drop the event),
// so the screen proceeds on the cleaned data rather than refusing to run.
//
// CORRECTED DESIGN, before the check was ever compared against a run: the
// first version compared each event's raw price against the panel's close on
// the SAME calendar date and flagged anything outside 10x. That is wrong,
// and would have been caught by damage rather than by review, because the
// panel's bars are themselves RETROACTIVELY SPLIT-ADJUSTED -- confirmed by
// checking GOOG's own panel close on 2016-01-04 ($36.77, matching Alphabet's
// real ~$735 January 2016 price divided by the 20:1 split that would not
// happen until 2022). A Form 4 filing reports the price AS TRADED, never
// adjusted for a split that has not happened yet from the filer's point of
// view -- so a legitimate 2016-2022 GOOG filing at ~$780/share is correctly
// reported, and would fail a same-date raw/close comparison by ~20x for no
// reason but the split, for every single one of that symbol's pre-split
// filings. The same shape recurs for any split during 2016-2026 large enough
// to clear 10x (NVDA 4:1 in 2021 then 10:1 in 2024, cumulative 40x; CMG 50:1
// in 2024) -- a same-date check would have silently discarded years of
// perfectly good filings for exactly the largest, most liquid names in the
// panel, which is worse than the corruption it set out to fix.
//
// The check actually used instead never compares a price to a single
// absolute reference: for each symbol, events are sorted by `td` and each
// event's PRICE/CLOSE ratio is compared to the MEDIAN ratio of that same
// symbol's nearest other events by date (up to 10 on each side, whatever is
// available). A split shifts every nearby ratio together, so it does not
// register as a deviation from the local median -- only a value that breaks
// from its own neighbours does, which is what actual corruption looks like
// (AMD's $525,600,000/share sits next to other AMD filings whose ratio is
// ~1; nothing else in AMD's history is anywhere near it). Events with fewer
// than 3 comparable neighbours (thin filing history for that symbol) have no
// local baseline to check against and are KEPT, same as the no-panel-bar
// case -- absence of evidence, not evidence of corruption.
//
// Known, NOT fixed by this check: a second corruption shape was found on the
// SHARE-COUNT side, not price (BAC, 2016-10-19: one event at 4,201,596,806
// shares @ $15.61 -- a plausible price, an implausible count). This check
// cannot catch that shape and does not attempt to; it is a stated limitation,
// not a silent gap -- flagged here, unresolved, for anyone extending this
// script.
//
//   npx tsx scripts/insider-role-weight-screen.mts
//   npx tsx scripts/insider-role-weight-screen.mts --checks-only
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

/** COVERAGE CHECK bar. No fixed cadence exists for Form 4 filings. */
const MIN_FOLD_COVERAGE = 0.9;

/** FILING-LAG CHECK bar, unchanged from the raw screen. */
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

/**
 * Fixed ordinal rank, declared before this script's first run. Officer >
 * Director > everything else. The highest rank present in the filing's role
 * set wins.
 */
function roleWeight(roles: string[]): number {
  if (roles.includes("Officer") || roles.includes("OfficerOther")) return 3;
  if (roles.includes("Director") || roles.includes("DirectorOther")) return 2;
  return 1; // TenPercentOwner, TenPercentOwnerOther, Other
}

/** reaction bar index -> the filing date (`d`) that produced it, kept for the audit. */
type ReactionMap = Map<number, string>;

/**
 * Map one symbol's filings onto its fold candles, aggregating same-bar
 * collisions by NET ROLE-WEIGHTED DOLLAR VALUE. Net positive -> "long"
 * bucket, net negative -> "short" bucket, net exactly zero -> no signal.
 */
function reactionBars(candles: Candle[], events: InsiderEvent[]): { map: ReactionMap; net: Map<number, number> } {
  const dates = candles.map(isoOf);
  const net = new Map<number, number>();
  const map: ReactionMap = new Map();
  for (const e of events) {
    // Strictly after `d`, same reasoning as the raw screen: d has day
    // precision only, so only the FOLLOWING calendar date is guaranteed to
    // be entirely after the filing.
    const j = firstBarOnOrAfter(dates, nextDay(e.d));
    if (j <= 0) continue; // -1 = after the last bar; 0 = no prior close to compare against
    const value = roleWeight(e.roles) * e.shares * e.price * (e.code === "P" ? 1 : -1);
    net.set(j, (net.get(j) ?? 0) + value);
    const prev = map.get(j);
    map.set(j, prev && prev > e.d ? prev : e.d);
  }
  return { map, net };
}

/** Net role-weighted dollar value at bar i decides the side; zero net fires no signal. */
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
 * NO-LOOKAHEAD CHECK, unchanged from the raw screen: every entry bar must be
 * dated strictly after its filing's own date `d`.
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

/** ROLE-MIX CHECK: informational only. Event-count and dollar-value share per weight bucket. */
function roleMix(data: Record<string, InsiderEvent[]>): { bucket: string; weight: number; events: number; dollars: number }[] {
  const buckets = new Map<number, { events: number; dollars: number }>([
    [3, { events: 0, dollars: 0 }],
    [2, { events: 0, dollars: 0 }],
    [1, { events: 0, dollars: 0 }],
  ]);
  for (const evs of Object.values(data)) {
    for (const e of evs) {
      const w = roleWeight(e.roles);
      const b = buckets.get(w)!;
      b.events++;
      b.dollars += e.shares * e.price;
    }
  }
  const names: Record<number, string> = { 3: "Officer", 2: "Director", 1: "TenPercentOwner/Other" };
  return [3, 2, 1].map((w) => ({ bucket: names[w], weight: w, ...buckets.get(w)! }));
}

const PRICE_SANITY_MAX_RATIO = 10;
const PRICE_SANITY_WINDOW_DAYS = 10;
/** Neighbours on each side of an event (by td order) used to build its local baseline ratio. */
const PRICE_SANITY_NEIGHBOR_RADIUS = 10;
/** Fewer comparable neighbours than this and there is no local baseline to check against. */
const PRICE_SANITY_MIN_NEIGHBORS = 3;

/** Nearest panel close to `iso` for one symbol's bars, or null if none within the window. */
function nearestClose(bars: { t: number; c: number }[] | undefined, iso: string): number | null {
  if (!bars || !bars.length) return null;
  const target = Date.parse(`${iso}T00:00:00Z`) / 1000;
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t < target) lo = mid + 1;
    else hi = mid;
  }
  let best: { t: number; c: number } | null = null;
  let bestDiff = Infinity;
  for (const b of [bars[lo], bars[lo - 1]]) {
    if (!b) continue;
    const diff = Math.abs(b.t - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = b;
    }
  }
  if (!best || bestDiff > PRICE_SANITY_WINDOW_DAYS * 86_400) return null;
  return best.c;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (!n) return NaN;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface PriceSanityResult {
  filtered: Record<string, InsiderEvent[]>;
  sane: number;
  insane: number;
  noBaseline: number;
  insaneDollars: number;
  totalDollars: number;
  examples: { symbol: string; e: InsiderEvent; refClose: number; ratio: number; baseline: number }[];
}

/**
 * PRICE-SANITY CHECK: drop (never sign-flip) any event whose price/close
 * ratio deviates by more than 10x from the MEDIAN ratio of that same
 * symbol's nearest other events by date. See this script's header for why a
 * same-date absolute comparison (and a dollar-value threshold before that)
 * were both tried and rejected. Events with too few comparable neighbours to
 * build a local baseline, or no panel bar near their td at all, are kept —
 * absence of evidence is not evidence of corruption.
 */
function filterPriceSanity(cache: InsiderCache, panel: Panel): PriceSanityResult {
  const closeIdx = new Map<string, { t: number; c: number }[]>();
  for (const symbol of panel.symbols) {
    closeIdx.set(symbol, panel.bars[symbol].map((b) => ({ t: b.t, c: b.c })));
  }
  const filtered: Record<string, InsiderEvent[]> = {};
  let sane = 0;
  let insane = 0;
  let noBaseline = 0;
  let insaneDollars = 0;
  let totalDollars = 0;
  const examples: { symbol: string; e: InsiderEvent; refClose: number; ratio: number; baseline: number }[] = [];

  for (const [symbol, evsRaw] of Object.entries(cache.data)) {
    const bars = closeIdx.get(symbol);
    const evs = [...evsRaw].sort((a, b) => (a.td < b.td ? -1 : a.td > b.td ? 1 : 0));
    for (const e of evs) totalDollars += e.shares * e.price;

    // ratio[i] = price/close for events with a close to check against; null otherwise.
    const ratios: (number | null)[] = evs.map((e) => {
      const close = nearestClose(bars, e.td);
      return close && close > 0 && e.price > 0 ? e.price / close : null;
    });

    const kept: InsiderEvent[] = [];
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      const r = ratios[i];
      if (r == null) {
        noBaseline++;
        kept.push(e);
        continue;
      }
      const neighborRatios: number[] = [];
      for (let d = 1; d <= PRICE_SANITY_NEIGHBOR_RADIUS; d++) {
        const lo = ratios[i - d];
        const hi = ratios[i + d];
        if (lo != null) neighborRatios.push(lo);
        if (hi != null) neighborRatios.push(hi);
      }
      if (neighborRatios.length < PRICE_SANITY_MIN_NEIGHBORS) {
        noBaseline++;
        kept.push(e);
        continue;
      }
      neighborRatios.sort((a, b) => a - b);
      const baseline = median(neighborRatios);
      const deviation = r / baseline;
      if (deviation > PRICE_SANITY_MAX_RATIO || deviation < 1 / PRICE_SANITY_MAX_RATIO) {
        insane++;
        insaneDollars += e.shares * e.price;
        if (examples.length < 8) {
          examples.push({ symbol, e, refClose: nearestClose(bars, e.td)!, ratio: r, baseline });
        }
        continue;
      }
      sane++;
      kept.push(e);
    }
    filtered[symbol] = kept;
  }
  return { filtered, sane, insane, noBaseline, insaneDollars, totalDollars, examples };
}

async function main() {
  const checksOnly = process.argv.includes("--checks-only");

  console.log("insider-role-weight screen — same-bar Form 4 net value, weighted by reporting-owner role");
  console.log("PRE-REGISTERED: see this script's header. Two rules, both declared before the run. Role weight is a fixed");
  console.log("ordinal rank (Officer=3 > Director=2 > TenPercentOwner/Other=1), not a fitted magnitude. Daily bars, no");
  console.log("shift1, fit + select only. Nothing here may be approved.");

  const cache = JSON.parse(readFileSync(INSIDER_CACHE_PATH, "utf8")) as InsiderCache;
  console.log(`\ninsider cache ${INSIDER_CACHE_PATH} — ${cache.symbols} symbols, ${cache.events} P/S events, ` +
    `${cache.quartersFrom}..${cache.quartersThrough} (not yet published: ${cache.notPublished.join(", ") || "none"}), ` +
    `fetchedAt ${cache.fetchedAt}`);

  // FILING-LAG CHECK — identical to the raw screen; re-derived here rather
  // than trusted from that run because this is a separately pre-registered
  // script and must stand on its own checks.
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
  console.log(`\nFILING-LAG CHECK (d >= td): ${onOrAfter}/${totalEv} (${(100 * lagFrac).toFixed(2)}%) ` +
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

  // PRICE-SANITY CHECK — see header. Drops (never sign-flips) events whose
  // reported price is not within 10x of the panel's real close nearest their
  // transaction date. Informational, not a gate: the correction (drop) is
  // applied here and disclosed, and everything downstream reads `cleaned`.
  const ps = filterPriceSanity(cache, panel);
  const psTotal = ps.sane + ps.insane + ps.noBaseline;
  console.log(`\nPRICE-SANITY CHECK (price/close ratio within 10x of that symbol's own local median ratio, informational — drops applied, not gated):`);
  console.log(`  sane: ${ps.sane}/${psTotal} (${(100 * ps.sane / psTotal).toFixed(2)}%)  ` +
    `dropped (insane): ${ps.insane} (${(100 * ps.insane / psTotal).toFixed(3)}%, ` +
    `$${(ps.insaneDollars / 1e9).toFixed(2)}B of $${(ps.totalDollars / 1e9).toFixed(2)}B raw total)  ` +
    `kept-no-local-baseline (no panel bar near td, or <${PRICE_SANITY_MIN_NEIGHBORS} comparable neighbours): ${ps.noBaseline} (${(100 * ps.noBaseline / psTotal).toFixed(2)}%)`);
  if (ps.examples.length) {
    console.log("  example drops (ratio = price/close, baseline = symbol's local median ratio):");
    for (const { symbol, e, refClose, ratio, baseline } of ps.examples) {
      console.log(`    ${symbol} ${e.td} ${e.code} ${e.shares.toLocaleString()}sh @ $${e.price.toLocaleString()} ` +
        `vs close $${refClose} — ratio ${ratio.toFixed(2)} vs local baseline ${baseline.toFixed(2)} [${e.roles.join(",")}]`);
    }
  }
  const cleaned = ps.filtered;

  // ROLE-MIX CHECK — informational, printed after PRICE-SANITY so the
  // dollar-value shares it reports are not themselves distorted by the
  // corrupted rows this check just dropped.
  console.log("\nROLE-MIX CHECK (informational, no gate; post price-sanity):");
  const mix = roleMix(cleaned);
  const mixDollars = mix.reduce((a, b) => a + b.dollars, 0);
  const mixEvents = mix.reduce((a, b) => a + b.events, 0);
  for (const b of mix) {
    console.log(`  weight ${b.weight} (${b.bucket}): ${b.events} events (${(100 * b.events / mixEvents).toFixed(1)}%), ` +
      `$${(b.dollars / 1e9).toFixed(2)}B (${(100 * b.dollars / mixDollars).toFixed(1)}% of total dollar value)`);
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
      const { net } = reactionBars(row.candles, cleaned[row.symbol] ?? []);
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
    { key: "insider-role-follow", fade: false, blurb: "net role-weighted buying -> long, net selling -> short" },
    { key: "insider-role-fade", fade: true, blurb: "the mirror: net role-weighted buying -> short, net selling -> long" },
  ];

  // NO-LOOKAHEAD CHECK, on the signals the screen will actually trade.
  console.log("\nNO-LOOKAHEAD CHECK (every entry bar dated strictly after its filing's own date):");
  const built = new Map<string, PreparedSymbol[]>();
  for (const rule of RULES) {
    for (const fold of SCREEN_FOLDS) {
      const { prepared, reactions } = livableFold(slices[fold.name], cleaned, rule.fade);
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
