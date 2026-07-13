import { prisma } from "../src/lib/db";

async function main() {
  const portfolios = await prisma.portfolio.findMany({ orderBy: { id: "asc" } });
  for (const p of portfolios) {
    const wl = await prisma.watchlist.findMany({ where: { portfolioId: p.id } });
    console.log(
      `#${p.id} ${p.name} | kind=${p.kind} status=${p.status} | strategy=${p.strategy} | scan=${p.scanInterval}/${p.scanRange} | universe=${p.universe ?? "-"} | start=$${p.startingBalance} risk%=${p.riskPctPerTrade} halt%=${p.drawdownHaltPct} maxOpen=${p.maxOpenPositions} killSwitch=${p.killSwitch} | watchlist=[${wl.map((w) => `${w.symbol}${w.enabled ? "" : "(off)"}`).join(", ")}]`
    );
  }
}
main().then(() => process.exit(0));
