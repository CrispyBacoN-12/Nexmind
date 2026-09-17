// The pre-registered entry mechanisms, and the exit ladders they are screened on.
//
// These lived in scripts/mechanism-screen.mts until 2026-09-05. They were lifted
// here unchanged so a SECOND harness — scripts/deep-holdout.mts, which runs the
// same rules over pre-2016 folds the panel has never seen — can import the exact
// objects the first one screened rather than a copy of them. A copy would be the
// worst possible arrangement: the two logs would look comparable, and a one-word
// drift in either file would silently make them not be, with no test able to
// notice because both files would still be internally consistent.
//
// Importing from the script itself is not an option: mechanism-screen.mts calls
// main() at module scope, so an import would run the whole screen as a side
// effect of asking what the rules are.
//
// This module is DATA and is deliberately inert — no I/O, no argv, no console.
// Nothing here is fitted; see the pre-registration header in
// scripts/mechanism-screen.mts for what was fixed before the first run and why
// each window length is a convention taken from the literature rather than a
// swept parameter.

import { PANEL_LOT, type PanelExit } from "@/lib/research/panelRun";
import { DEFAULT_COST_MODEL, type EntryRule } from "@/lib/backtest/engine";
import { sma, trueRange, type Candle } from "@/lib/indicators";

export const LADDERS: Record<string, PanelExit> = {
  flat: { tp1Mult: 1.2, slMult: 1.5, singleTarget: true, lot: PANEL_LOT, costs: DEFAULT_COST_MODEL },
  trail: {
    tp1Mult: 1.2, slMult: 1.5, singleTarget: true, lot: PANEL_LOT, costs: DEFAULT_COST_MODEL,
    trail: { activateMult: 1.5, offsetMult: 1.5 },
  },
};

export interface Mechanism {
  key: string;
  /** one line, printed above the row — what claim is being tested */
  blurb: string;
  /** null means "use the built-in decideSetup", i.e. the baseline reference row */
  rule: ((candles: Candle[]) => EntryRule) | null;
  /**
   * Fill price. Omitted = "close", which is what every row screened on
   * 2026-08-26 used and the only legal value for a rule that reads bar i's
   * close. Set it ONLY for a rule decidable from the opening print; see
   * ExitOptions.entryAt in the engine for what that costs and guarantees.
   */
  entryAt?: "close" | "open" | "open-unmanaged";
}

// ---------------------------------------------------------------------------
// Shared helpers. All read strictly indices <= i: simulateExits fills at the
// CLOSE of the signal bar, so bar i's own o/h/l/c/v is known and bar i+1 is not.
// ---------------------------------------------------------------------------

/** True when x is the smallest of the `period` values ending at i (inclusive). */
function isMinOfWindow(values: number[], i: number, period: number): boolean {
  if (i < period - 1) return false;
  const x = values[i];
  for (let k = i - period + 1; k < i; k++) if (values[k] <= x) return false;
  return true;
}

/** True when x is the largest of the `period` values ending at i (inclusive). */
function isMaxOfWindow(values: number[], i: number, period: number): boolean {
  if (i < period - 1) return false;
  const x = values[i];
  for (let k = i - period + 1; k < i; k++) if (values[k] >= x) return false;
  return true;
}

/**
 * The last weekday of the calendar month containing `t`.
 *
 * Deliberately computed from the CALENDAR and not from the bar array. Asking
 * "is candles[i+1] in a new month?" would be lookahead — it reads a bar that has
 * not printed. The last weekday of March is knowable in January, so a desk could
 * genuinely place this order; a market holiday simply means no bar exists that
 * day and the rule fires on nothing.
 */
function isLastWeekdayOfMonth(t: number): boolean {
  const d = new Date(t * 1000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0));
  while (last.getUTCDay() === 0 || last.getUTCDay() === 6) last.setUTCDate(last.getUTCDate() - 1);
  return d.getUTCDate() === last.getUTCDate();
}

// ---------------------------------------------------------------------------
// The six. Each returns an EntryRule closed over one symbol's candles.
// ---------------------------------------------------------------------------

