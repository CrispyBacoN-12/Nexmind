// Does mr-down3 survive a LIMIT order placed before the owner goes to sleep?
//
// WHY THIS EXISTS
//
// scripts/mr-down3-open-fill.log rejected the next-bar-open fill and showed why:
// the whole edge is the overnight gap after the third down close, so any entry
// on bar i+1 is on the wrong side of it. That left exactly one implementable
// entry — a market-on-close order at 16:00 ET, i.e. 03:00 Thai time, submitted
// before the ~15:50 ET MOC cutoff (02:50 Thai). The owner has said that is
// probably not livable every trading night.
//
// This measures the one structure that could remove the wake-up without giving
// up the gap. It rests on a property of the rule itself:
//
//   mechanisms.ts: c[i].c < c[i-1].c && c[i-1].c < c[i-2].c && c[i-2].c < c[i-3].c
//
// Write j = i-1. At the CLOSE of bar j, two of the three conditions are already
// settled — c[j] < c[j-1] and c[j-1] < c[j-2]. Only c[i] < c[j] is unknown, and
// that condition is a PRICE: it says the next session trades below c[j]. So the
// owner can place a buy limit at c[j] before sleeping and let the exchange test
// the third condition overnight. Nobody has to be awake.
//
// WHY THIS IS NOT THE FILL THAT WAS ALREADY REJECTED
//
// The rejected fill was a market order executing at the OPEN of bar i — after
// the gap. This one fills DURING bar i at a price fixed the previous evening,
// which is before the gap the edge lives in. Same calendar day, opposite side of
// the move that matters. It is a different measurement and it gets a fresh test.
//
// WHY USING candles[j+1].l IS NOT LOOKAHEAD
//
// The decision — which symbol, which price, what size — uses only bars up to j.
// candles[j+1].l is read to answer "did the resting order get hit", which is the
// exchange's job, not the strategy's. Sizing uses atrs[j], known at the close of
// bar j. No quantity chosen at bar j depends on anything after bar j. Anyone
// re-reading this should check that claim against the three rules below before
// believing any number in the log.
//
// WHAT THE THREE ARMS ARE, AND WHICH ONE IS REAL
//
//   close   BASELINE. The original rule, filled at c[i]. This is what
//           deep-holdout.log and mr-down3-open-fill.log both measured. Present
//           for continuity and as the denominator of the retention test.
//
//   priced  DIAGNOSTIC ONLY, NOT IMPLEMENTABLE, and must never be quoted as a
//           result. Exactly the baseline's trades, filled one bar earlier at
//           c[j] instead of c[i]. Deciding to take these trades requires knowing
//           c[i], which nobody knows at bar j. It exists for one job: the real
//           arm changes TWO things at once — a worse entry price AND a larger
//           trade population — and this arm isolates the first. Same reason
//           mechanisms.ts carries "open-unmanaged".
//
//   limit   THE REAL THING. Signal at bar j when c[j] < c[j-1] < c[j-2] and the
//           next session trades at or below c[j]; fill at c[j]. This is a
//           good-for-day buy limit placed in the Thai evening.
//
//   limit is a strict SUPERSET of priced: whenever the original rule fires at
//   i, c[i].c < c[j].c, so c[i].l <= c[i].c < c[j].c and the limit necessarily
//   filled. Checked in code below; a violation voids the run.
//
// KNOWN OPTIMISM, STATED BEFORE THE RUN, NOT AFTER
//
// The engine can only fill at a bar's open or its close, so the limit arm is
// simulated as a close fill on bar j. That makes the engine treat the position
// as held from the close of bar j, while in reality it is acquired somewhere
// inside bar i. Two consequences, in opposite directions:
//
//   PESSIMISTIC, and left uncorrected: when bar i opens below c[j] the real
//   limit fills at the open, a better price than c[j]. The engine charges c[j].
//
//   OPTIMISTIC, and NOT corrected: when bar i gaps up and only later trades down
//   through c[j], the engine manages the whole of bar i, so it can book a target
//   touched before the real fill happened. stepPosition's adverse-before-
//   favorable rule damps this — a bar touching both levels books the loss — but
//   it does not remove it.
//
// The second one flatters the limit arm. So a PASS here is provisional and owes
// an intrabar check before anything is built on it; a FAIL is clean, because
// failing while being flattered is a stronger result than failing fairly.
//
// PRE-REGISTRATION. Written before the first run and not edited afterwards.
//
//   VERDICT FOLDS: the three DEEP folds only (deep1/deep2/deep3, 1998-2016). The
//   five modern folds are printed for continuity and are NOT part of the verdict.
//
//   PASS requires BOTH:
//     (1) ABSOLUTE. the limit arm beats the control MEDIAN in >= 2 of 3 deep
//         folds AND beats the control P95 in >= 1 of 3. Word for word the rule
//         deep-holdout.mts pre-registered and mr-down3-open-fill.mts reused, so
//         it is not a new bar invented to fit a new number.
//     (2) RETENTION. Mean margin over the control median across the three deep
//         folds, at the limit fill, is >= 50% of the same quantity at the close
//         fill. Same floor, same comparison, as the rejected open-fill test.
//
//   SECOND PRE-REGISTERED STATEMENT (retail costs). If at 5bps the mean deep-fold
//   margin over the control median is <= 0 at the limit fill, then the
//   recommendations are NOT TRADEABLE at retail slippage, whatever (1) and (2) say.
//
//   PRE-REGISTERED CONSEQUENCE OF A FAIL. The only entry timing left standing is
//   the 03:00 Thai market-on-close, which the owner has already called probably
//   unlivable. A FAIL therefore does not license a search for a third fill: it
//   says mr-down3 is not deployable under this project's constraints, and the
//   design must change MECHANISM rather than fill.
//
//   npx tsx scripts/mr-down3-limit-fill.mts --control=200 | tee scripts/mr-down3-limit-fill.log
//
import "dotenv/config";
import {
  loadPanel,
  DEEP_FOLD_LIST,
  DEEP_PANEL_CACHE_PATH,
  FOLDS,
  type Fold,
  type Panel,
} from "@/lib/research/panel";
import {
  sliceFold,
  withSignals,
  simulateFold,
  runControl,
  CONTROL_RUNS,
  PANEL_SEED,
  type PanelExit,
  type PreparedSymbol,
} from "@/lib/research/panelRun";
import { LADDERS, mechanismByKey } from "@/lib/research/mechanisms";
import {
  computeEntrySignals,
  WARMUP,
  type EntrySignals,
  type CostModel,
} from "@/lib/backtest/engine";

