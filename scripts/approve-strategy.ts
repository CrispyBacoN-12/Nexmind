// Generic approve helper for one-off research review during exploration
// sessions - same effect as PATCH /api/research/[id]/review {status:
// "approved"}, done directly against the DB for batch/scripted use.
// Runs the panel blind test (src/lib/research/blindTest.ts) automatically first
// and refuses to approve on a failing verdict unless --force is given, so a
// candidate can't get ported toward strategies.ts on an in-sample backtest
// alone. Since 2026-08-25 that means all three held-out TEST folds, each beating
// a matched random-entry control — so --force now overrides considerably more
// than it used to.
// Usage: npx tsx scripts/approve-strategy.ts <id> [<id> ...] [--force]
import { prisma } from "../src/lib/db";
import { exportStrategyNote } from "../src/lib/obsidian/export";
import { runBlindTest } from "../src/lib/research/blindTest";

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const ids = argv.filter((a) => a !== "--force").map(Number).filter(Number.isInteger);
  if (!ids.length) { console.log("usage: npx tsx scripts/approve-strategy.ts <id> [<id> ...] [--force]"); return; }
  for (const id of ids) {
    const existing = await prisma.researchStrategy.findUnique({ where: { id }, include: { run: true } });
    if (!existing) { console.log(`research-${id}: not found`); continue; }
    if (existing.safetyFlag) { console.log(`research-${id}: cannot approve - failed safety scan`); continue; }

    const bt = await runBlindTest(id);
    if ("error" in bt) {
      console.log(`research-${id}: blind test could not run (${bt.error}) - not approving`);
      continue;
    }
    if (!bt.passed && !force) {
      console.log(`research-${id} (${existing.label}): FAILED blind test - not approving\n  - ${bt.reasons.join("\n  - ")}\n  (pass --force to override)`);
      continue;
    }
    console.log(
      bt.passed
        ? `research-${id} (${existing.label}): PASSED all ${bt.folds.length} held-out folds\n` +
          bt.folds
            .map(
              (f) =>
                `  ${f.fold} ${f.from}..${f.to} (${f.regime}): trades=${f.summary.trades} ` +
                `symbols=${f.symbolsTraded}/${f.symbolsInFold} avgR=${f.summary.avgR?.toFixed(3) ?? "n/a"} ` +
                `vs control p95 ${f.control?.p95.toFixed(3) ?? "n/a"} ` +
                `pf=${f.summary.profitFactor?.toFixed(2) ?? "n/a"} bootstrap p5=${f.bootstrap?.p5.toFixed(3) ?? "n/a"}`,
            )
            .join("\n")
        : `research-${id} (${existing.label}): blind test FAILED but --force given - approving anyway\n  - ${bt.reasons.join("\n  - ")}`,
    );

    const updated = await prisma.researchStrategy.update({ where: { id }, data: { status: "approved" } });
    exportStrategyNote(updated, existing.run);
    console.log(`research-${id} (${updated.label}): approved`);
  }
}

main().then(() => process.exit(0));