export const MECHANISMS: Mechanism[] = [
  {
    key: "baseline",
    blurb: "decideSetup() — the desk's trend-pullback rule, printed as the reference row",
    rule: null,
  },
  {
    key: "mr-down3",
    blurb: "time-series mean reversion: long after 3 consecutive lower closes",
    // NOT the cross-sectional mean reversion that was rejected. That one ranked
    // names against each other and traded the spread; this reads only the
    // symbol's own path and never compares two symbols. Different mechanism,
    // different failure mode, so the closed loop does not cover it.
    rule: (c) => (i) => {
      if (i < 3) return null;
      return c[i].c < c[i - 1].c && c[i - 1].c < c[i - 2].c && c[i - 2].c < c[i - 3].c ? "long" : null;
    },
  },
  {
    key: "nr7",
    blurb: "volatility contraction: narrowest range of 7, direction from the symbol's own SMA50",
    // The trigger is the COMPRESSION, not a level break — which is what keeps it
    // out of the rejected breakout family. Direction has to come from somewhere
    // and SMA50 is the cheapest self-normalising choice available at bar i.
    rule: (c) => {
      const ranges = c.map((b) => b.h - b.l);
      const s50 = sma(c.map((b) => b.c), 50);
      return (i) => {
        if (!isMinOfWindow(ranges, i, 7)) return null;
        const m = s50[i];
        if (m == null) return null;
        return c[i].c > m ? "long" : "short";
      };
    },
  },
  {
    key: "gap-fade",
    blurb: "gap fade: long when the open gapped below yesterday's low, short above yesterday's high",
    // Fills at the CLOSE of the gap bar, not at the open — simulateExits has no
    // intrabar entry. So this is "the gap happened this morning, fade it into
    // the close", a strictly weaker and strictly implementable version.
    rule: (c) => (i) => {
      if (i < 1) return null;
      if (c[i].o < c[i - 1].l) return "long";
      if (c[i].o > c[i - 1].h) return "short";
      return null;
    },
  },
  {
    key: "gap-fade-open",
    blurb: "gap fade, filled at the OPEN — same rule, the price the mechanism actually describes",
    // Identical rule to gap-fade. The ONLY difference is entryAt, which is why
    // the two rows are printed from the same run over the same folds with the
    // same PANEL_SEED: the pair IS the measurement, and comparing this row to a
    // gap-fade number quoted from a different run would not be.
    //
    // Legal here and nowhere else in this file: the trigger reads bar i's OPEN
    // and bar i-1's high/low, both known at 09:30. The stop is sized off
    // atrs[i-1] and the entry bar is managed, both handled in simulateExits.
    entryAt: "open",
    rule: (c) => (i) => {
      if (i < 1) return null;
      if (c[i].o < c[i - 1].l) return "long";
      if (c[i].o > c[i - 1].h) return "short";
      return null;
    },
  },
  {
    key: "gap-fade-open-nomanage",
    blurb: "DIAGNOSTIC ONLY, not implementable — open fill with the entry session left unmanaged",
    // Attribution row, added 2026-08-26 AFTER gap-fade-open failed, and it cannot
    // rescue it: the pre-registered verdict is recorded on the two rows above and
    // does not depend on this one. What it decides is something else — whether
    // intraday bars are still worth building. gap-fade-open moved the fill AND
    // started managing the entry session pessimistically, and gap bars have wide
    // ranges, so the control (which enters on ordinary bars) cannot subtract that
    // second effect. If the damage is the fill price, intraday data cannot help.
    // If it is the same-session ambiguity, intraday data is exactly what resolves
    // it. This row separates the two and is quotable for nothing else.
    entryAt: "open-unmanaged",
    rule: (c) => (i) => {
      if (i < 1) return null;
      if (c[i].o < c[i - 1].l) return "long";
      if (c[i].o > c[i - 1].h) return "short";
      return null;
    },
  },
  {
    key: "turn-of-month",
    blurb: "calendar: long on the last weekday of each month — zero parameters, zero price input",
    // Included precisely because it is orthogonal to everything above: it cannot
    // be a repackaging of trend, breakout or reversion, since it never reads a
    // price. If the whole screen is noise, this row is the cleanest evidence of
    // it, because a calendar has no story about why THIS universe.
    rule: (c) => (i) => (isLastWeekdayOfMonth(c[i].t) ? "long" : null),
  },
  {
    key: "vol-dryup",
    blurb: "volume dry-up: lowest volume of 20 while the close holds above its own SMA50",
    rule: (c) => {
      const vols = c.map((b) => b.v);
      const s50 = sma(c.map((b) => b.c), 50);
      return (i) => {
        const m = s50[i];
        if (m == null || c[i].c <= m) return null;
        return isMinOfWindow(vols, i, 20) ? "long" : null;
      };
    },
  },
  {
    key: "range-expand",
    blurb: "range expansion: largest true range of 20, closing in the top/bottom quarter of its own bar",
    rule: (c) => {
      const tr = trueRange(c);
      return (i) => {
        if (!isMaxOfWindow(tr, i, 20)) return null;
        const span = c[i].h - c[i].l;
        if (span <= 0) return null;
        const pos = (c[i].c - c[i].l) / span;
        if (pos >= 0.75) return "long";
        if (pos <= 0.25) return "short";
        return null;
      };
    },
  },
];

