// One-time (rerunnable) sync of every existing ResearchStrategy into the
// Obsidian vault. Safe to rerun any time - it overwrites each strategy's own
// note (so status/backtest numbers stay current) but never touches the
// indicator/pattern/symbol stub notes once they exist, so hand-written notes
// in Obsidian are never clobbered.
// Usage: npm run sync-obsidian-vault
import { prisma } from "../src/lib/db";
import { exportStrategyNote } from "../src/lib/obsidian/export";

async function main() {
  const strategies = await prisma.researchStrategy.findMany({ include: { run: true } });
  for (const s of strategies) {
    exportStrategyNote(s, s.run);
    console.log(`exported: ${s.label} (${s.id}) [${s.status}]`);
  }
  console.log(`\nDone - ${strategies.length} strategies exported to obsidian-vault/`);
}

main();
