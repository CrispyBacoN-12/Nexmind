// Rejects research-58 (DI-Dominance Widening, BTC daily): PF 0.93,
// -$2403.67/232 trades - the timeframe-transfer experiment didn't hold.
// Usage: npx tsx scripts/reject-di-dominance-btc-daily.ts
import { prisma } from "../src/lib/db";
import { exportStrategyNote } from "../src/lib/obsidian/export";

async function main() {
  const id = 58;
  const existing = await prisma.researchStrategy.findUnique({ where: { id }, include: { run: true } });
  if (!existing) { console.log(`research-${id}: not found`); return; }
  const updated = await prisma.researchStrategy.update({ where: { id }, data: { status: "rejected" } });
  exportStrategyNote(updated, existing.run);
  console.log(`research-${id} (${updated.label}): rejected`);
}

main().then(() => process.exit(0));
