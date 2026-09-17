// The XAUUSD gate (`xau-v1`) — four pre-registered hypotheses, five folds, three
// cost levels.
//
// WHY THIS EXISTS
//
// Two facts point at gold from opposite directions. `mr-down3` is the only rule
// in this repo that has ever passed a pre-registered hold-out — three deep folds
// on 1998-2016 data no fold had touched, median 3/3 and p95 3/3 — and it has zero
// fitted parameters, which makes it the one thing here that can be moved to a new
// asset class and a new timeframe without being re-fitted first. Separately, MT5
// is the only unattended execution path this project has: Webull's trading API
// cannot be reached, every trade ever opened was `mock`, and the desk has opened
// nothing since 2026-08-25.
//
// What gold costs is the thing that made the equity results worth having. There
// is one series. No cross-section, no ticker-disjoint replication, and the broker
// is simultaneously the counterparty, the data source and the only tape. So this
// gate is deliberately a SEPARATE and WEAKER one — see XAU_EVIDENCE_CAVEAT, which
// is printed at the top and the bottom of every run of this script.
//
// THE PRE-REGISTRATION IS NOT IN THIS FILE
//
// It is docs/quant/2026-09-08-xauusd-preregistration.md, and the parts of it that
// a run could quietly violate live in code that this script only calls:
//
//   §3 folds .................. xauFoldViolations() / xauFolds()
//   §4 costs, session filter .. xauCostSpec() / xauSessionFilter()
//   §5 the PASS bar ........... xauVerdict()
//   §6 hypotheses ............. XAU_HYPOTHESES  (four, and mr-down3 is the SAME
//                               OBJECT the equity screen ran, not a translation)
//   §7 fill ................... shift1() + entryAt: "open"
//
// That split is the point: this script cannot hold a different bar than the
// document, because it does not hold the bar at all. It reads the verdict off
// xauVerdict and prints it.
//
// WHY IT REFUSES TO RUN TODAY
//
// Every one of those inputs is [PENDING] on facts only the broker's own server
// can supply, and none of them has a safe default. A guessed point size scales
// every cost by a power of ten without making any number LOOK wrong; a bps cost
// model guessed from a 2026 spread under-charges the older folds by ~3.5x,
// because the spread is a fixed number of POINTS while the 1.5xATR stop is a
// roughly stable FRACTION of price. So `blockers()` collects all of them and the
// script exits non-zero. It does not run partially.
//
//   npx tsx scripts/xau-screen.mts | tee scripts/xau-screen.log
//   npx tsx scripts/xau-screen.mts --control=20     (smoke run, NOT a result)
//
import "dotenv/config";
import { existsSync } from "node:fs";
import { loadPanel, type Fold } from "@/lib/research/panel";
import {
  sliceFold, withSignals, simulateFold, runControl,
  CONTROL_RUNS, BOOTSTRAP_RUNS, PANEL_SEED,
  type FoldSliceRow, type PanelExit,
} from "@/lib/research/panelRun";
import { monthlyBlockBootstrap, mulberry32 } from "@/lib/research/control";
import { computeEntrySignals, WARMUP, type CostModel, type EntrySignals, type SimTrade } from "@/lib/backtest/engine";
import { LADDERS, XAU_HYPOTHESES, ALL_MECHANISMS, type Mechanism } from "@/lib/research/mechanisms";
import {
  XAU_PANEL_CACHE_PATH, XAU_WARMUP_BARS, XAU_GATE_COST_LEVEL, XAU_EVIDENCE_CAVEAT,
  xauFoldList, xauCostSpec, xauSessionFilter, xauCellKey, xauVerdict,
  type XauCostLevel, type XauCostSpec, type XauFold, type XauFoldRow,
} from "@/lib/research/xauFolds";
import {
  rolloverNights, swapCost, swapInR, crossesWeekend, type SwapTerms,
} from "@/lib/trading/swap";

/**
 * The exit geometry, fixed here and NOT swept.
 *
 * `LADDERS.flat` is the same object the equity mechanism screen and the deep
 * hold-out ran, so a gold row reads line-for-line against
 * scripts/deep-holdout.log. That comparability is the whole value of hypothesis
 * 1: if the ladder were re-chosen on gold, a passing mr-down3 would be a claim
 * about two changes (the market AND the exit) and could not be read as a
 * transfer test of anything.
 *
 * Sweeping is also the expensive move. Six ladders x four hypotheses is
 * twenty-four draws on ONE symbol, and probe-selection-strength.log measured the
 * best-of-20 lift at a free +0.028 FIT avgR on a panel with fifty times this
 * sample. See §7b of the pre-registration.
 */
