// Is the ATR trail's advantage GEOMETRY, or is it exposure?
//
// scripts/exit-control.mts gave the trail its first reading under a valid null:
// against the 1.5/1.5 ladder, on the same entries, `trail 1/1.5` has a positive
// delta in 5/5 folds and `trail 1.5/1.5` in 4/5. That is exactly the shape of
// result this project has been fooled by before. `regime x side` also looked
// 5/5 positive and turned out to be beta: the above-trend longs were buying
// exposure to a drifting panel, and the matched control took all of it back.
//
// So before anything is tuned, the same question gets asked of the trail. Two
// readings, both of which the paired control already supports and neither of
// which needs a new engine feature:
//
//   1. SIDE SPLIT. Compute the paired delta separately on LONG trades and on
//      SHORT trades. A trail that works because it rides an up-drifting panel
//      helps longs and cannot help shorts. A trail that works because it
//      converts favourable excursion into a realised exit helps BOTH, since the
//      mechanism is indifferent to direction. This is the same test that
//      exposed regime x side, and it is decisive in a way an aggregate is not.
//
//   2. DURATION. Print mean holding time per arm. If the delta is really
//      exposure, it should track how much LONGER a geometry holds than the
//      baseline: hold longer in a market that drifts up, collect more drift.
//      The five geometries differ a lot in holding time, so this is a real
//      ordering to check and not a formality.
//
// PRE-REGISTERED, written before any fold was run.
//
// Predictions, stated so they can be wrong:
//   - exposure  => delta > 0 on longs, delta <= 0 on shorts, and delta rises
//                  with the hold difference across the five geometries.
//   - geometry  => delta > 0 on BOTH sides in most folds, and no reliable
//                  ordering by hold — in particular `single 3/1.5`, which holds
//                  longest of the non-trail options, is not the best.
//
// Decision rule, fixed in advance. Call it geometry only if each trail's delta
// on SHORTS is positive in at least 4 of 5 folds. Call it exposure if shorts
// are <= 0 in at least 4 of 5 while longs are positive. Anything else is
// "mixed", which is a real answer and must be reported as one rather than
// rounded toward whichever story is more convenient.
//
// All five folds are run together, and that is not a selection violation:
// nothing is being chosen here. The geometries are fixed, they were already
// read on all five folds by exit-control.mts, and the output is a sign pattern
// rather than a pick. There is no parameter for a holdout to protect.
//
// RESULT (scripts/trail-is-geometry.log, 2026-09-05):
//
// The three WIDER SINGLE TARGETS are exposure, and the pre-registered rule says
// so cleanly. `single 2`, `single 2.5` and `single 3` are positive on longs in
// 4/5 folds and NEGATIVE on shorts in 5/5 folds each — 15 of 15 short cells the
// wrong way — and the size of both halves grows monotonically with tp1Mult in
// every fold. That is the exposure prediction written out in full: hold longer,
// collect more drift on the long side, pay more of it back on the short side.
// It also explains the pattern exit-control.mts flagged as a fit — delta rising
// with tp1Mult on FIT/TEST1 and falling with it on SELECT/TEST2 is not a
// mystery, it is the long/short mix of the fold. **`single 3/1.5`'s +0.041 on
// TEST1 must never be quoted as an exit result.**
//
// The TRAILS do not behave that way. `trail 1/1.5` has a POSITIVE short delta
// in 5/5 folds (+0.018 / +0.002 / +0.069 / +0.029 / +0.042); `trail 1.5/1.5` in
// 3/5. Whatever the trail is doing, it is not the thing the single targets are
// doing, and it is not indifferent to direction in the way drift-collection is.
//
// By the pre-registered rule the trails are **MIXED**, and that is the verdict
// on record. Geometry required shorts p5 > 0 in >= 4 of 5 folds; `trail 1/1.5`
// manages 1 of 5. Exposure required shorts <= 0 in >= 4 of 5; it manages 0 of 5.
// Neither branch fires. The short samples are ~2.4-8.2k trades against three
// times as many longs, spread over the same handful of monthly blocks, so those
// intervals are wide — which is exactly the "not measurable" case the header
// warned about, not evidence of zero.
//
// Post-hoc, and labelled as such because it was NOT pre-registered: a positive
// short delta in 5 of 5 folds is p = 1/32 under a fair-coin null. Suggestive,
// on folds that are not fully independent, and not a substitute for the p5 bar
// the rule actually asked for.
//
// DURATION IS REFUTED outright. The rank correlation between "holds longer than
// the baseline" and delta is NEGATIVE in all five folds (-0.10 / -0.90 / -0.10 /
// -0.90 / -0.10, mean -0.42). The plainest form of it: the trails hold 10.8-13.5
// days against the single targets' 13.8-16.8, hold LESS, and beat them
// everywhere. Longer holding is not what buys the delta.
//
// What this changes. The exit axis is not one axis. Widening a fixed target is
// a way of buying drift and the control catches it; trailing is a different
// mechanism whose long-side value is solid and whose short-side value is
// positive in every fold but too small to clear the bar at this sample size.
// The next question is therefore about POWER on the short side, not about
// tuning the trail — and the honest way to buy power is more independent
// months, not a looser threshold.
//
//   npx tsx scripts/trail-is-geometry.mts
//
import "dotenv/config";
import { loadPanel, FOLDS } from "@/lib/research/panel";
import {
  sliceFold, simulateFold, sameGeometry, BASELINE_EXIT, PANEL_LOT, PANEL_SEED,
  type ExitGeometry, type PanelExit, type PreparedSymbol,
} from "@/lib/research/panelRun";
import { pairedBlockBootstrap, mulberry32 } from "@/lib/research/control";
import { LADDER_OPTIONS } from "@/lib/research/runResearch";
import { computeEntrySignals, DEFAULT_COST_MODEL, type SimTrade } from "@/lib/backtest/engine";

