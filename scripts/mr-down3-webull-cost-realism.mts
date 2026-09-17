// Pre-registered Probe #1: Webull Cost Realism on mr-down3.
//
// WHY THIS EXISTS
//
// docs/STATE.md and nexmind-mr-down3-passed-holdout.md agree: mr-down3 is the
// only rule that has ever passed a hold-out, and "the open question is sizing,
// not entries." nexmind-cost-model-dominates-effect-size.md already showed the
// cost CONSTANT swings avgR by more than any measured edge (~0.027R/trade going
// from 0.5bps to 5bps slippage) — and today's EQUITY_COST_MODEL fix
// (runResearch.ts) picked the worse of those two flat numbers as a stopgap.
// Neither number was ever a real Webull cost model: DEFAULT_COST_MODEL's own
// comment says it was calibrated to an MT5 Raw/ECN GOLD account, and 5bps was a
// borrowed constant from a different codebase (Vibe-Trading's global_equity.py).
//
// This probe replaces both guesses with the actual, disclosed Webull US-equities
// fee schedule (commission $0.00; SEC Section 31 fee; FINRA TAF) plus an
// EXPLICIT sweep over the one thing that is NOT disclosed anywhere — the real
// effective spread a PFOF-routed retail order pays — instead of asserting a
// single number for it. The goal is not to approve or reject mr-down3. It is to
// find its HURDLE RATE: the execution-friction level at which its measured edge
// is fully erodes to zero, so that any future claim about mr-down3's live P&L can
// be checked against a real number instead of an inherited placeholder.
//
// WHAT IS MEASURED vs WHAT IS A MODELING CHOICE
//
//   MEASURED, from the existing modern panel (2016-2026), all 5 folds, mr-down3's
//   own entries (mechanismByKey("mr-down3"), the exact object mechanism-screen.mts
//   and deep-holdout.mts both import — see mechanisms.ts): entry/exit/stop prices
//   for every trade, at LADDERS.flat's geometry (tp1Mult 1.2, slMult 1.5,
//   singleTarget, close fill) with slippageBps set to each grid value in turn and
//   commissionBps forced to 0 (Webull equities charge no commission; the ONLY
//   commission-shaped costs it has are SEC/FINRA below).
//
//   A MODELING CHOICE, not a measurement: whole-share position sizing at a fixed
//   $500 notional per slot (shares = floor(500 / entry), trades that would round
//   to 0 shares are EXCLUDED and counted separately — a real account simply could
//   not take them). $500/slot is this probe's own number, given directly for this
//   probe; it is smaller than docs/STATE.md §1's "$2-3k, ~5 slots" figure, which
//   describes the whole account rather than one slot's allocation. Not
//   reconciled here on purpose — this probe answers "what is the hurdle rate at
//   whole-share, $500-per-trade granularity", which is the harder, more
//   conservative case (more rounding, higher fee-to-notional ratio) and therefore
//   the more informative one to know first.
//
//   REAL, DISCLOSED FEE FORMULAS (not swept — these are not unknowns):
//     SEC Section 31 fee: $0.0000278 per $ of SELL-side dollar volume, min $0.01
//     FINRA TAF:           $0.000166 per SELL-side share, min $0.01, max $8.30
//   mr-down3 is LONG-ONLY (mechanisms.ts: "long after 3 consecutive lower
//   closes", no short branch), so the sell leg is always the EXIT, never the
//   entry.
//
//   SWEPT, because this is the genuinely unknown number: execution friction from
//   PFOF market-maker routing (Citadel/Two Sigma class), as two independent grids
//   the caller specified:
//     bps-per-side:  [0.5, 1.0, 2.0, 3.0, 5.0, 7.5, 10.0]  (fed through the
//                    engine's own slippageBps, which already charges it on both
//                    entry AND exit — "per side" is exactly what that field is)
//     cents-per-share: [0.00, 0.01, 0.02, 0.03, 0.05]  (NOT expressible through
//                    CostModel, which is bps-only — applied by hand to the
//                    zero-friction trade's entry/exit, worse-for-the-trader on
//                    both legs, mirroring engine.ts's own slippage convention)
//
// WHAT THIS SCRIPT DOES NOT TOUCH
//
// src/lib/backtest/engine.ts and src/lib/research/panelRun.ts are read-only
// dependencies. CostModel has no field for a flat per-share cost or a
// dollar-volume-based regulatory fee, and this script does not add one — the
// $500-notional whole-share fee math is computed here, once per closed trade,
// as a post-processing step over the trade list the existing panel/fold/engine
// path already produces.
//
// THIS IS A DIAGNOSTIC. No promotion gate is invoked, no random-entry control is
// run (this is not a "does mr-down3 beat chance" question, it already answered
// that one — see nexmind-mr-down3-passed-holdout.md). Nothing here may be read as
// an approval or a rejection of mr-down3 on its own; it exists to make the
// hurdle-rate estimate falsifiable.
//
//   npx tsx scripts/mr-down3-webull-cost-realism.mts | tee scripts/mr-down3-webull-cost-realism.log
//
import "dotenv/config";
import { loadPanel, FOLDS, type FoldName } from "@/lib/research/panel";
import { sliceFold, withSignals, simulateFold, type PreparedSymbol, type PanelExit, type FoldRun } from "@/lib/research/panelRun";
import { computeEntrySignals, type CostModel } from "@/lib/backtest/engine";
import { LADDERS, mechanismByKey } from "@/lib/research/mechanisms";
import { computeStats } from "@/lib/trading/stats";
import {
  SEC_FEE_RATE, SEC_FEE_MIN, FINRA_TAF_RATE, FINRA_TAF_MIN, FINRA_TAF_MAX,
  priceWholeShareTrade, type RawTrade, type WholeShareTrade,
} from "@/lib/research/webullCosts";