const EXIT_GEOMETRY: PanelExit = LADDERS.flat;

/** Reported in full; only XAU_GATE_COST_LEVEL is read as the verdict. */
const COST_LEVELS: XauCostLevel[] = ["median", "p90", "stress"];

/**
 * **[PENDING]** — `symbol_info(XAUUSD).swap_long` / `swap_short` / `swap_mode`
 * off the broker's own server, plus the contract size the point value is derived
 * from.
 *
 * Null rather than zero. Overnight financing on a leveraged metal is not a
 * rounding error at H1 holding periods, and "swap was quietly treated as free"
 * is exactly the shape of a strategy that clears a gate it should not have.
 * `swapInR` already refuses to price a mode it has no rate for; this refuses to
 * price anything at all until the terms are real.
 */
const XAU_SWAP: { terms: SwapTerms; contractSize: number } | null = null;

/**
 * **[PENDING]** — needs an engine change, and is deliberately NOT faked.
 *
 * §7 pre-registers *flat before the weekend*, and `ExitOptions` has no
 * time-based exit. All three available substitutes change WHICH TRADES EXIST
 * rather than how long they are held: suppressing late-week entries removes a
 * population, slicing week by week drops every position still open at the slice
 * end (`simulateExits` returns closed trades only), and deleting weekend-carry
 * trades afterwards is selection on the outcome.
 *
 * The change it needs is additive and small: an optional
 * `ExitOptions.flatBy?: (i: number, candle: Candle) => boolean`, defaulting to
 * undefined so no existing number moves. Until it exists, `crossesWeekend`
 * supplies the audit statistic — the share of trades that DID carry — so the
 * size of what is unmodelled is at least printed.
 */
const WEEKEND_FLAT_SUPPORTED = false;

interface Row {
  fold: XauFold;
  costLevel: XauCostLevel;
  trades: number;
  /** distinct calendar months containing a trade — the sample the bootstrap resamples */
  blocks: number;
  avgR: number | null;
  winRate: number;
  controlMed: number | null;
  controlP95: number | null;
  bootstrapP5: number | null;
  longTrades: number;
  longAvgR: number | null;
  shortTrades: number;
  shortAvgR: number | null;
  /** share of trades held across a Fri 21:00 UTC close — what §7 says must not happen */
  weekendCarry: number;
  /** mean financing charge per trade in R, or null while the swap terms are [PENDING] */
  swapR: number | null;
}

const fmt = (v: number | null, d = 3) => (v == null || !Number.isFinite(v) ? "     —" : v.toFixed(d).padStart(6));

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function meanR(trades: SimTrade[]): number | null {
  const rs = trades.map((t) => t.rMultiple).filter((r): r is number => r != null && Number.isFinite(r));
  return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
}

/** Distinct calendar months a trade was OPENED in — the same key monthlyBlockBootstrap blocks on. */
function distinctMonths(trades: SimTrade[]): number {
  const keys = new Set<string>();
  for (const t of trades) {
    if (t.rMultiple == null || !Number.isFinite(t.rMultiple)) continue;
    const d = t.openedAt;
    keys.add(`${d.getUTCFullYear()}-${d.getUTCMonth()}`);
  }
  return keys.size;
}

/**
 * §7's fill, without touching the engine: a signal decided on bar i becomes a
 * signal ON bar i+1, which `entryAt: "open"` then fills at that bar's open.
 *
 * `atrs` is deliberately NOT shifted. The engine sizes a stop off `atrs[i-1]`
 * when filling at the open, and after the shift `i-1` IS the deciding bar — so
 * leaving the array alone is what makes the stop the one the decision implied.
 * Shifting both would size off the bar before the decision.
 */
function shift1(s: EntrySignals): EntrySignals {
  const sides: EntrySignals["sides"] = new Array(s.sides.length).fill(null);
  for (let i = 0; i + 1 < s.sides.length; i++) sides[i + 1] = s.sides[i];
  return { sides, atrs: s.atrs };
}

/**
 * Drop entries whose FILL bar falls in an excluded (dow, hour) cell.
 *
 * Applied AFTER the shift, because the spread is paid where the fill happens,
 * not where the decision does. Exits are deliberately not filtered: you cannot
 * decline to be stopped out because the spread is wide, and that asymmetry is
 * part of what the p90 and stress levels stand in for.
 */
function applySessionFilter(s: EntrySignals, candles: { t: number }[], excluded: ReadonlySet<string>): EntrySignals {
  const sides = s.sides.map((side, i) => (side && excluded.has(xauCellKey(candles[i].t)) ? null : side));
  return { sides, atrs: s.atrs };
}

