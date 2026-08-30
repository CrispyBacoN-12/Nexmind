import "dotenv/config";
// Answers the one question the research loop exists to answer: has anything
// actually come out the far end of the panel gate?
//
//   npx tsx scripts/list-survivors.mts
//
// A survivor is a row with status="approved" AND validation="panel-v1". Nothing
// else can hold both: runResearch stamps panel-v1 on every new row, and
// applyBlindTestVerdict rewrites status to "rejected" for anything short of
// `passed: true` on all three TEST folds. That is also exactly what
// adapter.getResearchStrategy filters on, so this list IS the set of strategies
// the desk is allowed to trade.
//
// The reason this script exists rather than `list-approved.mts` answering it:
// that one filters on status alone, so the 84 pre-panel rows drown out a real
// survivor. It also separates the three ways a row can read "rejected" (see
// classifyPanelRow): it failed the TEST folds; its blind test never completed
// (a Neon hiccup mid-round fails closed, by design, and is re-runnable rather
// than a verdict); or it was rejected on the SELECT fold and the gate never ran
// at all. The status column cannot tell them apart, and until 2026-08-31 this
// script filed the third kind under the first — reporting that the TEST folds
// had weighed all three of run #112's candidates when none of them got there.
import { prisma } from "@/lib/db";
import { PANEL_VALIDATION, LEGACY_VALIDATION, TEST_FOLDS } from "@/lib/research/panel";
import { classifyPanelRow, type PanelBlindTestReport, type PanelFoldReport } from "@/lib/research/blindTest";
import { strategyResultLine } from "@/lib/research/scheduledResearch";

/** What the blindTest column can hold: a full report, an error branch, or "{}" for a row that never reached the gate. */
type Stored = Partial<PanelBlindTestReport> & { error?: string; reasons?: string[] };

const num = (v: number | null | undefined, d = 2) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—";

function parseVerdict(json: string): Stored {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" ? (v as Stored) : {};
  } catch {
    return {};
  }
}

/** One line per TEST fold: the numbers that decided it, not just the verdict. */
function foldLine(f: PanelFoldReport): string {
  const ctrl = f.control ? `ctrl-p95 ${num(f.control.p95)}` : "ctrl UNVERIFIED";
  const boot = f.bootstrap ? `boot-p5 ${num(f.bootstrap.p5)}` : "boot UNVERIFIED";
  return (
    `    ${f.passed ? "PASS" : "FAIL"} ${f.fold} ${f.from}..${f.to}  ` +
    `trades ${f.summary.trades}  symbols ${f.symbolsTraded}/${f.symbolsInFold}  ` +
    `avgR ${num(f.summary.avgR)}  ${ctrl}  ${boot}`
  );
}

function printFolds(v: Stored) {
  const folds = v.folds ?? [];
  for (const f of folds) console.log(foldLine(f));
  // A report with fewer than three folds passed vacuously nowhere — say so
  // rather than letting a short list read as three quiet passes.
  if (folds.length !== TEST_FOLDS.length) {
    console.log(`    (only ${folds.length}/${TEST_FOLDS.length} folds reported — treat this row as unvalidated)`);
  }
}

async function main() {
  const rows = await prisma.researchStrategy.findMany({
    where: { validation: PANEL_VALIDATION },
    orderBy: { id: "asc" },
  });
  const legacyApproved = await prisma.researchStrategy.count({
    where: { status: "approved", validation: LEGACY_VALIDATION },
  });

  const parsed = rows.map((r) => ({ row: r, verdict: parseVerdict(r.blindTest), cls: classifyPanelRow(r.status, r.blindTest) }));
  const survivors = parsed.filter((p) => p.cls === "survivor").map((p) => p.row);
  // Rejected because the gate could not be run at all, not because the numbers
  // lost. These are re-runnable; the ones below are not.
  const unfinished = parsed.filter((p) => p.cls === "blind-test-incomplete");
  const failed = parsed.filter((p) => p.cls === "failed-bar");
  const inSampleOnly = parsed.filter((p) => p.cls === "never-reached-gate");

  console.log(`=== SURVIVORS (approved + ${PANEL_VALIDATION}) — the only rows the desk can activate ===`);
  if (!survivors.length) {
    console.log("  none yet.");
  }
  for (const s of survivors) {
    const v = parseVerdict(s.blindTest);
    console.log(`\n  research-${s.id}  "${s.label}"`);
    console.log(`    fit avgR ${num(v.fit?.avgR)}  expectancy ${num(v.fit?.expectancy)}  trades ${v.fit?.trades ?? "—"}`);
    printFolds(v);
    if (v.panel) console.log(`    panel: ${v.panel.symbols} symbols, cache fetched ${v.panel.fetchedAt}`);
  }

  console.log(`\n=== BLIND TEST NEVER COMPLETED (${unfinished.length}) — re-runnable, not a verdict ===`);
  for (const { row, verdict } of unfinished) {
    console.log(`  research-${row.id}  "${row.label}"\n    ${verdict.error}`);
  }
  if (!unfinished.length) console.log("  none.");

  console.log(`\n=== FAILED THE BAR (${failed.length}) ===`);
  for (const { row, verdict } of failed) {
    const first = verdict.reasons?.[0] ?? "(no reason recorded)";
    console.log(`  research-${row.id}  "${row.label}"  ${verdict.reasons?.length ?? 0} reason(s): ${first}`);
  }
  if (!failed.length) console.log("  none.");

  // Not a TEST-fold verdict: these died on SELECT (2019), held out from the
  // refinement loop and the ladder sweep, so runBlindTest was never called. The
  // line prints SELECT first for the reason strategyResultLine documents — the
  // stored backtestSummary is FIT, and FIT is not what rejected them.
  console.log(`\n=== NEVER REACHED THE GATE (${inSampleOnly.length}) — rejected on the SELECT fold, before the TEST folds ===`);
  for (const { row } of inSampleOnly) console.log(`  ${strategyResultLine(row)}`);
  if (!inSampleOnly.length) console.log("  none.");

  console.log(
    `\n${survivors.length} survivor(s) / ${rows.length} ${PANEL_VALIDATION} row(s)` +
      (inSampleOnly.length ? ` · ${inSampleOnly.length} never reached the gate (rejected on SELECT)` : "") +
      `\n${legacyApproved} row(s) still read "approved" under ${LEGACY_VALIDATION} — none of them are desk-eligible.`,
  );
  await prisma.$disconnect();
}

main();
