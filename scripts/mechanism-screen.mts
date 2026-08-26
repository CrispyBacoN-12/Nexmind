// Do any of these entry mechanisms separate from the baseline at all?
//
// WHY THIS EXISTS
//
// Four families are now closed as rejected: trend-pullback continuation (the
// desk's own baseline, ~+0.04R/trade at t=1.08 OOS, i.e. indistinguishable from
// zero), Donchian/breakout, the 13 confluence vetoes, and cross-sectional mean
// reversion + momentum. The market-gate work then showed the baseline's fold
// avgR is {-0.003, -0.034, +0.010, -0.024, -0.014} and only reaches ~0 with the
// gate on. Running more research rounds inside that family is searching the
// same drawer harder. This searches a different drawer.
//
// It is a MEASUREMENT, not a strategy. Nothing here is written to the DB,
// nothing can be approved from it, and no threshold is fitted. Each mechanism is
// an EntryRule handed to the same computeEntrySignals/simulateExits pipeline the
// panel uses, so every number below is directly comparable to the baseline row
// printed alongside it.
//
// PRE-REGISTRATION (fixed before the first run; do not extend after reading)
//
// Six mechanisms, one exit ladder, five folds = SIX tests. Written down because
// the p95 control bar only means what it says if the number of shots is known.
// If a seventh idea occurs after seeing these numbers, it is a NEW screen with
// its own count, not a row appended to this one.
//
// Every trigger is self-normalising — ranked or compared against the symbol's
// OWN trailing window, never against an absolute number. That is the one lesson
// the regime work actually established: breadth and realized vol both died
// because FIT-derived cut points do not transfer to 2022, while SPY-vs-its-own-
// SMA200 survived 5/5 precisely because it has no free parameter. Any mechanism
// carrying a fitted constant would fail the same way, so none is included.
//
// The window lengths that DO appear (3-day streak, 7-bar range rank, 20-bar
// volume rank, SMA50 direction) are conventional values taken as-is from the
// literature the mechanism comes from. They are pre-registered, not swept. If
// one of these survives, the sweep happens afterwards on FIT only.
//
// HOW TO READ IT
//
// Read the FIT and SELECT columns. TEST1-3 are printed so the eventual verdict
// is auditable from one log, NOT as a menu — picking a mechanism because its
// TEST3 looks good is how the folds get spent, and it is the specific mistake
// that put research-29 on the desk.
//
// The bar is not "positive". On this universe 69-87% of names rose in every
// window, so a long-biased rule clears zero on beta alone; that is what
// --control exists for. The screen bar is SIGN CONSISTENCY across FIT and
// SELECT plus a margin over the baseline large enough to be worth the second
// stage. Expect most or all of these to fail. That is the screen working.
//
//   npx tsx scripts/mechanism-screen.mts
//   npx tsx scripts/mechanism-screen.mts --ladder=trail
//   npx tsx scripts/mechanism-screen.mts --control=200   (slow: second stage only)
//
// ADDENDUM 2026-08-26 — the gap-fade-open row, and why it is not a seventh test
//
// The six above were screened on two disjoint universes and only gap-fade passed
// both screening folds, on both panels, while still losing money
// (docs/quant/2026-08-26-broad-universe-rerun.md). Its known defect is not
// statistical: the rule detects a gap that happened at the OPEN and the engine
// filled it at the CLOSE, six and a half hours later.
//
// gap-fade-open is that same rule under a corrected fill. It is an IMPLEMENTATION
// test of an already-screened mechanism, not a new idea, so it does not consume
// a shot from the count above — but it does get its own pre-registration, fixed
// here before it was first run:
//
//   1. FIT ONLY decides whether this continues. select and test1-3 are printed
//      for the audit trail and must not be read as the result.
//   2. The comparison is gap-fade-open vs gap-fade IN THE SAME RUN, both against
//      their own matched controls. An open fill changes the control too, so
//      cross-run comparison of raw margins is meaningless.
//   3. It passes only if the FIT margin over its own control p95 EXCEEDS
//      gap-fade's +0.012. Merely staying positive is the null result: it would
//      mean the six-and-a-half-hour delay was never what was costing the rule,
//      and the whole thread closes.
//   4. If it passes, the next step is select, then test — not a parameter sweep.
//      The 1.2/1.5 ladder was never designed for a fade, but sweeping it before
//      the fill question is settled fits two things at once and settles neither.
//
import "dotenv/config";
import { loadPanel, FOLDS, type Fold, type FoldName } from "@/lib/research/panel";
import {
  sliceFold, withSignals, simulateFold, runControl, PANEL_LOT, PANEL_SEED,
  type PanelExit, type FoldSliceRow,
} from "@/lib/research/panelRun";
import {
  computeEntrySignals, DEFAULT_COST_MODEL, WARMUP, type EntryRule,
} from "@/lib/backtest/engine";
import { sma, trueRange, type Candle } from "@/lib/indicators";