/**
 * The measured POINT spread restated as the bps the engine charges, at THIS
 * fold's own price level.
 *
 * The era correction, and the reason `XAU_COSTS` is stored in points rather than
 * bps. A fixed point spread is a shrinking fraction of a rising price: gold's
 * 1.5xATR stop stayed a stable 0.28-0.68% of price while price itself tripled,
 * so one bps figure taken from 2026 under-charges an early fold by roughly 3.5x
 * — the same order as every effect being hunted.
 *
 * The spread is HALVED because `slippageBps` is charged on every fill and a
 * single-target ladder has two (entry and exit), so the round turn is charged
 * exactly once. That arithmetic is why EXIT_GEOMETRY must stay single-target: a
 * three-fill partial ladder would be under-charged by this conversion.
 */
function foldCostModel(level: XauCostLevel, spec: XauCostSpec, medianPrice: number): CostModel {
  const spreadPrice = spec.spreadPoints[level] * spec.pointSize;
  const commissionPrice = spec.commissionPoints * spec.pointSize;
  return {
    slippageBps: ((spreadPrice / 2) / medianPrice) * 10_000,
    commissionBps: (commissionPrice / medianPrice) * 10_000,
  };
}

/** Mean financing per trade in R, or null when any part of it is unpriced. */
function meanSwapR(trades: SimTrade[]): number | null {
  if (!XAU_SWAP) return null;
  const rs: number[] = [];
  for (const t of trades) {
    const nights = rolloverNights(t.openedAt.getTime(), t.closedAt.getTime());
    const charge = swapCost(t.side, t.lot, nights, XAU_SWAP.terms);
    const riskUsd = Math.abs(t.entry - t.sl) * t.lot * XAU_SWAP.contractSize;
    const r = swapInR(charge, riskUsd);
    if (r != null) rs.push(r);
  }
  return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
}

/** One mechanism, one fold, one cost level — with its matched control and its bootstrap. */
function runCell(
  mech: Mechanism,
  slice: FoldSliceRow[],
  fold: XauFold,
  level: XauCostLevel,
  spec: XauCostSpec,
  excluded: ReadonlySet<string>,
  controlRuns: number,
): Row {
  const closes = slice.flatMap((s) => s.candles.map((c) => c.c));
  const medianPrice = median(closes) ?? 1;

  const prepared = withSignals(slice, (_sym, candles) => {
    const raw = computeEntrySignals(candles, undefined, mech.rule ? mech.rule(candles) : undefined);
    return applySessionFilter(shift1(raw), candles, excluded);
  });

  // The control gets the SAME exit object — same fill, same geometry, same
  // costs. A control filling at the close while the rule fills at the open is
  // not a control, it is a second strategy.
  const exit: PanelExit = { ...EXIT_GEOMETRY, entryAt: "open", costs: foldCostModel(level, spec, medianPrice) };
  const run = simulateFold(prepared, fold, exit);
  const ctrl = controlRuns > 0 ? runControl(prepared, fold, exit, controlRuns, PANEL_SEED) : null;
  const boot = monthlyBlockBootstrap(run.trades, BOOTSTRAP_RUNS, mulberry32(PANEL_SEED));

  const longs = run.trades.filter((t) => t.side === "long");
  const shorts = run.trades.filter((t) => t.side === "short");
  const carried = run.trades.filter((t) => crossesWeekend(t.openedAt.getTime(), t.closedAt.getTime()));

  return {
    fold,
    costLevel: level,
    trades: run.trades.length,
    blocks: distinctMonths(run.trades),
    avgR: run.summary.avgR,
    winRate: run.summary.winRate,
    controlMed: ctrl?.median ?? null,
    controlP95: ctrl?.p95 ?? null,
    bootstrapP5: boot?.p5 ?? null,
    longTrades: longs.length,
    longAvgR: meanR(longs),
    shortTrades: shorts.length,
    shortAvgR: meanR(shorts),
    weekendCarry: run.trades.length ? carried.length / run.trades.length : 0,
    swapR: meanSwapR(run.trades),
  };
}

/** The subset of a Row the pre-registered bar is allowed to see. */
function toVerdictRow(r: Row): XauFoldRow {
  return {
    fold: r.fold.name,
    costLevel: r.costLevel,
    trades: r.trades,
    blocks: r.blocks,
    avgR: r.avgR,
    controlMedian: r.controlMed,
    controlP95: r.controlP95,
    bootstrapP5: r.bootstrapP5,
    longTrades: r.longTrades,
    longAvgR: r.longAvgR,
    shortTrades: r.shortTrades,
    shortAvgR: r.shortAvgR,
  };
}

