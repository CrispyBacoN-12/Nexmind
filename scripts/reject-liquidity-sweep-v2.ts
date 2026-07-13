// Rejects research-60 (Liquidity Sweep, gold, depth-filtered): PF 0.84,
// -$48.64/190 trades - worse than the unfiltered v1 baseline (research-59,
// PF 0.93). The depth filter didn't concentrate the edge the way it did for
// the Engulfing/BTC line.
// Usage: npx tsx scripts/reject-liquidity-sweep-v2.ts
import { prisma } from "../src/lib/db";
import { exportStrategyNote } from "../src/lib/obsidian/export";

async function main() {
  const id = 60;
  const existing = await prisma.researchStrategy.findUnique({ where: { id }, include: { run: true } });
  if (!existing) { console.log(`research-${id}: not found`); return; }
  const updated = await prisma.researchStrategy.update({ where: { id }, data: { status: "rejected" } });
  exportStrategyNote(updated, existing.run);
  console.log(`research-${id} (${updated.label}): rejected`);
}

main().then(() => process.exit(0));