const LADDERS: Record<string, PanelExit> = {
  flat: { tp1Mult: 1.2, slMult: 1.5, singleTarget: true, lot: PANEL_LOT, costs: DEFAULT_COST_MODEL },
  trail: {
    tp1Mult: 1.2, slMult: 1.5, singleTarget: true, lot: PANEL_LOT, costs: DEFAULT_COST_MODEL,
    trail: { activateMult: 1.5, offsetMult: 1.5 },
  },
};

const FOLD_ORDER: FoldName[] = ["fit", "select", "test1", "test2", "test3"];

interface Mechanism {
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

const MECHANISMS: Mechanism[] = [
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

// ---------------------------------------------------------------------------

interface Row {
  fold: Fold;
  trades: number;
  symbolsTraded: number;
  avgR: number | null;
  winRate: number;
  controlP95: number | null;
  /** the MEDIAN random run — "did it beat a coin flip at all", a much weaker
   *  question than the p95 pass bar, and a different claim. Both are printed
   *  because "failed the p95 bar" and "lost to random" get confused otherwise. */
  controlMed: number | null;
}

const fmt = (v: number | null, d = 3) => (v == null || !Number.isFinite(v) ? "     —" : v.toFixed(d).padStart(6));

function signOf(v: number | null): string {
  if (v == null) return "?";
  return v > 0 ? "+" : v < 0 ? "-" : "0";
}

function printRows(mech: Mechanism, rows: Row[]) {
  console.log(`\n${mech.key}`);
  console.log(`  ${mech.blurb}`);
  console.log("    fold      trades  symbols    avgR     win%   ctrl med  ctrl p95   margin");
  for (const r of rows) {
    const margin = r.avgR != null && r.controlP95 != null ? r.avgR - r.controlP95 : null;
    const beat = r.avgR != null && r.controlMed != null ? (r.avgR > r.controlMed ? "  beats-median" : "  LOSES-to-median") : "";
    console.log(
      `    ${r.fold.name.padEnd(8)} ${String(r.trades).padStart(7)} ${String(r.symbolsTraded).padStart(8)}  ` +
        `${fmt(r.avgR)}  ${(r.winRate).toFixed(1).padStart(5)}%  ${fmt(r.controlMed)}   ${fmt(r.controlP95)}   ${fmt(margin)}${beat}`,
    );
  }
  const fitSel = rows.filter((r) => r.fold.name === "fit" || r.fold.name === "select").map((r) => r.avgR);
  const all = rows.map((r) => r.avgR);
  console.log(
    `    signs fit/select ${fitSel.map(signOf).join("")}  ·  all five ${all.map(signOf).join("")}` +
      (fitSel.every((v) => v != null && v > 0) ? "  <- both screening folds positive" : ""),
  );
}

async function main() {
  const ladderKey = (process.argv.find((a) => a.startsWith("--ladder="))?.split("=")[1] ?? "flat").trim();
  const exit = LADDERS[ladderKey];
  if (!exit) {
    console.error(`unknown --ladder=${ladderKey}; expected one of: ${Object.keys(LADDERS).join(", ")}`);
    process.exit(1);
  }
  const controlRuns = Number(process.argv.find((a) => a.startsWith("--control="))?.split("=")[1] ?? 0);

  // Stage-two filters. Stage one runs everything on everything; the control is
  // ~N times the cost of a plain fold, so it is pointed only at what survived
  // the sign screen. These narrow WHAT IS RECOMPUTED, never how it is computed —
  // the folds, the ladder and PANEL_SEED are identical either way, so a filtered
  // row is bit-identical to the same row in a full run.
  const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
  const only = onlyArg ? new Set(onlyArg.split(",").map((s) => s.trim())) : null;
  const foldsArg = process.argv.find((a) => a.startsWith("--folds="))?.split("=")[1];
  const foldNames = foldsArg
    ? (foldsArg.split(",").map((s) => s.trim()) as FoldName[])
    : FOLD_ORDER;
  for (const n of foldNames) if (!FOLDS[n]) { console.error(`unknown fold ${n}`); process.exit(1); }
  const mechanisms = only ? MECHANISMS.filter((m) => only.has(m.key)) : MECHANISMS;
  if (!mechanisms.length) { console.error(`--only matched no mechanism`); process.exit(1); }

  // --panel points the whole screen at a different bar cache. The mechanisms,
  // folds, ladder and PANEL_SEED are untouched, so running the same --only set
  // against two panels is a controlled comparison of the UNIVERSE and nothing
  // else. That is the only reason this flag exists; it is not a way to shop for
  // a cache that makes a row pass. Whichever panel produced a number must be
  // quoted alongside it — `fetchedAt` and the symbol count are printed below
  // precisely so a pasted log identifies its own data.
  const panelPath = process.argv.find((a) => a.startsWith("--panel="))?.split("=")[1];
  console.log("loading panel cache…");
  const panel = panelPath ? loadPanel(panelPath) : loadPanel();
  console.log(`panel ${panel.cachePath} — ${panel.symbols.length} symbols, fetchedAt ${panel.fetchedAt}`);
  const dropped = Object.entries(panel.droppedBars).sort((a, b) => b[1] - a[1]);
  if (dropped.length) {
    const total = dropped.reduce((a, [, n]) => a + n, 0);
    console.log(
      `  dropped ${total} placeholder bar(s) (o==h==l==c, no volume) across ${dropped.length} symbol(s): ` +
        dropped.map(([sym, n]) => `${sym} ${n}`).join(", "),
    );
  }
  console.log(`ladder=${ladderKey} ${JSON.stringify(exit.trail ?? "no trail")}  control=${controlRuns || "off"}`);
  console.log(`WARMUP=${WARMUP} bars, ${mechanisms.length} mechanism row(s), folds: ${foldNames.join(", ")}`);

  // Slices are cut once and shared across every mechanism: slicing is per-fold
  // while signals are per-mechanism, and cutting them seven times would be seven
  // passes over 89MB for identical output.
  const slices: Record<FoldName, FoldSliceRow[]> = {} as Record<FoldName, FoldSliceRow[]>;
  for (const name of foldNames) {
    slices[name] = sliceFold(panel, FOLDS[name]);
    console.log(`  ${name}: ${slices[name].length} symbols participate`);
  }

  for (const mech of mechanisms) {
    const rows: Row[] = [];
    for (const name of foldNames) {
      const fold = FOLDS[name];
      const prepared = withSignals(slices[name], (_sym, candles) =>
        computeEntrySignals(candles, undefined, mech.rule ? mech.rule(candles) : undefined),
      );
      // The control gets the SAME exit object, so it fills where the rule fills.
      const mechExit = mech.entryAt ? { ...exit, entryAt: mech.entryAt } : exit;
      const run = simulateFold(prepared, fold, mechExit);
      let controlP95: number | null = null;
      let controlMed: number | null = null;
      if (controlRuns > 0) {
        const ctrl = runControl(prepared, fold, mechExit, controlRuns, PANEL_SEED);
        controlP95 = ctrl?.p95 ?? null;
        controlMed = ctrl?.median ?? null;
      }
      rows.push({
        fold,
        trades: run.trades.length,
        symbolsTraded: run.symbolsTraded,
        avgR: run.summary.avgR,
        winRate: run.summary.winRate,
        controlP95,
        controlMed,
      });
    }
    printRows(mech, rows);
  }

  console.log(
    "\nreminder: FIT and SELECT are the screening folds. The TEST columns are printed for the\n" +
      "audit trail — choosing a mechanism from them spends the only untouched data left.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
