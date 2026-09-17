// Does mr-down3's edge survive five whole-share slots at $2-3k?
//
// WHY THIS EXISTS
//
// On 2026-09-05 mr-down3 passed the deep hold-out (docs/quant/2026-09-05-deep-holdout.md):
// median 3/3 and p95 3/3 on 1998-2016 data no fold had ever touched, with the
// survivorship objection measured and dismissed. That settles whether there is
// an edge. It does not settle whether the edge is REACHABLE, and the reason is
// visible in the harness rather than in the statistics:
//
//   for (const p of prepared) { simulateExits(...); trades.push(...) }
//
// simulateFold runs every symbol INDEPENDENTLY and pools the trades. There is no
// slot limit, no capital, no concurrency anywhere in src/lib/backtest or
// src/lib/research — grep for maxOpen, openPositions or equityCurve and you get
// nothing. So every number this project has ever produced, the hold-out
// included, is a per-trade average under INFINITE CAPITAL AND INFINITE SLOTS.
//
// mr-down3 fires roughly 40 times a day across 453 names. The desk holds about
// five whole-share positions on $2-3k (Webull, no fractional). The gap between
// +0.070R per trade and a number in a brokerage account is not a tuning gap; it
// is this missing layer. This script is that layer.
//
// WHAT IS ACTUALLY MODELLED
//
// Three constraints at once, none of them a free parameter:
//
//   1. SLOTS. At most `--slots` positions open at any time. A signal arriving
//      with every slot busy is DROPPED, not queued — there is no second chance
//      at yesterday's price.
//   2. WHOLE SHARES. Each slot gets a fixed budget of capital/slots. shares =
//      floor(budget / entry). A $600 stock on a $500 slot is UNBUYABLE and the
//      signal is lost entirely. This silently reshapes the tradeable universe
//      toward cheap stocks, which no backtest in this repo has ever accounted for.
//   3. NO COMPOUNDING. The slot budget is computed from STARTING capital and
//      never grows. That isolates the capacity question from the compounding
//      question; a compounding run would mix a real effect with a bookkeeping one.
//
// Per-share P&L is t.pnl / t.lot. Both slippage and commission are proportional
// to notional in the cost model, so pnl is linear in lot and the division is
// exact rather than an approximation.
//
// WHICH FIVE OF THE FORTY
//
// The one thing this script must NOT do is invent a ranking. "Take the five with
// the deepest pullback" is a new rule with its own free parameters and would need
// its own hold-out; choosing one here, on data already read, is the exact failure
// the deep hold-out was built to avoid. So ties within a timestamp are broken by
// a SEEDED SHUFFLE, and the run reports the spread across --orderings different
// shuffles. That spread is itself the answer to "does it matter which five you
// take": narrow means any selection works, wide means selection is the whole game
// and a follow-up experiment is owed.
//
// PRE-REGISTRATION — written before the first run, not edited afterwards.
//
//   HYPOTHESIS: mr-down3's edge survives the real account constraint.
//
//   HEADLINE CONFIG, fixed here so it cannot be shopped for: capital $2,500,
//   5 slots, >= 1 whole share. That is the desk's actual constraint, not a
//   configuration chosen because it passed.
//
//   PASS requires ALL THREE:
//     (a) beats the matched control's MEDIAN annualised return in >= 4 of 5
//         post-2016 folds AND >= 2 of 3 deep folds;
//     (b) the median-ordering annualised return is POSITIVE in each fold that
//         counts toward (a) — beating a negative control while losing money is
//         the gap-fade failure mode and does not count here;
//     (c) the p5 of the ordering spread is positive in >= 3 of 5 post-2016 folds,
//         i.e. an unlucky choice of which five to take does not sink it.
//
//     WHY (a) SAYS 4 OF 5 AND NOT 5 OF 5, stated plainly because the number was
//     not chosen innocently: mr-down3 is ALREADY KNOWN to lose to the control in
//     SELECT, on both universes, and a 5/5 bar would therefore be a rule written
//     to fail before it ran. A threshold set around a known miss is only honest
//     if it names the miss, so: the one permitted failure is SELECT. If the fold
//     that misses is any OTHER fold, that is a FAIL of this pre-registration even
//     at 4 of 5 — a new hole is not the old hole, and 4/5 is not a budget of one
//     free fold to spend wherever it lands.
//
//   ANYTHING LESS IS A FAIL, and the pre-registered consequence is NOT a search
//   for a better selection rule. A fail means the edge is real but unreachable at
//   this account size, and the only honest responses are more capital, a cheaper
//   instrument, or dropping it. Searching for the ranking that rescues it would be
//   fitting a rule to the folds that just rejected it.
//
//   The other configurations printed below run WITHOUT a control and are labelled
//   as such. They are an audit trail, not verdicts, and none may be promoted.
//
// KNOWN LIMITS OF THIS MEASUREMENT — read before quoting any number
//
//   * Prices are split- and dividend-ADJUSTED in both caches. Adjusted history
//     runs BELOW the nominal price that was actually quoted, so affordability in
//     the deep folds looks better here than it was in 2001. The post-2016 folds
//     are the trustworthy affordability reading; the deep ones are optimistic on
//     that axis specifically.
//   * Drawdown is computed on the REALISED equity curve, so it understates the
//     true peak-to-trough of an account holding open positions.
//   * A slot is freed when a position closes on or before the bar a new signal
//     fills at. With close fills that is correct; it would be optimistic for an
//     intraday entry.
//
//   npx tsx scripts/portfolio-capacity.mts | tee scripts/portfolio-capacity.log
//   npx tsx scripts/portfolio-capacity.mts --control=0     (fast, NOT a result)
//
import "dotenv/config";
import {
  loadPanel, FOLDS, DEEP_FOLD_LIST, DEEP_PANEL_CACHE_PATH,
  type Fold, type FoldName,
} from "@/lib/research/panel";
import { sliceFold, withSignals, simulateFold, PANEL_SEED } from "@/lib/research/panelRun";
import { matchedRandomSignals, mulberry32, percentile } from "@/lib/research/control";
import { LADDERS, mechanismByKey } from "@/lib/research/mechanisms";
import { computeEntrySignals, type SimTrade } from "@/lib/backtest/engine";