const MECH = mechanismByKey("mr-down3");
const ALL_FOLDS: FoldName[] = ["fit", "select", "test1", "test2", "test3"];

const SLOT_USD = 500;

const BPS_GRID = [0.5, 1.0, 2.0, 3.0, 5.0, 7.5, 10.0];
const CENTS_GRID = [0.0, 0.01, 0.02, 0.03, 0.05];

const EXIT_GEOM: Pick<PanelExit, "tp1Mult" | "slMult" | "singleTarget" | "entryAt"> = {
  tp1Mult: LADDERS.flat.tp1Mult,
  slMult: LADDERS.flat.slMult,
  singleTarget: true,
  entryAt: "close",
};

type PricedTrade = WholeShareTrade;

/** Extract the fields this probe needs, asserting the long-only invariant mechanisms.ts documents. */
function toRawTrades(run: FoldRun): RawTrade[] {
  return run.trades.map((t) => {
    if (t.side !== "long") throw new Error(`mr-down3 produced a ${t.side} trade — mechanisms.ts says long-only, re-check before trusting this probe`);
    return { side: t.side, entry: t.entry, exit: t.exit, sl: t.sl, openedAt: t.openedAt, closedAt: t.closedAt };
  });
}

/**
 * Whole-share, $500-notional economics for one trade under one friction model.
 * `entryFill`/`exitFill` already have the swept friction baked in. Thin wrapper
 * over webullCosts.ts's side-aware pricer, at this probe's own fixed slot size.
 */
function priceTrade(raw: RawTrade, entryFill: number, exitFill: number): PricedTrade | null {
  return priceWholeShareTrade(raw, SLOT_USD, entryFill, exitFill);
}

interface GridRow {
  label: string;
  gridValue: number;
  n: number;
  excluded: number;
  avgR: number | null;
  avgFeeUsd: number;
  avgGrossUsd: number;
  avgTotalCostUsd: number;
  sharpe: number | null;
  annualizedDragPct: number;
}

