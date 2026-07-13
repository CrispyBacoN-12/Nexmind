import { prisma } from "../src/lib/db";

async function main() {
  // #9 Bitcoin Desk: keep risk=2% (unchanged), widen halt from 25% -> 60%
  // (bootstrap ~5% breach threshold was 56.9%, rounded up for margin, matching
  // the p95 DD of 57.2% at this risk level). Applied only now that research-32
  // (Shallow Pullback in Trend) replaced research-27 - the old halt was left
  // at 25% while research-27 was live because its median return was negative,
  // so widening the halt would have masked a losing setup rather than fixed it.
  const p9 = await prisma.portfolio.update({ where: { id: 9 }, data: { drawdownHaltPct: 60 } });
  console.log(`#${p9.id} ${p9.name} drawdownHaltPct -> ${p9.drawdownHaltPct}`);
}

main().then(() => process.exit(0));
