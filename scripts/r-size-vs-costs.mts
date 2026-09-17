// How big is 1R, as a fraction of price — and what does that do to costs on
// intraday bars?
//
// WHY THIS EXISTS
//
// scripts/mr-down3-open-fill.log rejected the next-open fill and showed that
// mr-down3's whole edge is the overnight gap. The next question asked was
// whether to go intraday instead. The argument against it is arithmetic, not
// taste: costs are charged in basis points OF PRICE, while edges are measured in
// R, and R shrinks with the bar size. Shorter bars therefore pay the same toll
// over a shorter road.
//
// That argument was made from an estimate. This measures the one number it rests
// on.
//
// THIS IS A DIAGNOSTIC. No hypothesis is under test, no criterion is
// pre-registered, and nothing may be approved or rejected on these numbers
// alone. It exists to make one estimate falsifiable.
//
// WHAT 1R IS, EXACTLY, IN THIS ENGINE
//
//   engine.ts openPosition:  sl   = fillEntry - dir * slMult * atrVal
//   engine.ts closePosition: risk = |entry - origSl|
//
// so 1R = slMult * ATR, and LADDERS.flat sets slMult = 1.5. Reported here as a
// fraction of the entry price, because that is the unit costs are quoted in.
//
// WHAT COSTS ARE, EXACTLY
//
//   slippageBps  applies to EVERY fill — entry and exit. singleTarget means one
//                exit, so two legs.
//   commissionBps applies ONCE per closed trade, against notional (lot * entry).
//
// so total cost, as a fraction of price = (2 * slippageBps + commissionBps)/1e4,
// and cost measured in R = that, divided by R-as-a-fraction-of-price.
//
// THE INTRADAY PROJECTION IS A PROJECTION, AND IS LABELLED AS ONE
//
// There is not one intraday bar in any cache, so intraday R is not measured
// here — it is scaled from the measured daily R by sqrt-of-time, the standard
// approximation. It is an approximation: realised volatility is higher near the
// open and lower midday than sqrt scaling implies, so the true 5-minute R is
// somewhat above the projection early in the session and below it in the middle.
// The projection is a central estimate, not a bound, and the conclusion should
// only be trusted if it survives a wide margin — which is the point of printing
// the ratio against mr-down3's measured alpha rather than a bare verdict.
//
//   npx tsx scripts/r-size-vs-costs.mts | tee scripts/r-size-vs-costs.log
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
import { sliceFold, withSignals } from "@/lib/research/panelRun";
import { LADDERS, mechanismByKey } from "@/lib/research/mechanisms";
import { computeEntrySignals } from "@/lib/backtest/engine";

const MECH = mechanismByKey("mr-down3");
const SL_MULT = LADDERS.flat.slMult; // 1.5 — the multiplier every measured log ran

/** mr-down3's measured alpha: mean margin over control median, deep folds, close fill. */
const MEASURED_ALPHA_R = 0.0387;

const COSTS = [
  { label: "0.5bps slip + 1bp comm (DEFAULT_COST_MODEL)", slip: 0.5, comm: 1 },
  { label: "5bps slip + 1bp comm (retail)", slip: 5, comm: 1 },
];

/** US regular session is 6.5h; these are how many bars of that length fit in one session. */
const HORIZONS = [
  { label: "daily (measured)", barsPerSession: 1 },
  { label: "60-min", barsPerSession: 6.5 },
  { label: "15-min", barsPerSession: 26 },
  { label: "5-min", barsPerSession: 78 },
];

const costFracOfPrice = (slip: number, comm: number) => (2 * slip + comm) / 10_000;

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * Collect R-as-a-fraction-of-price over a panel.
 *
 * `signalBarsOnly` restricts to bars where mr-down3 actually fires. Reported
 * separately because a rule that buys after three down days may well be picking
 * bars with above-average ATR, and it is the rule's OWN R that its costs are
 * charged against — the all-bars figure would understate the toll if so.
 */
function collectR(panel: Panel, folds: readonly Fold[], signalBarsOnly: boolean): number[] {
  const out: number[] = [];
  for (const fold of folds) {
    const prepared = withSignals(sliceFold(panel, fold), (_sym, candles) =>
      computeEntrySignals(candles, undefined, MECH.rule!(candles)),
    );
    for (const p of prepared) {
      const { sides, atrs } = p.signals;
      for (let i = 0; i < atrs.length; i++) {
        if (signalBarsOnly && !sides[i]) continue;
        const atr = atrs[i];
        const price = p.candles[i]?.c;
        if (!Number.isFinite(atr) || !(price > 0)) continue;
        const r = (SL_MULT * atr) / price;
        if (r > 0 && r < 1) out.push(r); // drop degenerate bars; R >= price is not a stop
      }
    }
  }
  return out.sort((a, b) => a - b);
}