/**
 * `avgGrossRef` is the average gross P&L per trade with ZERO execution friction
 * (measured once, shared by both sweeps — see main()). `grossUsd - netUsd`
 * cannot be used for "total cost": netUsd := grossUsd - feesUsd BY DEFINITION,
 * so that difference is always exactly feesUsd and silently drops the swept
 * friction itself — the dominant cost this probe exists to measure. This is
 * especially true for the bps sweep, where the engine bakes slippage directly
 * into entry/exit before this script ever sees the trade (SimTrade's own
 * convention), so a single trade's own gross/net can never expose it; only a
 * separate zero-friction population can.
 */
function summarizeGridRow(label: string, gridValue: number, priced: PricedTrade[], excluded: number, tradesPerYearPerSlot: number, avgGrossRef: number): GridRow {
  const rs = priced.map((p) => p.rMultiple).filter((r): r is number => r != null);
  const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  const avgFeeUsd = priced.length ? priced.reduce((s, p) => s + p.feesUsd, 0) / priced.length : 0;
  const avgGrossUsd = priced.length ? priced.reduce((s, p) => s + p.grossUsd, 0) / priced.length : 0;
  const avgNetUsd = priced.length ? priced.reduce((s, p) => s + p.netUsd, 0) / priced.length : 0;
  const avgTotalCostUsd = avgGrossRef - avgNetUsd; // fees AND friction, vs the zero-friction population
  const perf = computeStats(priced, SLOT_USD);
  const annualizedDragPct = (tradesPerYearPerSlot * avgTotalCostUsd) / SLOT_USD * 100;
  return {
    label, gridValue, n: priced.length, excluded, avgR,
    avgFeeUsd, avgGrossUsd, avgTotalCostUsd, sharpe: perf.sharpeRatio, annualizedDragPct,
  };
}

function printGrid(title: string, unit: string, rows: GridRow[]) {
  console.log(`\n${"=".repeat(100)}\n${title}\n${"=".repeat(100)}`);
  console.log(
    `  ${"grid".padEnd(10)}${"n".padStart(7)}${"excl".padStart(7)}${"avgR(net)".padStart(12)}` +
      `${"avg fee$".padStart(11)}${"tot cost$".padStart(11)}${"avg gross$".padStart(13)}${"sharpe".padStart(9)}${"ann.drag%".padStart(12)}`,
  );
  for (const r of rows) {
    console.log(
      `  ${r.label.padEnd(10)}${String(r.n).padStart(7)}${String(r.excluded).padStart(7)}` +
        `${(r.avgR == null ? "n/a" : r.avgR.toFixed(4)).padStart(12)}` +
        `${r.avgFeeUsd.toFixed(3).padStart(11)}${r.avgTotalCostUsd.toFixed(3).padStart(11)}${r.avgGrossUsd.toFixed(2).padStart(13)}` +
        `${(r.sharpe == null ? "n/a" : r.sharpe.toFixed(2)).padStart(9)}${r.annualizedDragPct.toFixed(1).padStart(12)}`,
    );
  }
  void unit;
}

