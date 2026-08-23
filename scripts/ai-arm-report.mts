// Does the AI add money?
//
// Resolves every counterfactual row that now has enough forward candles, then
// prints the two arms side by side: what HAWK and SAGE actually decided, and
// what the deterministic mock would have decided on the very same bars.
//
// The number that matters is the last one — R per OPPORTUNITY, not per trade.
// A desk that vetoes nine setups and wins the tenth has an excellent win rate
// and, quite possibly, a negative edge; scoring every opportunity (a veto earns
// exactly 0) is the only way that shows up.
//
// Usage:
//   node --env-file=.env --import tsx scripts/ai-arm-report.mts [--portfolio=1] [--range=3mo]
//
// Note: rows are only written on ticks where a REAL backend decided. While the
// desk is running on the mock path this table stays empty by design — the two
// arms would be the same decision, and comparing a thing to itself proves
// nothing. An empty report means "no evidence yet", not "no edge".

import { prisma } from "../src/lib/db";
import { resolveCounterfactuals, compareArms } from "../src/lib/trading/counterfactual";
import type { Range } from "../src/lib/yahoo";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const r2 = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(3);
const pct = (n: number) => `${n.toFixed(1)}%`;

async function main() {
  const portfolioId = Number(
    arg("portfolio") ?? (await prisma.portfolio.findFirst({ orderBy: { id: "asc" }, select: { id: true } }))?.id,
  );
  if (!Number.isFinite(portfolioId)) throw new Error("no portfolio found — pass --portfolio=<id>");

  const total = await prisma.counterfactual.count({ where: { portfolioId } });
  if (total === 0) {
    console.log(
      `Portfolio #${portfolioId}: no counterfactuals recorded yet.\n` +
        `Rows are written only on ticks where a real AI backend decided — run \`claude login\`\n` +
        `(or set ANTHROPIC_API_KEY) and let the desk tick, then come back.`,
    );
    return;
  }

  const res = await resolveCounterfactuals(portfolioId, { range: (arg("range") as Range) ?? "3mo" });
  console.log(`Resolved ${res.resolved}/${res.checked} pending rows (${res.pending} still open).\n`);

  const rows = await prisma.counterfactual.findMany({
    where: { portfolioId, resolvedAt: { not: null } },
    select: { aiOutcome: true, aiR: true, mockR: true },
  });
  const c = compareArms(rows);

  if (c.ai.opportunities === 0) {
    console.log(`${total} rows recorded, none resolved yet — no verdict available.`);
    return;
  }

  console.log(`Portfolio #${portfolioId} — ${c.ai.opportunities} scored opportunities\n`);
  console.log("arm      trades   win%     avgR/opp    totalR");
  console.log("-".repeat(48));
  for (const [name, a] of [["AI", c.ai], ["mock", c.mock]] as const) {
    console.log(
      `${name.padEnd(8)} ${String(a.traded).padStart(6)} ${pct(a.winRate).padStart(7)} ` +
        `${r2(a.avgR).padStart(11)} ${r2(a.totalR).padStart(9)}`,
    );
  }

  console.log(`\nAI edge: ${r2(c.edgePerOpportunity)} R per opportunity`);
  console.log(
    c.edgePerOpportunity > 0
      ? "  → the analysts beat the deterministic stand-in on this sample."
      : "  → the analysts did NOT beat the deterministic stand-in on this sample.",
  );

  console.log(`\nRefused ${c.refused} setups; they would have averaged ${r2(c.refusedAvgR)} R.`);
  console.log(
    c.refusedAvgR < 0
      ? "  → the refusals were dodging losers, which is the job."
      : "  → the refusals were leaving money on the table.",
  );

  console.log("\nby outcome:");
  for (const [outcome, b] of Object.entries(c.byOutcome).sort((a, z) => z[1].count - a[1].count)) {
    console.log(`  ${outcome.padEnd(15)} ${String(b.count).padStart(4)}   mock would have made ${r2(b.mockAvgR)} R`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
