// One-time: create a Default portfolio from the current global Setting values,
// then attach every existing Trade/Signal/Watchlist row to it. Idempotent.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

async function getSetting(key: string, fallback: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? fallback;
}

async function main() {
  let def = await prisma.portfolio.findFirst({ where: { name: "Default" }, orderBy: { id: "asc" } });
  if (!def) {
    def = await prisma.portfolio.create({
      data: {
        name: "Default",
        kind: "swing",
        status: "active",
        startingBalance: parseFloat(await getSetting("startingBalance", "10000")) || 10000,
        riskPctPerTrade: parseFloat(await getSetting("riskPctPerTrade", "1")) || 1,
        maxOpenPositions: parseInt(await getSetting("maxOpenPositions", "5"), 10) || 5,
        drawdownHaltPct: parseFloat(await getSetting("drawdownHaltPct", "10")) || 10,
        killSwitch: (await getSetting("killSwitch", "false")) === "true",
        killSwitchReason: await getSetting("killSwitchReason", ""),
        sort: 0,
      },
    });
  }

  const t = await prisma.trade.updateMany({ where: { portfolioId: null }, data: { portfolioId: def.id } });
  const s = await prisma.signal.updateMany({ where: { portfolioId: null }, data: { portfolioId: def.id } });
  const w = await prisma.watchlist.updateMany({ where: { portfolioId: null }, data: { portfolioId: def.id } });
  console.log(`Backfill → portfolio #${def.id}: trades ${t.count}, signals ${s.count}, watchlist ${w.count}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