/**
 * One mechanism by key, or a thrown error naming what is available.
 *
 * Resolves across BOTH name spaces on purpose: a key is a key, and a lookup that
 * silently could not see half the table would fail as "unknown mechanism" — the
 * one error message guaranteed to send the reader looking in the wrong place.
 * Which rules a given SCREEN runs is decided by the array it iterates
 * (`MECHANISMS`, `XAU_HYPOTHESES`), never by what this function can find.
 */
export function mechanismByKey(key: string): Mechanism {
  const m = ALL_MECHANISMS.find((x) => x.key === key);
  if (!m) throw new Error(`unknown mechanism ${key}; expected one of: ${ALL_MECHANISMS.map((x) => x.key).join(", ")}`);
  return m;
}

// ---------------------------------------------------------------------------
// The XAUUSD hypotheses. H1 bars, UTC.
//
// Kept in a SEPARATE array rather than appended to MECHANISMS, for the same
// reason DeepFoldName is kept out of FoldName: the equity screen's row set is
// the population its multiple-testing argument was written against, and three
// rules that can only fire on intraday gold bars would silently enlarge it.
// A rule below run on daily bars is not a weaker version of itself — the hour
// of a daily bar is meaningless, so it would fire on nothing or on everything.
//
// Every window here is a convention, not a swept value, and each says which:
// that is the only property that makes a four-hypothesis screen on ONE symbol
// worth running at all. Pre-registered in
// docs/quant/2026-09-08-xauusd-preregistration.md §6.
// ---------------------------------------------------------------------------

/** London's open, UTC. The hour gold's European session begins. */
const LONDON_OPEN_UTC = 7;
/** New York's open, UTC — 13:30 in the cash market, so the 13:00 H1 bar is the one that spans it. */
const NY_OPEN_UTC = 13;
/** 01:00–06:00 UTC: the six H1 bars preceding the London open, i.e. the Asian session. */
const SESSION_RANGE_BARS = 6;
/** ~20 days of 24-hour trading. The managed-futures convention for "the daily trend". */
const DAILY_TREND_BARS = 480;
/** One day of H1 bars. The execution trigger's window, deliberately the shortest natural one. */
const DAY_BARS = 24;

const hourUtc = (t: number) => new Date(t * 1000).getUTCHours();

/** Highest high / lowest low over the `period` bars ENDING AT i-1 — bar i itself excluded. */
function priorRange(c: Candle[], i: number, period: number): { hi: number; lo: number } | null {
  if (i < period) return null;
  let hi = -Infinity, lo = Infinity;
  for (let k = i - period; k < i; k++) {
    if (c[k].h > hi) hi = c[k].h;
    if (c[k].l < lo) lo = c[k].l;
  }
  return { hi, lo };
}