function printRows(label: string, blurb: string, rows: Row[]) {
  console.log(`\n${label}`);
  if (blurb) console.log(`  ${blurb}`);
  console.log(
    "    fold      cost     trades  months    avgR     win%   ctrl med  ctrl p95   boot p5   " +
      "long n/avgR      short n/avgR     wknd%   swapR",
  );
  for (const r of rows) {
    const beat =
      r.avgR != null && r.controlMed != null ? (r.avgR > r.controlMed ? "  beats-median" : "  LOSES-to-median") : "";
    console.log(
      `    ${r.fold.name.padEnd(8)} ${r.costLevel.padEnd(7)} ${String(r.trades).padStart(7)} ` +
        `${String(r.blocks).padStart(7)}  ${fmt(r.avgR)}  ${r.winRate.toFixed(1).padStart(5)}%  ` +
        `${fmt(r.controlMed)}   ${fmt(r.controlP95)}   ${fmt(r.bootstrapP5)}   ` +
        `${String(r.longTrades).padStart(6)}/${fmt(r.longAvgR)}  ${String(r.shortTrades).padStart(6)}/${fmt(r.shortAvgR)}  ` +
        `${(r.weekendCarry * 100).toFixed(1).padStart(5)}%  ${fmt(r.swapR)}${beat}`,
    );
  }
}

/**
 * Every reason this run cannot produce a number, collected rather than thrown on
 * the first.
 *
 * All of them at once, because they are unblocked by the same trip through the
 * broker's own server and discovering them one run at a time would waste it.
 */
function blockers(): string[] {
  const out: string[] = [];
  const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

  try { xauFoldList(); } catch (e) { out.push(why(e)); }
  try { xauCostSpec(); } catch (e) { out.push(why(e)); }
  try { xauSessionFilter(); } catch (e) { out.push(why(e)); }

  if (!existsSync(XAU_PANEL_CACHE_PATH)) {
    out.push(
      `${XAU_PANEL_CACHE_PATH} does not exist: it is written by scripts/cache-xau-history.mts, ` +
        "which aborts the whole run on an integrity failure rather than writing a file that is 99% right.",
    );
  }
  if (!XAU_SWAP) {
    out.push(
      "XAU_SWAP is [PENDING]: swap_long / swap_short / swap_mode and the contract size must come from " +
        "symbol_info on the broker's own server. Financing is not a footnote at H1 holding periods, and " +
        "treating it as zero is how a strategy clears a gate it should not have.",
    );
  }
  if (!WEEKEND_FLAT_SUPPORTED) {
    out.push(
      "the pre-registered flat-before-the-weekend rule (§7) is not implementable: ExitOptions has no " +
        "time-based exit, and every available substitute changes WHICH TRADES EXIST rather than how long " +
        "they are held. It needs an additive ExitOptions.flatBy?: (i, candle) => boolean, default undefined " +
        "so no existing number moves. The wknd% column is the audit statistic in the meantime.",
    );
  }
  return out;
}

