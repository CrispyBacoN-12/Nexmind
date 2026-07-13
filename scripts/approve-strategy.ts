// Generic approve helper for one-off research review during exploration
// sessions - same effect as PATCH /api/research/[id]/review {status:
// "approved"}, done directly against the DB for batch/scripted use.
// Usage: npx tsx scripts/approve-strategy.ts <id> [<id> ...]
import { prisma } from "../src/lib/db";
import { exportStrategyNote } from "../src/lib/obsidian/export";

async function main() {
  const ids = process.argv.slice(2).map(Number).filter(Number.isInteger);
  if (!ids.length) { console.log("usage: npx tsx scripts/approve-strategy.ts <id> [<id> ...]"); return; }
  for (const id of ids) {
    const existing = await prisma.researchStrategy.findUnique({ where: { id }, include: { run: true } });
    if (!existing) { console.log(`research-${id}: not found`); continue; }
    if (existing.safetyFlag) { console.log(`research-${id}: cannot approve - failed safety scan`); continue; }
    const updated = await prisma.researchStrategy.update({ where: { id }, data: { status: "approved" } });
    exportStrategyNote(updated, existing.run);
    console.log(`research-${id} (${updated.label}): approved`);
  }
}

main().then(() => process.exit(0));