const MECH = mechanismByKey("mr-down3");
const EXIT = LADDERS.flat; // the ladder deep-holdout and mechanism-screen both ran
const RETENTION_FLOOR = 0.5; // pre-registered in (2) above

/** deep-holdout.log's close-fill avgR at 0.5bps. A mismatch means the harness moved. */
const EXPECTED_CLOSE_AVGR: Record<string, number> = { deep1: 0.07, deep2: 0.074, deep3: 0.132 };

const COSTS: { label: string; verdict: boolean; costs: CostModel }[] = [
  {
    label: "0.5bps + 1bp  (DEFAULT_COST_MODEL — the verdict cost model)",
    verdict: true,
    costs: { slippageBps: 0.5, commissionBps: 1 },
  },
  {
    label: "5bps + 1bp    (retail slippage — second pre-registered statement)",
    verdict: false,
    costs: { slippageBps: 5, commissionBps: 1 },
  },
];

type ArmKey = "close" | "priced" | "limit";
const ARMS: ArmKey[] = ["close", "priced", "limit"];

/**
 * Pull every signal one bar EARLIER, so the engine's close fill lands on c[j]
 * instead of c[i]. Same trades, one bar sooner, at the previous close's price.
 * Diagnostic only — see the header.
 */
const shiftBack = (s: EntrySignals): EntrySignals => {
  const sides: EntrySignals["sides"] = new Array(s.sides.length).fill(null);
  for (let i = 1; i < s.sides.length; i++) sides[i - 1] = s.sides[i];
  return { sides, atrs: s.atrs };
};