export const XAU_MECHANISMS: Mechanism[] = [
  {
    key: "xau-session-break",
    blurb: "session-open breakout: at the London (07:00) or NY (13:00) H1 bar, break of the prior 6 hours' range",
    // Hypothesis 2. The claim is intraday seasonality — that gold's two session
    // opens carry directional information the rest of the day does not — and it
    // is taken from the literature rather than found by sweeping hours here.
    // Sweeping all 24 would be picking the best of 24 draws on one symbol, which
    // probe-selection-strength.log priced at a free +0.028 FIT avgR on a panel
    // with fifty times this sample.
    rule: (c) => (i) => {
      const h = hourUtc(c[i].t);
      if (h !== LONDON_OPEN_UTC && h !== NY_OPEN_UTC) return null;
      const r = priorRange(c, i, SESSION_RANGE_BARS);
      if (!r) return null;
      if (c[i].c > r.hi) return "long";
      if (c[i].c < r.lo) return "short";
      return null;
    },
  },
  {
    key: "xau-asia-fade",
    blurb: "Asian-range fade: at the London open, fade a break of the 01:00-06:00 range",
    // Hypothesis 3, the mirror image of hypothesis 2 and deliberately measured
    // in the same run. Only the London bar, because only there is the prior
    // six-bar window actually the Asian session — at 13:00 it is the London
    // morning, and calling that "the Asian range" would make the pair not a
    // mirror. The pair IS the measurement: if both rows beat their controls,
    // the control is what is wrong, not the market.
    rule: (c) => (i) => {
      if (hourUtc(c[i].t) !== LONDON_OPEN_UTC) return null;
      const r = priorRange(c, i, SESSION_RANGE_BARS);
      if (!r) return null;
      if (c[i].c > r.hi) return "short";
      if (c[i].c < r.lo) return "long";
      return null;
    },
  },
  {
    key: "xau-daily-trend",
    blurb: "daily trend, H1 execution: one-day breakout taken only in the direction of the 20-day mean",
    // Hypothesis 4 — the momentum property managed futures have traded in gold
    // for decades. Deliberately a BREAKOUT in the trend's direction rather than
    // a pullback: a pullback version would be mr-down3 wearing a filter, and the
    // two rows would then be one hypothesis counted twice.
    rule: (c) => {
      const trend = sma(c.map((b) => b.c), DAILY_TREND_BARS);
      return (i) => {
        const m = trend[i];
        if (m == null) return null;
        const r = priorRange(c, i, DAY_BARS);
        if (!r) return null;
        if (c[i].c > m && c[i].c > r.hi) return "long";
        if (c[i].c < m && c[i].c < r.lo) return "short";
        return null;
      };
    },
  },
];

/**
 * The longest lookback any XAU rule needs, so a warm-up can be checked against
 * it rather than assumed. A fold whose warm-up is shorter than this runs
 * xau-daily-trend cold at its start and warm later — the boundary artifact
 * PANEL_WARMUP_BARS exists to prevent, which would surface as one fold
 * disagreeing with the others, i.e. as a regime finding.
 */
export const XAU_MAX_LOOKBACK_BARS = DAILY_TREND_BARS;

/**
 * Every mechanism this module defines, across both name spaces.
 *
 * Declared before XAU_HYPOTHESES because that constant resolves `mr-down3`
 * through `mechanismByKey` at module scope, and a const read before its
 * declaration is a TDZ throw at import time, not a lint warning.
 */
export const ALL_MECHANISMS: Mechanism[] = [...MECHANISMS, ...XAU_MECHANISMS];

/**
 * The four pre-registered hypotheses, in order.
 *
 * `mr-down3` is the SAME OBJECT the equity screen and the deep hold-out ran, not
 * a gold translation of it — which is the entire point of hypothesis 1. A rule
 * with no fitted parameters, moved to a different asset class and a different
 * timeframe with not one character changed, is the strongest transfer test this
 * project can construct.
 */
export const XAU_HYPOTHESES: Mechanism[] = [mechanismByKey("mr-down3"), ...XAU_MECHANISMS];