const HYPOTHESIS = "mr-down3";
const EXIT = LADDERS.flat;
const SHALLOW_FOLDS: FoldName[] = ["fit", "select", "test1", "test2", "test3"];

/** The desk's real constraint. Fixed in the pre-registration above; not a tuning knob. */
const HEADLINE = { capital: 2_500, slots: 5 };

/** Audit rows only — no control is run for these and none is a verdict. */
const AUDIT_CONFIGS = [
  { capital: 2_500, slots: 3, note: "fewer slots, same money" },
  { capital: 5_000, slots: 5, note: "double the capital" },
  { capital: 25_000, slots: 5, note: "ten times the capital — is it the slots or the share price?" },
  { capital: Infinity, slots: Infinity, note: "unconstrained — must reproduce the hold-out" },
];

interface PortfolioConfig {
  capital: number;
  slots: number;
}

interface PortfolioResult {
  offered: number;
  taken: number;
  skippedFull: number;
  skippedUnaffordable: number;
  netPnl: number;
  /** net P&L as a fraction of STARTING capital, divided by the fold's length in years */
  annualised: number;
  /** deepest peak-to-trough of the realised equity curve, as a fraction of starting capital */
  maxDrawdown: number;
  /** median whole shares per taken trade — 1 means R is quantised to nothing */
  medianShares: number;
}

const foldYears = (fold: Fold) =>
  (Date.parse(fold.to) - Date.parse(fold.from)) / (365.25 * 86_400_000);

/**
 * Replay a pooled trade list as an ACCOUNT: slots, whole shares, dropped signals.
 *
 * The trade list itself is fixed — this decides only which of those trades the
 * account was actually able to hold. Ordering within a timestamp comes from
 * `rng`, never from a ranking, for the reason in the header.
 */
