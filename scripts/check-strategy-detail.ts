// One-off: dump full detail (status, rationale, code) for given research ids.
// Usage: npx tsx scripts/check-strategy-detail.ts <id> [<id> ...]
import { prisma } from "../src/lib/db";

async function main() {
  const ids = process.argv.slice(2).map(Number).filter(Number.isInteger);
  for (const id of ids) {
    const r = await prisma.researchStrategy.findUnique({ where: { id }, include: { run: true } });
    if (!r) { console.log(`research-${id}: not found`); continue; }
    console.log(`\n--- research-${id} ---`);
    console.log(`label: ${r.label}`);
    console.log(`status: ${r.status}`);
    console.log(`symbol/interval: ${r.run.symbol} ${r.run.interval}`);
    console.log(`safetyFlag: ${r.safetyFlag}`);
    console.log(`rationale: ${r.rationale}`);
  }
}

main().then(() => process.exit(0));
