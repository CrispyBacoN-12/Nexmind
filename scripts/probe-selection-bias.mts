// MEASUREMENT PROBE — what is NEXMIND's panel gate's false-pass rate under selection bias?
//
// Method mirrors the probe run against HKUDS/Vibe-Trading's validation stack
// (walk_forward_analysis + monte_carlo_test), which false-passed pure noise at
// 2.7% with K=1 candidate and 36.0% with K=50 — i.e. its numbers degrade with
// the size of the search that produced the candidate, because selection and
// measurement happen on the same equity curve.
//
// A zero-edge candidate here is matchedRandomSignals() applied to the baseline
// rule's real signals: same entry COUNT, same long/short mix, same ATRs, same
// eligible bars, entries placed uniformly at random. By construction it has no
// timing edge — it is a draw from exactly the null the gate's own control models.
//
// Per sweep: build M candidates, rank them by FIT avgR, and push the best of the
// first K through the real gate (evaluatePanelFold's checks) on test1/test2/test3.
// Pass = all three folds pass, which is what the desk requires.
//
// The control distribution is computed ONCE per test fold and reused: every
// candidate carries the same per-symbol signal count and side mix, so
// matchedRandomSignals over any of them yields the identical null. Exact, not an
// approximation — and it is what makes the probe affordable.
//
//   npx tsx scripts/probe-selection-bias.mts --sweeps=100
import "dotenv/config";
import { loadPanel, FOLDS, type FoldName } from "@/lib/research/panel";
import {
  sliceFold, withSignals, simulateFold, runControl, panelFoldVerdict,
  BASELINE_EXIT, PANEL_SEED, CONTROL_RUNS, BOOTSTRAP_RUNS,
  type PreparedSymbol, type FoldRun,
} from "@/lib/research/panelRun";
import { computeEntrySignals } from "@/lib/backtest/engine";
import { matchedRandomSignals, mulberry32, monthlyBlockBootstrap, type ControlDistribution } from "@/lib/research/control";

const arg = (n: string, d: number) => {
  const m = process.argv.find((a) => a.startsWith(`--${n}=`));
  return m ? Number(m.split("=")[1]) : d;
};
const SWEEPS = arg("sweeps", 100);
const K_LEVELS = [1, 5, 20, 50];
const M = Math.max(...K_LEVELS);
const TESTS: FoldName[] = ["test1", "test2", "test3"];

const log = (s: string) => { console.log(s); };
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const panel = await loadPanel();
log(`panel: ${panel.symbols.length} symbols`);

// One sandbox pass per fold — the real rule's signals are the TEMPLATE the
// zero-edge candidates are matched to, never scored themselves.
const template: Record<string, PreparedSymbol[]> = {};
for (const name of ["fit", ...TESTS] as FoldName[]) {
  const s = Date.now();
  template[name] = withSignals(sliceFold(panel, FOLDS[name]), (_sym, c) => computeEntrySignals(c));
  log(`template ${name}: ${template[name].length} symbols, ${Date.now() - s}ms`);
}

const randomize = (prep: PreparedSymbol[], rng: () => number): PreparedSymbol[] =>
  prep.map((p) => ({ ...p, signals: matchedRandomSignals(p.signals, p.entryFrom, rng) }));

// The null for every candidate is the same, so pay for it once.
const controls: Record<string, ControlDistribution | null> = {};
for (const name of TESTS) {
  const s = Date.now();
  const seedCand = randomize(template[name], mulberry32(999_000 + name.length));
  controls[name] = runControl(seedCand, FOLDS[name], BASELINE_EXIT, CONTROL_RUNS, PANEL_SEED);
  log(`control ${name}: p95=${controls[name]?.p95.toFixed(4)} median=${controls[name]?.median.toFixed(4)} runs=${controls[name]?.runs} ${Date.now() - s}ms`);
}

const passes: Record<number, number> = Object.fromEntries(K_LEVELS.map((k) => [k, 0]));
const foldPasses: Record<number, Record<string, number>> = Object.fromEntries(
  K_LEVELS.map((k) => [k, Object.fromEntries(TESTS.map((f) => [f, 0]))]),
);

