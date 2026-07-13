// Rejects the 7 candidates from the cross-market transfer experiment
// (Engulfing/BTC v1-v3, Donchian/gold, Donchian/gold ADX-rising,
// DI-Dominance/AAPL, DI-Dominance/AAPL ADX28) - all landed break-even or
// negative (PF 0.77-0.99) after tuning passes, confirming none of these
// gold/BTC-tuned edges transfer to the other market as-is. Same effect as
// PATCH /api/research/[id]/review {status:"rejected"}, done directly against
// the DB since there's no dev server running for a one-off batch update.
// Usage: npx tsx scripts/reject-market-transfer-experiments.ts
import { prisma } from "../src/lib/db";
import { exportStrategyNote } from "../src/lib/obsidian/export";

const IDS = [51, 52, 53, 54, 55, 56, 57];

async function main() {
  for (const id of IDS) {
    const existing = await prisma.researchStrategy.findUnique({ where: { id }, include: { run: true } });
    if (!existing) {
      console.log(`research-${id}: not found, skipping`);
      continue;
    }
    const updated = await prisma.researchStrategy.update({ where: { id }, data: { status: "rejected" } });
    exportStrategyNote(updated, existing.run);
    console.log(`research-${id} (${updated.label}): rejected`);
  }
}

main().then(() => process.exit(0));