/** First point where avgR crosses from positive to <= 0 as the grid value increases; linear interpolation. */
function findHurdle(rows: GridRow[]): { value: number; interpolated: boolean; note: string } | null {
  const usable = rows.filter((r) => r.avgR != null) as (GridRow & { avgR: number })[];
  if (!usable.length) return null;
  if (usable[0].avgR <= 0) {
    return { value: usable[0].gridValue, interpolated: false, note: `already <= 0 at the smallest tested grid value (${usable[0].gridValue})` };
  }
  for (let i = 1; i < usable.length; i++) {
    const prev = usable[i - 1];
    const cur = usable[i];
    if (prev.avgR > 0 && cur.avgR <= 0) {
      const frac = prev.avgR / (prev.avgR - cur.avgR);
      const value = prev.gridValue + frac * (cur.gridValue - prev.gridValue);
      return { value, interpolated: true, note: `interpolated between ${prev.gridValue} (avgR ${prev.avgR.toFixed(4)}) and ${cur.gridValue} (avgR ${cur.avgR.toFixed(4)})` };
    }
  }
  // Never crosses within the tested range — extrapolate from the OLS slope.
  const slope = olsSlope(usable.map((r) => r.gridValue), usable.map((r) => r.avgR));
  const last = usable[usable.length - 1];
  if (slope.m >= 0) return null; // cost is not eroding the edge at all in the tested range
  const extrapolated = last.gridValue + (0 - last.avgR) / slope.m;
  return { value: extrapolated, interpolated: true, note: `NOT reached within tested range (max grid ${last.gridValue} still avgR ${last.avgR.toFixed(4)}) — extrapolated from the fitted slope` };
}

function olsSlope(xs: number[], ys: number[]): { m: number; b: number } {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const m = den === 0 ? 0 : num / den;
  return { m, b: my - m * mx };
}