function report(label: string, rs: number[]) {
  if (!rs.length) {
    console.log(`  ${label.padEnd(34)} no bars`);
    return;
  }
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  console.log(
    `  ${label.padEnd(34)} n=${String(rs.length).padStart(8)}   ` +
      `p25 ${(100 * quantile(rs, 0.25)).toFixed(2)}%   ` +
      `median ${(100 * quantile(rs, 0.5)).toFixed(2)}%   ` +
      `p75 ${(100 * quantile(rs, 0.75)).toFixed(2)}%   ` +
      `mean ${(100 * mean).toFixed(2)}%`,
  );
}

async function main() {
  console.log("1R as a fraction of price, and cost-in-R by bar size — DIAGNOSTIC, not a verdict");
  console.log(`1R = slMult * ATR, slMult = ${SL_MULT} (LADDERS.flat)`);
  console.log(`cost as fraction of price = (2*slippageBps + commissionBps) / 1e4`);
  console.log(`  because slippage is charged on entry AND exit; commission once per closed trade`);

  const deepPanel = loadPanel(DEEP_PANEL_CACHE_PATH);
  const modernPanel = loadPanel();
  const modernFolds = Object.values(FOLDS);

  console.log(`\n${"=".repeat(94)}\n1. MEASURED — 1R as a fraction of price, on daily bars\n${"=".repeat(94)}`);
  const deepSignal = collectR(deepPanel, DEEP_FOLD_LIST, true);
  const modernSignal = collectR(modernPanel, modernFolds, true);
  console.log("\n  on bars where mr-down3 actually fires (the population its costs are charged to):");
  report("deep folds (1998-2016)", deepSignal);
  report("modern folds (2016-2026)", modernSignal);

  console.log("\n  on all bars, for contrast:");
  report("deep folds (1998-2016)", collectR(deepPanel, DEEP_FOLD_LIST, false));
  report("modern folds (2016-2026)", collectR(modernPanel, modernFolds, false));

  // The figure the rest of the run scales from: the population the rule trades.
  const allSignal = [...deepSignal, ...modernSignal].sort((a, b) => a - b);
  const dailyR = quantile(allSignal, 0.5);
  console.log(`\n  -> median 1R on signal bars, both eras pooled: ${(100 * dailyR).toFixed(2)}% of price`);

  // --- cross-check against the open-fill run -------------------------------
  //
  // mr-down3-open-fill.log measured avgR at two cost models on the SAME trades.
  // The gap between them is a known price-fraction, so it implies an R. If that
  // implied R disagrees with the measured one above, one of the two is wrong and
  // nothing below should be believed.
  console.log(`\n${"=".repeat(94)}\n2. CROSS-CHECK — does the measured R explain the cost gap already observed?\n${"=".repeat(94)}`);
  const gapFrac = costFracOfPrice(5, 1) - costFracOfPrice(0.5, 1);
  const observedDrops = [0.070 - 0.050, 0.074 - 0.051, 0.132 - 0.105]; // deep1..3, close fill
  const observedDrop = observedDrops.reduce((a, b) => a + b, 0) / observedDrops.length;
  const impliedR = gapFrac / observedDrop;
  console.log(`  price gap between the two cost models: ${(100 * gapFrac).toFixed(4)}% of price`);
  console.log(`  avgR drop observed across deep1..3 (close fill): ${observedDrop.toFixed(4)}R`);
  console.log(`  -> implied 1R = ${(100 * impliedR).toFixed(2)}% of price`);
  console.log(`  -> measured 1R = ${(100 * dailyR).toFixed(2)}% of price`);
  const agree = Math.abs(impliedR - dailyR) / dailyR;
  console.log(
    `  -> they differ by ${(100 * agree).toFixed(0)}% — ${agree < 0.35 ? "consistent; the model of costs above is right" : "INCONSISTENT; do not trust section 3"}`,
  );

  // --- projection ----------------------------------------------------------
  console.log(`\n${"=".repeat(94)}\n3. PROJECTED — cost in R by bar size (sqrt-of-time scaling, an APPROXIMATION)\n${"=".repeat(94)}`);
  console.log(`  mr-down3's measured alpha, for comparison: ${MEASURED_ALPHA_R.toFixed(4)}R`);
  for (const c of COSTS) {
    const frac = costFracOfPrice(c.slip, c.comm);
    console.log(`\n  costs = ${c.label}  (${(100 * frac).toFixed(3)}% of price, round trip)`);
    console.log("    bar size            1R (% of price)   cost in R    vs alpha");
    for (const h of HORIZONS) {
      const r = dailyR / Math.sqrt(h.barsPerSession);
      const costR = frac / r;
      const ratio = costR / MEASURED_ALPHA_R;
      console.log(
        `    ${h.label.padEnd(20)}${(100 * r).toFixed(3).padStart(10)}%   ` +
          `${costR.toFixed(4).padStart(9)}    ${ratio.toFixed(1).padStart(5)}x alpha`,
      );
    }
  }

  console.log(`\n  Reading this: an edge has to clear its own costs before it clears a control.`);
  console.log(`  "Nx alpha" is how many times mr-down3's entire measured edge the toll would be`);
  console.log(`  at that bar size. It is not a prediction that an intraday rule would earn the`);
  console.log(`  same alpha — no intraday rule has been measured here at all.`);
}

await main();
