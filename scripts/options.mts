// Scheduled options runner. For each given options-portfolio id (or every active
// options portfolio when none passed), run the autonomous options desk: settle
// expired, close flipped/near-expiry, open new delta-targeted positions.
// Standalone so Task Scheduler can drive it without the dev server running.
//
//   node --import tsx scripts/options.mts 4   # run options portfolio 4
//   node --import tsx scripts/options.mts     # run all active options portfolios
import { prisma } from "@/lib/db";
import { runOptions } from "@/lib/options/engine";
import { isOptionsKind, canPortfolioTrade } from "@/lib/portfolioGuards";

const ts = () => new Date().toISOString();
const log = (m: string) => console.log(`[${ts()}] ${m}`);
const argIds = process.argv.slice(2).map(Number).filter(Number.isInteger);

async function main() {
  const portfolios = await prisma.portfolio.findMany({
    where: argIds.length ? { id: { in: argIds } } : { status: "active", kind: "options" },
  });
  if (portfolios.length === 0) { log("no matching options portfolios"); return; }

  for (const p of portfolios) {
    if (!isOptionsKind(p.kind) || !canPortfolioTrade(p.status)) {
      log(`#${p.id} ${p.name} skipped (kind=${p.kind}, status=${p.status})`);
      continue;
    }
    try {
      // runOptions settles always; opening is gated by kill switch / global halt inside.
      const r = await runOptions(p.id);
      log(`#${p.id} ${p.name}: settled=${r.settled.length} closed=${r.closed.length} opened=${r.opened.length} errors=${r.errors.length}`);
      for (const o of r.opened) log(`  OPEN ${o}`);
      for (const c of r.closed) log(`  CLOSE ${c}`);
      for (const e of r.errors.slice(0, 5)) log(`  ERR ${e}`);
    } catch (e) {
      log(`#${p.id} ${p.name} FATAL ${String(e)}`);
    }
  }
}

main()
  .catch((e) => { log(`FATAL ${String(e)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
