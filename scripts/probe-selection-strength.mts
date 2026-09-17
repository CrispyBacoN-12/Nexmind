// VALIDITY CHECK for probe-selection-bias.mts: did the selection step actually
// bite? A flat false-pass rate across K only means something if the winner of 50
// candidates really is more flattering on FIT than the winner of 1. This measures
// that inflation directly — FIT only, no gate, no controls.
//
//   npx tsx scripts/probe-selection-strength.mts --sweeps=30
import "dotenv/config";
import { loadPanel, FOLDS } from "@/lib/research/panel";
import { sliceFold, withSignals, simulateFold, BASELINE_EXIT } from "@/lib/research/panelRun";
import { computeEntrySignals } from "@/lib/backtest/engine";
import { matchedRandomSignals, mulberry32, percentile } from "@/lib/research/control";

const m = process.argv.find((a) => a.startsWith("--sweeps="));
const SWEEPS = m ? Number(m.split("=")[1]) : 30;
const K_LEVELS = [1, 5, 20, 50];
const M = Math.max(...K_LEVELS);

const panel = await loadPanel();
const template = withSignals(sliceFold(panel, FOLDS.fit), (_s, c) => computeEntrySignals(c));
console.log(`fit template: ${template.length} symbols`);

const best: Record<number, number[]> = Object.fromEntries(K_LEVELS.map((k) => [k, []]));
for (let s = 0; s < SWEEPS; s++) {
  const avgRs: number[] = [];
  for (let c = 0; c < M; c++) {
    const cand = template.map((p) => ({ ...p, signals: matchedRandomSignals(p.signals, p.entryFrom, mulberry32(s * 1_000_003 + c * 7919 + 101)) }));
    avgRs.push(simulateFold(cand, FOLDS.fit, BASELINE_EXIT).summary.avgR ?? -Infinity);
  }
  for (const K of K_LEVELS) best[K].push(Math.max(...avgRs.slice(0, K)));
  console.log(`sweep ${s + 1}/${SWEEPS}  ` + K_LEVELS.map((k) => `K=${k}:${best[k][s].toFixed(4)}`).join("  "));
}

console.log("");
console.log(`=== FIT avgR of the SELECTED zero-edge candidate (${SWEEPS} sweeps) ===`);
console.log("K     median    mean      min       max");
for (const K of K_LEVELS) {
  const v = [...best[K]].sort((a, b) => a - b);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  console.log(`${String(K).padEnd(6)}${percentile(v, 0.5).toFixed(4)}    ${mean.toFixed(4)}    ${v[0].toFixed(4)}    ${v[v.length - 1].toFixed(4)}`);
}