async function main() {
  console.log("Pre-registered Probe #1: Webull Cost Realism on mr-down3 — DIAGNOSTIC, not a promotion gate");
  console.log(`Slot size: $${SLOT_USD}, whole shares only. SEC fee ${SEC_FEE_RATE}/$ (min $${SEC_FEE_MIN}), FINRA TAF ${FINRA_TAF_RATE}/share (min $${FINRA_TAF_MIN}, max $${FINRA_TAF_MAX}).`);

  const panel = loadPanel();
  const prepared: Record<FoldName, PreparedSymbol[]> = {} as Record<FoldName, PreparedSymbol[]>;
  for (const f of ALL_FOLDS) {
    prepared[f] = withSignals(sliceFold(panel, FOLDS[f]), (_sym, candles) =>
      computeEntrySignals(candles, undefined, MECH.rule!(candles)),
    );
  }

  // --- sanity check against the caller's "~40 signals/day" figure -----------
  let totalSignals = 0;
  let totalBars = 0;
  for (const f of ALL_FOLDS) {
    for (const p of prepared[f]) {
      totalBars += p.candles.length - p.entryFrom;
      for (let i = p.entryFrom; i < p.signals.sides.length; i++) if (p.signals.sides[i]) totalSignals++;
    }
  }
  console.log(`\nMEASURED signal frequency (all 5 folds, whole panel): ${totalSignals} signal-bars over ${totalBars} symbol-days`);
  console.log(`  -> ${(totalSignals / (totalBars / panel.symbols.length)).toFixed(1)} signals/day averaged across the panel (caller's figure: ~40/day)`);

  // --- zero-friction reference (shared by both sweeps' cost accounting) -----
  // A single trade's own grossUsd/netUsd can never expose friction cost:
  // netUsd := grossUsd - feesUsd by definition, so that gap is always exactly
  // feesUsd. "Total cost" (fees + friction) is only visible by diffing against
  // a genuinely zero-friction population — this is it. It also serves as
  // SWEEP 2's own raw trade set, since cents friction is applied by hand to it.
  const rawByFold: Record<FoldName, RawTrade[]> = {} as Record<FoldName, RawTrade[]>;
  for (const f of ALL_FOLDS) {
    const run = simulateFold(prepared[f], FOLDS[f], { ...EXIT_GEOM, costs: { slippageBps: 0, commissionBps: 0 } });
    rawByFold[f] = toRawTrades(run);
  }
  const zeroFrictionPriced: PricedTrade[] = ALL_FOLDS.flatMap((f) => rawByFold[f])
    .map((raw) => priceTrade(raw, raw.entry, raw.exit))
    .filter((p): p is PricedTrade => p != null);
  const avgGrossRef = zeroFrictionPriced.reduce((s, p) => s + p.grossUsd, 0) / zeroFrictionPriced.length;
  console.log(`\nZero-friction reference (SEC/FINRA fees only): avg gross $${avgGrossRef.toFixed(4)}/trade, n=${zeroFrictionPriced.length}`);

  // --- BPS-per-side sweep (fed through the engine's own slippageBps) --------
  const bpsRows: GridRow[] = [];
  let bpsHoldingDays: number[] = [];
  for (const bps of BPS_GRID) {
    const costs: CostModel = { slippageBps: bps, commissionBps: 0 };
    let priced: PricedTrade[] = [];
    let excluded = 0;
    const holding: number[] = [];
    for (const f of ALL_FOLDS) {
      const run = simulateFold(prepared[f], FOLDS[f], { ...EXIT_GEOM, costs });
      for (const raw of toRawTrades(run)) {
        const p = priceTrade(raw, raw.entry, raw.exit);
        if (p) { priced.push(p); holding.push(p.holdingDays); } else excluded++;
      }
    }
    if (bps === BPS_GRID[0]) bpsHoldingDays = holding;
    const tradesPerYearPerSlot = 365 / (holding.reduce((a, b) => a + b, 0) / holding.length);
    bpsRows.push(summarizeGridRow(String(bps), bps, priced, excluded, tradesPerYearPerSlot, avgGrossRef));
  }
  printGrid("SWEEP 1: Execution friction as bps-per-side (Webull PFOF spread proxy)", "bps", bpsRows);

  // --- cents-per-share sweep (NOT expressible via CostModel — applied by hand)
  const centsRows: GridRow[] = [];
  for (const cents of CENTS_GRID) {
    let priced: PricedTrade[] = [];
    let excluded = 0;
    const holding: number[] = [];
    for (const f of ALL_FOLDS) {
      for (const raw of rawByFold[f]) {
        // Long only: buying fills higher, selling fills lower — always worse.
        const entryFill = raw.entry + cents;
        const exitFill = raw.exit - cents;
        const p = priceTrade(raw, entryFill, exitFill);
        if (p) { priced.push(p); holding.push(p.holdingDays); } else excluded++;
      }
    }
    const tradesPerYearPerSlot = 365 / (holding.reduce((a, b) => a + b, 0) / holding.length);
    centsRows.push(summarizeGridRow(cents.toFixed(2), cents, priced, excluded, tradesPerYearPerSlot, avgGrossRef));
  }
  printGrid("SWEEP 2: Execution friction as flat cents-per-share (odd-lot/whole-share reality)", "$/share", centsRows);

  // --- Hurdle Rate ------------------------------------------------------------
  console.log(`\n${"=".repeat(100)}\nHURDLE RATE (break-even friction, net of SEC fee + FINRA TAF)\n${"=".repeat(100)}`);
  const bpsHurdle = findHurdle(bpsRows);
  const centsHurdle = findHurdle(centsRows);
  const avgPrice = (() => {
    const all = ALL_FOLDS.flatMap((f) => rawByFold[f]).map((t) => t.entry);
    return all.reduce((a, b) => a + b, 0) / all.length;
  })();
  let bpsAsUsdPerShare: number | null = null;
  let centsAsBps: number | null = null;
  if (bpsHurdle) {
    bpsAsUsdPerShare = (bpsHurdle.value / 10_000) * avgPrice;
    console.log(`  bps-per-side model:   ${bpsHurdle.value.toFixed(2)} bps/side  (${bpsHurdle.note})`);
    console.log(`    equivalent at the panel's avg entry price ($${avgPrice.toFixed(2)}): $${bpsAsUsdPerShare.toFixed(4)}/share (${(bpsAsUsdPerShare * 100).toFixed(2)} cents/share)`);
  } else {
    console.log(`  bps-per-side model:   not eroding avgR anywhere in [${BPS_GRID[0]}, ${BPS_GRID[BPS_GRID.length - 1]}] bps — slope is flat or positive`);
  }
  if (centsHurdle) {
    centsAsBps = (centsHurdle.value / avgPrice) * 10_000;
    console.log(`  cents-per-share model: $${centsHurdle.value.toFixed(4)}/share (${(centsHurdle.value * 100).toFixed(2)} cents/share)  (${centsHurdle.note})`);
    console.log(`    equivalent at the panel's avg entry price ($${avgPrice.toFixed(2)}): ${centsAsBps.toFixed(2)} bps/side`);
  } else {
    console.log(`  cents-per-share model: not eroding avgR anywhere in [${CENTS_GRID[0]}, ${CENTS_GRID[CENTS_GRID.length - 1]}] $/share — slope is flat or positive`);
  }
  if (bpsHurdle && centsHurdle) {
    const ratio = Math.max(bpsAsUsdPerShare!, centsHurdle.value) / Math.min(bpsAsUsdPerShare!, centsHurdle.value);
    console.log(`\n  CROSS-CHECK: the two independently-extrapolated hurdles convert to $${bpsAsUsdPerShare!.toFixed(4)}/share (from bps) vs $${centsHurdle.value.toFixed(4)}/share (native) — a ${ratio.toFixed(1)}x gap.`);
    console.log(`  ${ratio > 1.5 ? "INCONSISTENT" : "roughly consistent"} — a flat cents-per-share cost and a proportional-bps cost only convert 1:1 through a single price if mr-down3's traded population is price-homogeneous in ATR%-of-price terms. It is not (S&P 500 spans single-digit-% to $1000+ names).` +
      ` Read each grid's OWN hurdle as the authoritative number for its own friction model; the cross-conversion is a sanity gut-check, not a reconciliation, and both figures involve extrapolating past the tested range (max tested ${BPS_GRID[BPS_GRID.length - 1]} bps / ${CENTS_GRID[CENTS_GRID.length - 1]} $/share).`);
  }

  // --- Sensitivity Curve -------------------------------------------------------
  console.log(`\n${"=".repeat(100)}\nSENSITIVITY CURVE (OLS slope, avgR vs grid value)\n${"=".repeat(100)}`);
  const bpsUsable = bpsRows.filter((r) => r.avgR != null);
  const centsUsable = centsRows.filter((r) => r.avgR != null);
  const bpsSlope = olsSlope(bpsUsable.map((r) => r.gridValue), bpsUsable.map((r) => r.avgR!));
  const centsSlope = olsSlope(centsUsable.map((r) => r.gridValue), centsUsable.map((r) => r.avgR!));
  console.log(`  bps model:   avgR = ${bpsSlope.b.toFixed(4)} + (${bpsSlope.m.toFixed(5)}) * bps_per_side`);
  console.log(`  cents model: avgR = ${centsSlope.b.toFixed(4)} + (${centsSlope.m.toFixed(4)}) * cents_per_share`);

  // --- Turnover drag context ----------------------------------------------------
  const avgHoldingDays = bpsHoldingDays.reduce((a, b) => a + b, 0) / bpsHoldingDays.length;
  console.log(`\n${"=".repeat(100)}\nTURNOVER CONTEXT\n${"=".repeat(100)}`);
  console.log(`  mean holding period: ${avgHoldingDays.toFixed(2)} days -> ${(365 / avgHoldingDays).toFixed(1)} round trips/year for one continuously-redeployed $${SLOT_USD} slot`);
  console.log(`  "ann.drag%" columns above are PROJECTED: (round trips/year) * (avg total cost $/trade at that grid point) / $${SLOT_USD}.`);
  console.log(`  This assumes zero idle cash between signals, which is optimistic — a real slot waits for the next mr-down3 fire on ITS OWN symbol pool, not the next one anywhere in the panel.`);

  console.log(`\nDone. This is a diagnostic: it establishes a hurdle rate, it does not approve or reject mr-down3.`);
}

await main();
