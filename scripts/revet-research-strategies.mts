// One-time (and safely re-runnable) maintenance sweep: re-vets every
// currently-"approved" ResearchStrategy against the CURRENT autoReviewStatus()
// bar. The bar has tightened over time (MIN_TRADES/profitFactor were added or
// raised after some rows were approved), so an old approval can be stale.
//
// A row that no longer clears the bar is demoted to "demoted" — distinct from
// "rejected": it DID pass the pipeline once, under a bar that has since moved,
// which is a materially different fact than "never passed at all."
//
// Usage:
//   npx tsx scripts/revet-research-strategies.mts            (dry run — no writes)
//   npx tsx scripts/revet-research-strategies.mts --apply     (writes demotions)
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { autoReviewStatus } from "../src/lib/research/autoReview";
import type { BacktestSummary } from "../src/lib/backtest/engine";

async function main() {
  const apply = process.argv.includes("--apply");
  const approved = await prisma.researchStrategy.findMany({ where: { status: "approved" } });
  console.log(`checking ${approved.length} approved strategies against the current bar...`);

  let demoted = 0;
  for (const row of approved) {
    let bt: BacktestSummary;
    try {
      bt = JSON.parse(row.backtestSummary);
    } catch {
      console.log(`research-${row.id} (${row.label}): SKIP - backtestSummary is not valid JSON`);
      continue;
    }

    const verdict = autoReviewStatus(bt, row.safetyFlag);
    if (verdict === "approved") continue;

    demoted++;
    const reason = `re-vet ${new Date().toISOString().slice(0, 10)}: no longer clears the bar (trades=${bt.trades}, expectancy=${bt.expectancy}, profitFactor=${bt.profitFactor})`;
    console.log(`research-${row.id} (${row.label}): DEMOTE - ${reason}`);

    const activePortfolios = await prisma.portfolio.findMany({
      where: { strategy: `research-${row.id}`, killSwitch: false },
      select: { id: true, name: true },
    });
    if (activePortfolios.length) {
      console.log(
        `  WARNING: still live on portfolio(s) ${activePortfolios.map((p) => `#${p.id} (${p.name})`).join(", ")} - this script does not change portfolio.strategy, flip it manually if this demotion should take it off live trading`,
      );
    }

    if (apply) {
      await prisma.researchStrategy.update({
        where: { id: row.id },
        data: { status: "demoted", demotedReason: reason },
      });
    }
  }

  console.log(
    apply
      ? `done - ${demoted} row(s) demoted`
      : `dry run complete - ${demoted} row(s) WOULD be demoted (re-run with --apply to write)`,
  );
  await prisma.$disconnect();
}

main();
