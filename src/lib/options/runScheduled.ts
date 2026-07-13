// Scheduled options-desk orchestration, shared by the CLI script
// (scripts/options.mts) and the cron API route. For each given options
// portfolio id (or every active options portfolio when none passed), run the
// autonomous options desk: settle expired, close flipped/near-expiry, open
// new delta-targeted positions.
import { prisma } from "@/lib/db";
import { runOptions } from "@/lib/options/engine";
import { isOptionsKind, canPortfolioTrade } from "@/lib/portfolioGuards";

export async function runScheduledOptions(ids?: number[]): Promise<string[]> {
  const lines: string[] = [];
  const log = (m: string) => lines.push(`[${new Date().toISOString()}] ${m}`);

  const portfolios = await prisma.portfolio.findMany({
    where: ids && ids.length ? { id: { in: ids } } : { status: "active", kind: "options" },
  });
  if (portfolios.length === 0) { log("no matching options portfolios"); return lines; }

  for (const p of portfolios) {
    if (!isOptionsKind(p.kind) || !canPortfolioTrade(p.status)) {
      log(`#${p.id} ${p.name} skipped (kind=${p.kind}, status=${p.status})`);
      continue;
    }
    try {
      const r = await runOptions(p.id);
      log(`#${p.id} ${p.name}: settled=${r.settled.length} closed=${r.closed.length} opened=${r.opened.length} errors=${r.errors.length}`);
      for (const o of r.opened) log(`  OPEN ${o}`);
      for (const c of r.closed) log(`  CLOSE ${c}`);
      for (const e of r.errors.slice(0, 5)) log(`  ERR ${e}`);
    } catch (e) {
      log(`#${p.id} ${p.name} FATAL ${String(e)}`);
    }
  }
  return lines;
}