const runs = Number(process.argv.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 1000);

const label = (g: ExitGeometry) =>
  g.trail ? `trail ${g.trail.activateMult}/${g.trail.offsetMult}` : `single ${g.tp1Mult}/${g.slMult}`;

const CANDIDATES: ExitGeometry[] = LADDER_OPTIONS.filter((g) => !sameGeometry(g, BASELINE_EXIT));
const FOLD_LIST = [FOLDS.fit, FOLDS.select, FOLDS.test1, FOLDS.test2, FOLDS.test3];

const fmt = (x: number, w = 8) => `${x >= 0 ? "+" : ""}${x.toFixed(3)}`.padStart(w);
const DAY_MS = 86_400_000;

/** Mean calendar days held. Calendar, not bars: the arms trade the same daily
 *  series, so the two are proportional, and days is the unit the desk thinks in. */
function meanHold(trades: SimTrade[]): number {
  if (!trades.length) return 0;
  return trades.reduce((s, t) => s + (t.closedAt.getTime() - t.openedAt.getTime()), 0) / trades.length / DAY_MS;
}

/** Spearman rank correlation. Five points, no ties expected; ties get average ranks anyway. */
function spearman(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const rank = (v: number[]): number[] => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(n);
    for (let i = 0; i < n; ) {
      let j = i;
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? null : num / Math.sqrt(dx * dy);
}

/** The paired delta over one side's trades only. Same instrument, narrower slice. */
function sideDelta(candidate: SimTrade[], baseline: SimTrade[], side: "long" | "short", seed: number) {
  return pairedBlockBootstrap(
    candidate.filter((t) => t.side === side),
    baseline.filter((t) => t.side === side),
    runs,
    mulberry32(seed),
  );
}

async function main() {
  const panel = await loadPanel();
  console.log(`panel: ${panel.symbols.length} symbols · ${runs} paired resamples per cell`);
  console.log(`baseline (null): ${label(BASELINE_EXIT)} · all five folds, no selection is being made here\n`);

  // side sign tallies, per geometry, across folds
  const shortsPositive = new Map<string, number>();
  const longsPositive = new Map<string, number>();
  const shortsCounted = new Map<string, number>();
  const rhos: number[] = [];

  for (const fold of FOLD_LIST) {
    const slices = sliceFold(panel, fold);
    const prepared: PreparedSymbol[] = slices.map((s) => ({ ...s, signals: computeEntrySignals(s.candles) }));
    const baselineRun = simulateFold(prepared, fold, { ...BASELINE_EXIT, lot: PANEL_LOT, costs: DEFAULT_COST_MODEL });
    const baseHold = meanHold(baselineRun.trades);
    const baseShorts = baselineRun.trades.filter((t) => t.side === "short").length;

    console.log(`${fold.name} (${fold.from}..${fold.to})`);
    console.log(`  baseline: ${baselineRun.summary.trades} trades, ${baseShorts} short (${(100 * baseShorts / Math.max(1, baselineRun.summary.trades)).toFixed(1)}%), mean hold ${baseHold.toFixed(1)}d`);
    console.log(`  ${"geometry".padEnd(16)}${"hold".padStart(7)}${"vs base".padStart(9)}${"all".padStart(9)}${"long".padStart(9)}${"long p5".padStart(9)}${"short".padStart(9)}${"short p5".padStart(10)}`);

    const holdGap: number[] = [];
    const deltas: number[] = [];

    for (const geo of CANDIDATES) {
      const exit: PanelExit = { ...geo, lot: PANEL_LOT, costs: DEFAULT_COST_MODEL };
      const run = simulateFold(prepared, fold, exit);
      const hold = meanHold(run.trades);

      // Seeds are offset per slice so the three readings are independent draws
      // rather than the same resample relabelled. PANEL_SEED stays the anchor:
      // no caller here can choose it.
      const all = pairedBlockBootstrap(run.trades, baselineRun.trades, runs, mulberry32(PANEL_SEED + 2));
      const lng = sideDelta(run.trades, baselineRun.trades, "long", PANEL_SEED + 11);
      const srt = sideDelta(run.trades, baselineRun.trades, "short", PANEL_SEED + 23);

      if (all) { holdGap.push(hold - baseHold); deltas.push(all.delta); }
      if (lng) longsPositive.set(label(geo), (longsPositive.get(label(geo)) ?? 0) + (lng.delta > 0 ? 1 : 0));
      if (srt) {
        shortsCounted.set(label(geo), (shortsCounted.get(label(geo)) ?? 0) + 1);
        shortsPositive.set(label(geo), (shortsPositive.get(label(geo)) ?? 0) + (srt.p5 > 0 ? 1 : 0));
      }

      console.log(
        `  ${label(geo).padEnd(16)}${hold.toFixed(1).padStart(6)}d${fmt(hold - baseHold, 9)}` +
        `${all ? fmt(all.delta, 9) : "—".padStart(9)}` +
        `${lng ? fmt(lng.delta, 9) : "—".padStart(9)}${lng ? fmt(lng.p5, 9) : "—".padStart(9)}` +
        `${srt ? fmt(srt.delta, 9) : "—".padStart(9)}${srt ? fmt(srt.p5, 10) : "—".padStart(10)}`,
      );
    }

    const rho = spearman(holdGap, deltas);
    if (rho != null) rhos.push(rho);
    console.log(`  rank correlation between "holds longer than baseline" and delta: ${rho == null ? "—" : fmt(rho, 6)}\n`);
  }

  console.log("verdict inputs (pre-registered rule: geometry needs shorts p5 > 0 in >= 4 of 5 folds)");
  for (const geo of CANDIDATES) {
    const k = label(geo);
    console.log(`  ${k.padEnd(16)} shorts p5>0 in ${shortsPositive.get(k) ?? 0}/${shortsCounted.get(k) ?? 0} folds · longs delta>0 in ${longsPositive.get(k) ?? 0}/5`);
  }
  const meanRho = rhos.length ? rhos.reduce((a, b) => a + b, 0) / rhos.length : null;
  console.log(`  mean rank correlation (hold gap vs delta) across folds: ${meanRho == null ? "—" : fmt(meanRho, 6)}`);

  console.log(`
How to read this
  - The SHORT column is the decisive one. Drift in a panel of US equities is up;
    a geometry that only helps longs is collecting that drift, not managing a
    trade. A geometry that helps shorts too is doing something to the trade.
  - Short samples are much smaller than long ones — the entry rule is a
    trend-follower on a panel that mostly rose — so short p5 is a demanding bar
    and a wide interval there means "not measurable", not "zero".
  - The rank correlation asks whether delta is simply bought by holding longer.
    Near +1 across folds would say duration explains the ordering; near 0 or
    negative says it does not.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
