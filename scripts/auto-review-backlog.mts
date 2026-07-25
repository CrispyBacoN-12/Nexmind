// One-time backfill: apply autoReviewStatus() to every ResearchStrategy still
// sitting at "proposed" from before the reviewer was automated, so the
// backlog doesn't just sit there waiting for a human click that was the
// whole problem in the first place.
// Usage: npx tsx scripts/auto-review-backlog.mts [--apply]
// Without --apply, prints what would change and writes nothing.
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { autoReviewStatus } from "../src/lib/research/autoReview";
import { exportStrategyNote } from "../src/lib/obsidian/export";
import type { BacktestSummary } from "../src/lib/backtest/engine";

async function main() {
  const apply = process.argv.includes("--apply");
  const proposed = await prisma.researchStrategy.findMany({
    where: { status: "proposed" },
    include: { run: true },
    orderBy: { id: "asc" },
  });

  if (!proposed.length) {
    console.log("no strategies at status=proposed - nothing to backfill");
    await prisma.$disconnect();
    return;
  }

  let approved = 0, rejected = 0;
  for (const s of proposed) {
    const bt = JSON.parse(s.backtestSummary || "{}") as BacktestSummary;
    const decided = autoReviewStatus(bt, s.safetyFlag);
    decided === "approved" ? approved++ : rejected++;
    console.log(`research-${s.id} [${s.label}] trades=${bt.trades} pf=${bt.profitFactor ?? "—"} safetyFlag=${s.safetyFlag} -> ${decided}`);
    if (apply) {
      const updated = await prisma.researchStrategy.update({ where: { id: s.id }, data: { status: decided } });
      try {
        exportStrategyNote(updated, s.run);
      } catch (e) {
        console.error(`obsidian export failed for strategy ${updated.id}:`, e);
      }
    }
  }

  console.log(`\n${apply ? "applied" : "would apply"}: ${approved} approved, ${rejected} rejected (of ${proposed.length} proposed)`);
  await prisma.$disconnect();
}

main();