/**
 * The implementable arm: two down closes as of bar j, and the next session
 * traded at or below c[j] so the resting limit was hit. Fill price is c[j],
 * which the engine reproduces as a close fill on bar j.
 */
function limitSignals(candles: { c: number; l: number }[], base: EntrySignals): EntrySignals {
  const sides: EntrySignals["sides"] = new Array(base.sides.length).fill(null);
  for (let j = 2; j + 1 < candles.length; j++) {
    if (!(candles[j].c < candles[j - 1].c && candles[j - 1].c < candles[j - 2].c)) continue;
    if (candles[j + 1].l <= candles[j].c) sides[j] = "long";
  }
  return { sides, atrs: base.atrs };
}

interface Row {
  fold: string;
  trades: number;
  avgR: number | null;
  winRate: number;
  controlMed: number | null;
  controlP95: number | null;
}

const marginMed = (r: Row) => (r.avgR != null && r.controlMed != null ? r.avgR - r.controlMed : null);
const marginP95 = (r: Row) => (r.avgR != null && r.controlP95 != null ? r.avgR - r.controlP95 : null);
const fmt = (v: number | null, d = 3) =>
  v == null || !Number.isFinite(v) ? "     —" : v.toFixed(d).padStart(6);
const mean = (xs: (number | null)[]) => {
  const ok = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
};

function runCell(prepared: PreparedSymbol[], fold: Fold, exit: PanelExit, controlRuns: number): Row {
  const run = simulateFold(prepared, fold, exit);
  const ctrl = controlRuns > 0 ? runControl(prepared, fold, exit, controlRuns, PANEL_SEED) : null;
  return {
    fold: fold.name,
    trades: run.trades.length,
    avgR: run.summary.avgR,
    winRate: run.summary.winRate,
    controlMed: ctrl?.median ?? null,
    controlP95: ctrl?.p95 ?? null,
  };
}

function printRows(label: string, rows: Row[]) {
  console.log(`\n  ${label}`);
  console.log("    fold      trades     avgR     win%   ctrl med  ctrl p95   marg-med  marg-p95");
  for (const r of rows) {
    console.log(
      `    ${r.fold.padEnd(8)} ${String(r.trades).padStart(7)}  ${fmt(r.avgR)}  ` +
        `${r.winRate.toFixed(1).padStart(5)}%  ${fmt(r.controlMed)}   ${fmt(r.controlP95)}   ` +
        `${fmt(marginMed(r))}    ${fmt(marginP95(r))}`,
    );
  }
}

/** Build all three arms for one fold. */
function prepare(panel: Panel, fold: Fold): Record<ArmKey, PreparedSymbol[]> {
  const slice = sliceFold(panel, fold);
  const close = withSignals(slice, (_sym, candles) =>
    computeEntrySignals(candles, undefined, MECH.rule!(candles)),
  );
  return {
    close,
    priced: close.map((p) => ({ ...p, signals: shiftBack(p.signals) })),
    limit: close.map((p) => ({ ...p, signals: limitSignals(p.candles, p.signals) })),
  };
}

/** The superset invariant, and the size of the population the limit arm adds. */
function checkSuperset(panel: Panel, folds: readonly Fold[]) {
  let violations = 0;
  let pricedN = 0;
  let limitN = 0;
  for (const fold of folds) {
    const prep = prepare(panel, fold);
    for (let s = 0; s < prep.priced.length; s++) {
      const a = prep.priced[s].signals.sides;
      const b = prep.limit[s].signals.sides;
      for (let i = 0; i < a.length; i++) {
        if (a[i]) {
          pricedN++;
          if (!b[i]) violations++;
        }
        if (b[i]) limitN++;
      }
    }
  }
  return { violations, pricedN, limitN };
}