async function main() {
  const controlRuns = Number(process.argv.find((a) => a.startsWith("--control="))?.split("=")[1] ?? CONTROL_RUNS);

  console.log(XAU_EVIDENCE_CAVEAT);
  console.log("");

  const blocked = blockers();
  if (blocked.length) {
    console.log(`${"=".repeat(78)}\nREFUSING TO RUN — ${blocked.length} pre-registered input(s) still [PENDING]\n${"=".repeat(78)}`);
    blocked.forEach((b, i) => console.log(`\n${i + 1}. ${b}`));
    console.log(
      "\nNone of these has a safe default. A default here would not read as an error downstream; " +
        "it would read as a result.",
    );
    process.exit(1);
  }

  const folds = xauFoldList();
  const spec = xauCostSpec();
  const excluded = xauSessionFilter();

  const panel = loadPanel(XAU_PANEL_CACHE_PATH);
  console.log(`panel ${panel.cachePath} — ${panel.symbols.length} symbol(s), fetchedAt ${panel.fetchedAt}`);
  for (const [sym, n] of Object.entries(panel.droppedBars)) {
    console.log(`  dropped ${n} placeholder bar(s) from ${sym}`);
  }
  console.log(
    `exit=flat ${JSON.stringify({ tp1Mult: EXIT_GEOMETRY.tp1Mult, slMult: EXIT_GEOMETRY.slMult })} (fixed, not swept)  ` +
      `fill=next-bar-open  control=${controlRuns}  bootstrap=${BOOTSTRAP_RUNS}  seed=${PANEL_SEED}  ` +
      `warmup=${XAU_WARMUP_BARS}  WARMUP=${WARMUP}`,
  );
  console.log(
    `costs: point=${spec.pointSize}  commission=${spec.commissionPoints}pt  ` +
      `spread ${COST_LEVELS.map((l) => `${l}=${spec.spreadPoints[l]}pt`).join(" ")}  ` +
      `verdict read at ${XAU_GATE_COST_LEVEL}`,
  );
  console.log(`session filter excludes ${excluded.size} of 168 (dow x hour) cells`);

  // Cut once per fold and share: slicing is per-fold, signals are per-mechanism.
  const slices = new Map<string, FoldSliceRow[]>();
  for (const fold of folds) {
    const s = sliceFold(panel, fold, panel.symbols, XAU_WARMUP_BARS);
    slices.set(fold.name, s);
    const closes = s.flatMap((r) => r.candles.map((c) => c.c));
    const bars = s.reduce((a, r) => a + r.candles.length, 0);
    const px = median(closes);
    console.log(
      `  ${fold.name.padEnd(8)} ${fold.from}..${fold.to}  ${String(bars).padStart(7)} bars  ` +
        `median close ${px == null ? "—" : px.toFixed(2)}  direction ${fold.direction}  — ${fold.regime}`,
    );
  }

  // -------------------------------------------------------------------------
  // 1. The four hypotheses, every fold, every cost level.
  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(78)}\n1. HYPOTHESES — four, fixed in §6\n${"=".repeat(78)}`);

  const gateRows = new Map<string, Row[]>();
  for (const mech of XAU_HYPOTHESES) {
    const rows: Row[] = [];
    for (const level of COST_LEVELS) {
      for (const fold of folds) {
        rows.push(runCell(mech, slices.get(fold.name)!, fold, level, spec, excluded, controlRuns));
      }
    }
    printRows(mech.key, mech.blurb, rows);
    gateRows.set(mech.key, rows.filter((r) => r.costLevel === XAU_GATE_COST_LEVEL));
  }

  // -------------------------------------------------------------------------
  // 2. Audit trail — NOT A MENU.
  //
  // The baseline reference row and every other mechanism, at the gate cost level
  // only, so the four hypotheses can be read against their own context from one
  // log. None of them is under test, and none may be promoted out of this run:
  // picking the best of a dozen rows after seeing them is exactly what the
  // pre-registration exists to prevent. An interesting row here is a NEW
  // pre-registration against data that does not exist yet.
  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(78)}\n2. AUDIT TRAIL at ${XAU_GATE_COST_LEVEL} costs — context, not candidates\n${"=".repeat(78)}`);

  const underTest = new Set(XAU_HYPOTHESES.map((m) => m.key));
  for (const mech of ALL_MECHANISMS) {
    if (underTest.has(mech.key)) continue;
    if (mech.entryAt) {
      // gap-fade already fills at the open by its own construction; shifting it
      // as well would charge the next bar's open for a decision the rule makes
      // FROM that open, i.e. double-count §7's lag.
      console.log(`\n${mech.key}   (skipped — declares entryAt="${mech.entryAt}", so §7's shift would double-count)`);
      continue;
    }
    const rows = folds.map((fold) =>
      runCell(mech, slices.get(fold.name)!, fold, XAU_GATE_COST_LEVEL, spec, excluded, controlRuns),
    );
    printRows(`${mech.key}   (audit row, not under test)`, mech.blurb, rows);
  }

  // -------------------------------------------------------------------------
  // 3. The verdict, read mechanically off xauVerdict.
  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(78)}\n3. VERDICT — §5, at ${XAU_GATE_COST_LEVEL} costs\n${"=".repeat(78)}`);

  for (const mech of XAU_HYPOTHESES) {
    const v = xauVerdict((gateRows.get(mech.key) ?? []).map(toVerdictRow));
    console.log(`\n${mech.key}: ${v.passed ? "PASS" : "REJECT"}`);
    for (const n of v.notes) console.log(`    held: ${n}`);
    for (const f of v.failures) console.log(`    FAILED: ${f}`);
  }

  console.log(
    "\nFailing this bar closes XAUUSD as an instrument (§0). Not another timeframe, not another " +
      "parameter, not another ladder — the rule already had five folds to be interesting on, and a " +
      "confirmation that can only pass is not one.",
  );
  console.log(`\n${XAU_EVIDENCE_CAVEAT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