// Which check does the rejecting? Bucketed by the phrase panelFoldVerdict/evaluateHoldout
// uses, so the report can say what is actually holding the line rather than guessing.
const reasonTally: Record<string, number> = {};
const bucket = (r: string): string => {
  if (r.includes("too few held-out trades")) return "trade floor";
  if (r.includes("expectancy is not positive")) return "expectancy <= 0";
  if (r.includes("inverted train/test")) return "inverted split";
  if (r.includes("profit factor")) return "PF < 1.1";
  if (r.includes("kept only")) return "retention < 50% of FIT";
  if (r.includes("symbols traded")) return "participation < 100 symbols";
  if (r.includes("random-entry control")) return "avgR <= control p95";
  if (r.includes("does not beat the random-entry")) return "avgR <= control p95";
  if (r.includes("block bootstrap")) return "bootstrap p5 <= 0";
  return "other";
};

function gateWinner(sweep: number, ci: number, fitRun: FoldRun): { all: boolean; per: Record<string, boolean> } {
  const per: Record<string, boolean> = {};
  let all = true;
  for (const name of TESTS) {
    const rng = mulberry32(sweep * 1_000_003 + ci * 7919 + name.charCodeAt(4));
    const cand = randomize(template[name], rng);
    const run = simulateFold(cand, FOLDS[name], BASELINE_EXIT);
    const boot = monthlyBlockBootstrap(run.trades, BOOTSTRAP_RUNS, mulberry32(PANEL_SEED + 1));
    const v = panelFoldVerdict(fitRun.summary, run, controls[name], boot);
    per[name] = v.passed;
    for (const r of v.reasons) reasonTally[bucket(r)] = (reasonTally[bucket(r)] ?? 0) + 1;
    if (!v.passed) all = false;
  }
  return { all, per };
}

for (let s = 0; s < SWEEPS; s++) {
  const sw = Date.now();
  // M zero-edge candidates, scored on FIT only — the sweep the desk would run.
  const scored: { ci: number; avgR: number; run: FoldRun }[] = [];
  for (let c = 0; c < M; c++) {
    const cand = randomize(template.fit, mulberry32(s * 1_000_003 + c * 7919 + 101));
    const run = simulateFold(cand, FOLDS.fit, BASELINE_EXIT);
    scored.push({ ci: c, avgR: run.summary.avgR ?? -Infinity, run });
  }

  const cache = new Map<number, { all: boolean; per: Record<string, boolean> }>();
  for (const K of K_LEVELS) {
    let best = scored[0];
    for (let c = 1; c < K; c++) if (scored[c].avgR > best.avgR) best = scored[c];
    let g = cache.get(best.ci);
    if (!g) { g = gateWinner(s, best.ci, best.run); cache.set(best.ci, g); }
    if (g.all) passes[K]++;
    for (const f of TESTS) if (g.per[f]) foldPasses[K][f]++;
  }

  const line = K_LEVELS.map((k) => `K=${k}:${passes[k]}/${s + 1}`).join("  ");
  log(`[${el()}] sweep ${s + 1}/${SWEEPS} (${((Date.now() - sw) / 1000).toFixed(1)}s)  ${line}`);
}

log("");
log(`=== NEXMIND panel gate, false-pass rate on zero-edge candidates (${SWEEPS} sweeps) ===`);
log(`K   all-3-folds        test1     test2     test3`);
for (const K of K_LEVELS) {
  const pct = (n: number) => `${((n / SWEEPS) * 100).toFixed(1)}%`.padStart(7);
  log(`${String(K).padEnd(4)}${pct(passes[K])} (${passes[K]}/${SWEEPS})   ${pct(foldPasses[K].test1)}   ${pct(foldPasses[K].test2)}   ${pct(foldPasses[K].test3)}`);
}
log("");
log("=== which check rejected (counts over every fold-verdict computed) ===");
for (const [k, v] of Object.entries(reasonTally).sort((a, b) => b[1] - a[1])) log(`${v.toString().padStart(6)}  ${k}`);
