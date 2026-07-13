import { prisma } from "../src/lib/db";

async function main() {
  // #8 Gold Desk: keep risk=1%, widen halt from 10% -> 20% (bootstrap p95 DD
  // was 18.8%, rounded up for margin). Median return stays healthy (~29%/yr).
  const p8 = await prisma.portfolio.update({ where: { id: 8 }, data: { drawdownHaltPct: 20 } });
  console.log(`#${p8.id} ${p8.name} drawdownHaltPct -> ${p8.drawdownHaltPct}`);

  // #13 Gold Trend Desk: keep risk=1%, widen halt from 10% -> 35% (bootstrap
  // p95 DD was 33.4%). Median return stays strongly positive (~82%/yr).
  const p13 = await prisma.portfolio.update({ where: { id: 13 }, data: { drawdownHaltPct: 35 } });
  console.log(`#${p13.id} ${p13.name} drawdownHaltPct -> ${p13.drawdownHaltPct}`);

  // #9 Bitcoin Desk: NOT changed - see chat. At its current 2% risk, bootstrap
  // median return/yr is actually NEGATIVE (-3.6%), so widening the halt to
  // ~69-74% would just let an already-losing sizing bleed further before
  // stopping, not fix anything. Left at 25% pending a decision on risk%/edge.
}

main().then(() => process.exit(0));