async function main() {
  const controlRuns = Number(
    process.argv.find((a) => a.startsWith("--control="))?.split("=")[1] ?? CONTROL_RUNS,
  );

  console.log("mr-down3 @ limit-at-previous-close — pre-registered, see header");
  console.log(`ladder=flat  control=${controlRuns}  seed=${PANEL_SEED}  WARMUP=${WARMUP}`);
  console.log(`rule: ${MECH.blurb}`);
  console.log("arms: close = baseline · priced = DIAGNOSTIC, not implementable · limit = the real thing");

  const deepPanel = loadPanel(DEEP_PANEL_CACHE_PATH);
  const modernPanel = loadPanel();

  // ---- voiding check ------------------------------------------------------
  console.log(`\n${"=".repeat(78)}\n0. VOIDING CHECK — is the limit arm well formed?\n${"=".repeat(78)}`);
  let voided = false;
  for (const [name, p, folds] of [
    ["deep (Yahoo 1998+)", deepPanel, DEEP_FOLD_LIST],
    ["modern (Alpaca 2016+)", modernPanel, Object.values(FOLDS)],
  ] as const) {
    const { violations, pricedN, limitN } = checkSuperset(p, folds);
    const extra = limitN - pricedN;
    console.log(
      `  ${name.padEnd(24)} priced ${pricedN}  limit ${limitN}  ` +
        `extra ${extra} (${pricedN ? ((100 * extra) / pricedN).toFixed(1) : "—"}% more)  ` +
        `superset violations ${violations}`,
    );
    if (violations > 0) voided = true;
    if (extra <= 0) voided = true;
  }
  if (voided) {
    console.log("\n  *** VOID: the limit arm is not a strict superset of the priced arm, or adds no");
    console.log("      trades at all. The construction is wrong and every number below is");
    console.log("      meaningless. Stop here. ***");
  } else {
    console.log("  limit is a strict superset of priced and adds a real population — construction OK.");
  }

  // ---- the tables ---------------------------------------------------------
  const deepByCost: Record<string, Record<ArmKey, Row[]>> = {};

  for (const c of COSTS) {
    console.log(`\n${"=".repeat(78)}`);
    console.log(`costs = ${c.label}`);
    console.log("=".repeat(78));

    const deep: Record<ArmKey, Row[]> = { close: [], priced: [], limit: [] };
    for (const fold of DEEP_FOLD_LIST) {
      const prep = prepare(deepPanel, fold);
      for (const arm of ARMS) {
        deep[arm].push(runCell(prep[arm], fold, { ...EXIT, costs: c.costs, entryAt: "close" }, controlRuns));
      }
    }
    console.log("\nDEEP FOLDS — the verdict folds (1998-2016, never used for any decision)");
    printRows("close   BASELINE — fill at c[i], what every prior log measured", deep.close);
    printRows("priced  DIAGNOSTIC ONLY — baseline's trades filled at c[j]. NOT implementable", deep.priced);
    printRows("limit   THE REAL THING — buy limit at c[j] placed the evening before", deep.limit);
    deepByCost[c.label] = deep;

    const modern: Record<ArmKey, Row[]> = { close: [], priced: [], limit: [] };
    for (const fold of Object.values(FOLDS)) {
      const prep = prepare(modernPanel, fold);
      for (const arm of ARMS) {
        modern[arm].push(runCell(prep[arm], fold, { ...EXIT, costs: c.costs, entryAt: "close" }, controlRuns));
      }
    }
    console.log("\nMODERN FOLDS — continuity only, NOT part of the verdict");
    printRows("close   BASELINE", modern.close);
    printRows("priced  DIAGNOSTIC ONLY", modern.priced);
    printRows("limit   THE REAL THING", modern.limit);
  }

  // ---- harness reproduction check ----------------------------------------
  console.log(`\n${"=".repeat(78)}\nHARNESS CHECK — does the close arm still reproduce deep-holdout.log?\n${"=".repeat(78)}`);
  const verdictCost = COSTS.find((c) => c.verdict)!;
  for (const r of deepByCost[verdictCost.label].close) {
    const want = EXPECTED_CLOSE_AVGR[r.fold];
    const got = r.avgR;
    const ok = want != null && got != null && Math.abs(got - want) < 0.002;
    console.log(
      `  ${r.fold.padEnd(8)} expected ${want?.toFixed(3) ?? "—"}   got ${fmt(got)}   ${ok ? "match" : "*** MISMATCH ***"}`,
    );
  }

  // ---- attribution --------------------------------------------------------
  console.log(`\n${"=".repeat(78)}\nATTRIBUTION — where does the edge go? (deep folds, verdict cost model)\n${"=".repeat(78)}`);
  const d = deepByCost[verdictCost.label];
  const mClose = mean(d.close.map(marginMed));
  const mPriced = mean(d.priced.map(marginMed));
  const mLimit = mean(d.limit.map(marginMed));
  console.log(`  baseline, fill at c[i]                      margin over ctrl median  ${fmt(mClose, 4)}`);
  console.log(`  same trades, fill at c[j]   (DIAGNOSTIC)    margin over ctrl median  ${fmt(mPriced, 4)}`);
  console.log(`  real limit, fill at c[j]                    margin over ctrl median  ${fmt(mLimit, 4)}`);
  if (mClose != null && mPriced != null && mLimit != null) {
    console.log(`\n  cost of paying yesterday's close  ${(mPriced - mClose).toFixed(4)}R`);
    console.log(`  cost of the extra fills (adverse selection)  ${(mLimit - mPriced).toFixed(4)}R`);
  }

  // ---- verdict ------------------------------------------------------------
  console.log(`\n${"=".repeat(78)}\nVERDICT — scored against the header, which was written first\n${"=".repeat(78)}`);
  console.log(`  cost model: ${verdictCost.label}`);
  const beatsMed = d.limit.filter((r) => (marginMed(r) ?? -1) > 0).length;
  const beatsP95 = d.limit.filter((r) => (marginP95(r) ?? -1) > 0).length;
  const absolute = beatsMed >= 2 && beatsP95 >= 1;
  const retention = mClose != null && mLimit != null && mClose !== 0 ? mLimit / mClose : null;
  const retentionOk = retention != null && retention >= RETENTION_FLOOR;
  console.log(
    `  (1) ABSOLUTE   beats control median: ${beatsMed}/3 (need >=2)   ` +
      `beats p95: ${beatsP95}/3 (need >=1)  -> ${absolute ? "PASS" : "FAIL"}`,
  );
  console.log(
    `  (2) RETENTION  mean margin-over-median  close ${fmt(mClose, 4)}  limit ${fmt(mLimit, 4)}`,
  );
  console.log(
    `                 retention ${retention != null ? (100 * retention).toFixed(1) + "%" : "—"} ` +
      `(need >=${100 * RETENTION_FLOOR}%)  -> ${retentionOk ? "PASS" : "FAIL"}`,
  );

  const pass = absolute && retentionOk && !voided;
  console.log(`\n  LIMIT-AT-PREVIOUS-CLOSE: ${voided ? "VOID" : pass ? "ACCEPTED" : "REJECTED"}`);
  if (pass) {
    console.log("  -> the 03:00 wake-up is avoidable. Provisional: the intrabar optimism named in");
    console.log("     the header flatters this arm and is owed a check before anything is built.");
  } else if (!voided) {
    console.log("  -> the pre-registered consequence applies: the only entry timing left is the");
    console.log("     03:00 Thai MOC. Change the mechanism, not the fill.");
  }

  const retail = COSTS.find((c) => !c.verdict)!;
  const mLimitRetail = mean(deepByCost[retail.label].limit.map(marginMed));
  console.log(`\n  SECOND STATEMENT (retail costs, ${retail.label.trim()}):`);
  console.log(`    mean deep-fold margin over control median at the limit fill: ${fmt(mLimitRetail, 4)}`);
  console.log(
    `    -> ${mLimitRetail != null && mLimitRetail > 0 ? "tradeable at retail slippage" : "NOT TRADEABLE at retail slippage"}`,
  );
}

await main();
