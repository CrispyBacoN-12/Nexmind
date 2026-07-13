// One-time: ensure a Default portfolio exists, seeded from the current global
// Setting values. Idempotent. Row attachment (setting portfolioId on existing
// Trade/Signal/Watchlist rows) ran during the nullable phase of the migration.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (Postgres connection string)");
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
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

  console.log(`Default portfolio ready → #${def.id}. (Row attachment completed during the nullable migration phase.)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
