// One-off: demote research strategies from "approved" to "rejected" after they
// failed the deep-data train/test validation in
// scripts/validate-approved-gold-strategies.mts (GC=F 1h, 2y, 65/35 train/test
// split — same methodology already applied to research-25). Mirrors
// approve-strategy.ts's DB-update + vault re-export pattern so the Obsidian
// note stays in sync instead of drifting from the DB.
// Usage: node --env-file=.env --import tsx scripts/reject-after-deep-validation.mts <id> [<id> ...] "<reason>"

import { prisma } from "../src/lib/db";
import { exportStrategyNote } from "../src/lib/obsidian/export";

async function main() {
  const argv = process.argv.slice(2);
  const reason = argv[argv.length - 1];
  const ids = argv.slice(0, -1).map(Number).filter(Number.isInteger);
  if (!ids.length) { console.log('usage: reject-after-deep-validation.mts <id> [<id> ...] "<reason>"'); return; }

  for (const id of ids) {
    const existing = await prisma.researchStrategy.findUnique({ where: { id }, include: { run: true } });
    if (!existing) { console.log(`research-${id}: not found`); continue; }

    const iterations = JSON.parse(existing.iterations || "[]");
    iterations.push({ code: existing.code, note: reason, backtestSummary: JSON.parse(existing.backtestSummary || "{}") });

    const updated = await prisma.researchStrategy.update({
      where: { id },
      data: { status: "rejected", iterations: JSON.stringify(iterations) },
    });
    exportStrategyNote(updated, existing.run);
    console.log(`research-${id} (${updated.label}): status -> rejected, vault note re-exported`);
  }
}

main().then(() => process.exit(0));