function walkPortfolio(trades: SimTrade[], cfg: PortfolioConfig, rng: () => number, years: number): PortfolioResult {
  const budget = cfg.capital / cfg.slots;

  // Sort by fill time, ties broken at random. A stable sort on a random key is
  // what keeps "which five of the forty" out of the hands of any rule.
  const ordered = trades
    .map((t) => ({ t, at: t.openedAt.getTime(), key: rng() }))
    .sort((a, b) => a.at - b.at || a.key - b.key);

  /** closing times of currently-open positions, kept small so a linear scan is cheaper than a heap */
  let open: number[] = [];
  const realised: { at: number; pnl: number }[] = [];
  const shareCounts: number[] = [];
  let taken = 0, skippedFull = 0, skippedUnaffordable = 0, netPnl = 0;

  for (const { t, at } of ordered) {
    open = open.filter((closeAt) => closeAt > at);

    // Slots first: a signal arriving with every slot held is refused by the slot
    // limit whatever it costs, and counting it as unaffordable would move the
    // blame for a full book onto the price of the stock.
    if (open.length >= cfg.slots) { skippedFull++; continue; }
    const shares = Number.isFinite(budget) ? Math.floor(budget / t.entry) : 1;
    if (shares < 1) { skippedUnaffordable++; continue; }

    const perShare = t.pnl / t.lot;
    const pnl = shares * perShare;
    netPnl += pnl;
    taken++;
    shareCounts.push(shares);
    realised.push({ at: t.closedAt.getTime(), pnl });
    open.push(t.closedAt.getTime());
  }

  // Realised equity curve. Understates a live account's drawdown, which also
  // carries open positions — said plainly in the header rather than hidden here.
  // Settle every position closing on the same bar before reading the curve.
  // Sorting on `at` alone leaves same-timestamp trades in arbitrary order, and
  // if the losers happen to land first the walk records a drawdown that existed
  // for no length of time and that no daily equity curve would ever show — an
  // artefact of the RNG seed, reported as risk.
  realised.sort((a, b) => a.at - b.at);
  let equity = 0, peak = 0, maxDrawdown = 0;
  for (let i = 0; i < realised.length; ) {
    const at = realised[i].at;
    while (i < realised.length && realised[i].at === at) equity += realised[i++].pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  shareCounts.sort((a, b) => a - b);
  return {
    offered: trades.length,
    taken,
    skippedFull,
    skippedUnaffordable,
    netPnl,
    annualised: Number.isFinite(cfg.capital) ? netPnl / cfg.capital / years : netPnl / years,
    maxDrawdown: Number.isFinite(cfg.capital) ? maxDrawdown / cfg.capital : maxDrawdown,
    medianShares: shareCounts.length ? shareCounts[shareCounts.length >> 1] : 0,
  };
}

const pct = (v: number) => `${(v * 100).toFixed(1).padStart(6)}%`;

async function main() {
  const controlRuns = Number(process.argv.find((a) => a.startsWith("--control="))?.split("=")[1] ?? 200);
  // At least one walk: every consumer below indexes into `walks`, so an
  // --orderings=0 would not run "no shuffles", it would read undefined.
  // Math.max(1, NaN) is NaN, and Array.from({length: NaN}) is empty, so a typo'd
  // --orderings=foo would not fail here — it would fail 50 lines down reading
  // walks[NaN >> 1]. Reject the argument where it is parsed.
  const orderingsArg = Number(process.argv.find((a) => a.startsWith("--orderings="))?.split("=")[1] ?? 50);
  if (!Number.isFinite(orderingsArg) || orderingsArg < 1) {
    console.error(`--orderings must be a number >= 1, got ${JSON.stringify(String(orderingsArg))}`);
    process.exit(1);
  }
  const orderings = Math.floor(orderingsArg);

  const mech = mechanismByKey(HYPOTHESIS);
  if (!mech) { console.error(`no mechanism ${HYPOTHESIS}`); process.exit(1); }

  console.log("loading both panel caches…");
  const shallow = loadPanel();
  const deep = loadPanel(DEEP_PANEL_CACHE_PATH);
  console.log(`shallow ${shallow.cachePath} — ${shallow.symbols.length} symbols`);
  console.log(`deep    ${deep.cachePath} — ${deep.symbols.length} symbols`);
  console.log(
    `mechanism=${HYPOTHESIS}  ladder=flat  seed=${PANEL_SEED}  ` +
      `control=${controlRuns || "OFF (not a result)"}  orderings=${orderings}`,
  );
  console.log(`headline: $${HEADLINE.capital.toLocaleString()} capital, ${HEADLINE.slots} slots, >= 1 whole share\n`);

  const jobs: { fold: Fold; deepPanel: boolean }[] = [
    ...SHALLOW_FOLDS.map((n) => ({ fold: FOLDS[n], deepPanel: false })),
    ...DEEP_FOLD_LIST.map((f) => ({ fold: f, deepPanel: true })),
  ];

  interface FoldOutcome {
    fold: Fold;
    deepPanel: boolean;
    headline: PortfolioResult;
    p5: number;
    p95: number;
    controlMedian: number | null;
    controlP95: number | null;
    audits: { cfg: PortfolioConfig; note: string; res: PortfolioResult }[];
  }
  const outcomes: FoldOutcome[] = [];

  for (const { fold, deepPanel } of jobs) {
    const panel = deepPanel ? deep : shallow;
    const years = foldYears(fold);
    const slice = sliceFold(panel, fold);
    const prepared = withSignals(slice, (_sym, candles) =>
      computeEntrySignals(candles, undefined, mech.rule ? mech.rule(candles) : undefined),
    );
    const run = simulateFold(prepared, fold, EXIT);

    // The strategy's trade list is fixed; only the ordering varies, and a walk is
    // pure post-processing, so many orderings cost almost nothing.
    const rng = mulberry32(PANEL_SEED);
    const walks = Array.from({ length: orderings }, () => walkPortfolio(run.trades, HEADLINE, rng, years));
    const annualisedSorted = walks.map((w) => w.annualised).sort((a, b) => a - b);
    // report the MEDIAN ordering's full row, so the counts and the return agree
    const medianWalk = [...walks].sort((a, b) => a.annualised - b.annualised)[orderings >> 1];

    // Matched control: identical slot machinery over random-entry trade lists, so
    // the comparison isolates entry timing and nothing else.
    let controlMedian: number | null = null;
    let controlP95: number | null = null;
    if (controlRuns > 0) {
      const crng = mulberry32(PANEL_SEED);
      const ctrl: number[] = [];
      for (let i = 0; i < controlRuns; i++) {
        const shuffled = prepared.map((p) => ({ ...p, signals: matchedRandomSignals(p.signals, p.entryFrom, crng) }));
        const cr = simulateFold(shuffled, fold, EXIT);
        ctrl.push(walkPortfolio(cr.trades, HEADLINE, crng, years).annualised);
      }
      ctrl.sort((a, b) => a - b);
      controlMedian = percentile(ctrl, 0.5);
      controlP95 = percentile(ctrl, 0.95);
    }

    const audits = AUDIT_CONFIGS.map(({ capital, slots, note }) => ({
      cfg: { capital, slots },
      note,
      res: walkPortfolio(run.trades, { capital, slots }, mulberry32(PANEL_SEED), years),
    }));

    outcomes.push({
      fold, deepPanel,
      headline: medianWalk,
      p5: percentile(annualisedSorted, 0.05),
      p95: percentile(annualisedSorted, 0.95),
      controlMedian, controlP95,
      audits,
    });

    console.log(`${fold.name}  ${fold.from}..${fold.to}  (${years.toFixed(1)}y, ${deepPanel ? "deep" : "post-2016"} panel)`);
    console.log(
      `  signals offered ${medianWalk.offered}  ->  taken ${medianWalk.taken}` +
        `  ·  dropped: slots full ${medianWalk.skippedFull}, unaffordable ${medianWalk.skippedUnaffordable}` +
        `  ·  median size ${medianWalk.medianShares} share(s)`,
    );
    console.log(
      `  annualised return on $${HEADLINE.capital.toLocaleString()}: ${pct(medianWalk.annualised)}` +
        `   [ordering p5 ${pct(annualisedSorted.length ? percentile(annualisedSorted, 0.05) : 0)}` +
        `, p95 ${pct(annualisedSorted.length ? percentile(annualisedSorted, 0.95) : 0)}]` +
        `   realised maxDD ${pct(medianWalk.maxDrawdown)}`,
    );
    if (controlMedian != null) {
      const margin = medianWalk.annualised - controlMedian;
      console.log(
        `  control median ${pct(controlMedian)}  p95 ${pct(controlP95 ?? 0)}` +
          `   MARGIN ${pct(margin)}  ${margin > 0 ? "beats-median" : "LOSES-to-median"}`,
      );
    }
    console.log(`  audit rows (no control, not verdicts):`);
    for (const a of audits) {
      const label = Number.isFinite(a.cfg.capital)
        ? `$${a.cfg.capital.toLocaleString()} / ${a.cfg.slots} slots`
        : `unconstrained`;
      console.log(
        `    ${label.padEnd(24)} taken ${String(a.res.taken).padStart(6)}` +
          `  full ${String(a.res.skippedFull).padStart(6)}  unafford ${String(a.res.skippedUnaffordable).padStart(6)}` +
          `  ann ${Number.isFinite(a.cfg.capital) ? pct(a.res.annualised) : `${a.res.annualised.toFixed(1).padStart(5)}$/y`}  · ${a.note}`,
      );
    }
    console.log("");
  }

  // ---- verdict, against the three conditions fixed in the header ----
  console.log("=".repeat(78));
  console.log("VERDICT — the three pre-registered conditions");
  console.log("=".repeat(78));

  const shallowOut = outcomes.filter((o) => !o.deepPanel);
  const deepOut = outcomes.filter((o) => o.deepPanel);
  const beats = (o: FoldOutcome) => o.controlMedian != null && o.headline.annualised > o.controlMedian;
  const beatsAndPositive = (o: FoldOutcome) => beats(o) && o.headline.annualised > 0;

  const aShallow = shallowOut.filter(beats).length;
  const aDeep = deepOut.filter(beats).length;
  const bShallow = shallowOut.filter(beatsAndPositive).length;
  const bDeep = deepOut.filter(beatsAndPositive).length;
  const cShallow = shallowOut.filter((o) => o.p5 > 0).length;

  // The header permits ONE post-2016 miss and names it: SELECT, the fold
  // mr-down3 is already known to lose. A bare count of >= 4 does not say that —
  // it hands out one free failure to whichever fold happens to take it, so a
  // NEW hole in test1 would read exactly like the old known hole and print
  // PASS. The named-miss rule has to be the code, or it is only a comment.
  const exceptSelect = (o: FoldOutcome) => o.fold.name !== "select";
  const aNamed = shallowOut.filter(exceptSelect).every(beats);
  const bNamed = shallowOut.filter(exceptSelect).every(beatsAndPositive);

  const condA = aShallow >= 4 && aDeep >= 2 && aNamed;
  const condB = bShallow >= 4 && bDeep >= 2 && bNamed;
  const condC = cShallow >= 3;

  const missed = (f: (o: FoldOutcome) => boolean) =>
    shallowOut.filter((o) => !f(o)).map((o) => o.fold.name).join(",") || "none";
  console.log(`  (a) beats control median      post-2016 ${aShallow}/5, deep ${aDeep}/3   -> ${condA ? "MET" : "NOT MET"}   (missed: ${missed(beats)}; only select is permitted)`);
  console.log(`  (b) ... and positive there    post-2016 ${bShallow}/5, deep ${bDeep}/3   -> ${condB ? "MET" : "NOT MET"}   (missed: ${missed(beatsAndPositive)}; only select is permitted)`);
  console.log(`  (c) ordering p5 > 0           post-2016 ${cShallow}/5                    -> ${condC ? "MET" : "NOT MET"}`);
  console.log(`\n  -> ${condA && condB && condC ? "PASS" : "FAIL"}`);
  if (!(condA && condB && condC)) {
    console.log(
      `\n  The pre-registered consequence of a FAIL is not a search for a better\n` +
        `  selection rule. It means the edge is real but unreachable at this account\n` +
        `  size: more capital, a cheaper instrument, or drop it.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
