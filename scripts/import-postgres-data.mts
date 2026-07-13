// One-time: load scripts/sqlite-export.json (produced by export-sqlite-data.mts)
// into the new Postgres database. Preserves original ids/relations, then resets
// each table's serial sequence so future autoincrement inserts don't collide.
// Run with:
//   npx tsx scripts/import-postgres-data.mts [path-to-export.json]
import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (Postgres connection string)");
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const inPath = process.argv[2] ?? "scripts/sqlite-export.json";
const dump = JSON.parse(readFileSync(inPath, "utf-8")) as Record<string, Record<string, unknown>[]>;

// Fields to coerce from SQLite's storage representation (0/1 ints, ISO text) to
// real JS types Prisma expects for Postgres (boolean, Date).
const BOOLEAN_FIELDS: Record<string, string[]> = {
  Portfolio: ["killSwitch"],
  Trade: ["ironRulesPassed"],
  Watchlist: ["enabled"],
  ResearchStrategy: ["safetyFlag"],
};

const DATE_FIELDS: Record<string, string[]> = {
  Agent: ["createdAt", "updatedAt"],
  Pipeline: ["createdAt", "finishedAt"],
  PipelineStep: ["createdAt", "finishedAt"],
  NewsItem: ["createdAt"],
  Lesson: ["createdAt"],
  Report: ["periodStart", "periodEnd", "createdAt"],
  BuildJob: ["createdAt", "appliedAt"],
  Setting: ["updatedAt"],
  Portfolio: ["createdAt"],
  Signal: ["createdAt"],
  Trade: ["openedAt", "closedAt"],
  Watchlist: ["createdAt"],
  Holding: ["openedAt", "closedAt", "updatedAt"],
  OptionHolding: ["expiry", "openedAt", "closedAt", "updatedAt"],
  ResearchRun: ["createdAt", "finishedAt"],
  ResearchStrategy: ["createdAt"],
};

// Insertion order respects foreign keys (referenced tables first).
const ORDER = [
  "Agent", "Pipeline", "PipelineStep", "NewsItem", "Lesson", "Report",
  "BuildJob", "Setting", "Portfolio", "Signal", "Trade", "Watchlist",
  "Holding", "OptionHolding", "ResearchRun", "ResearchStrategy",
] as const;

// model accessor names differ in case from table names (agent, pipeline, ...)
const MODEL_KEY: Record<string, string> = Object.fromEntries(
  ORDER.map((t) => [t, t.charAt(0).toLowerCase() + t.slice(1)])
);

function coerceRow(table: string, row: Record<string, unknown>) {
  const out = { ...row };
  for (const f of BOOLEAN_FIELDS[table] ?? []) {
    if (out[f] !== null && out[f] !== undefined) out[f] = Boolean(out[f]);
  }
  for (const f of DATE_FIELDS[table] ?? []) {
    if (out[f] !== null && out[f] !== undefined) out[f] = new Date(out[f] as string);
  }
  return out;
}

async function main() {
  for (const table of ORDER) {
    const rows = dump[table];
    if (!rows || rows.length === 0) {
      console.log(`${table}: 0 rows, skipping`);
      continue;
    }
    const modelKey = MODEL_KEY[table];
    // @ts-expect-error dynamic model access
    const model = prisma[modelKey];
    const data = rows.map((r) => coerceRow(table, r));
    const result = await model.createMany({ data });
    console.log(`${table}: inserted ${result.count}/${rows.length}`);
  }

  // Reset SERIAL sequences for autoincrement Int id columns so the next insert
  // after this bulk-load doesn't collide with an imported id. Setting.id is a
  // String @id (no sequence), so it's excluded.
  for (const table of ORDER) {
    if (table === "Setting") continue;
    if (!dump[table] || dump[table].length === 0) continue;
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1))`
    );
  }
  console.log("\nSequences reset.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
