// One-time: dump every row from the local dev.db (SQLite) into a single JSON file,
// ahead of the Postgres/Vercel migration. Reads the raw SQLite file directly with
// better-sqlite3 (not through Prisma) so it works regardless of what provider
// prisma/schema.prisma currently points at. Run with:
//   npx tsx scripts/export-sqlite-data.mts [path-to-dev.db] [output.json]
import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";

const TABLES = [
  "Agent", "Pipeline", "PipelineStep", "NewsItem", "Lesson", "Report",
  "BuildJob", "Setting", "Portfolio", "Signal", "Trade", "Watchlist",
  "Holding", "OptionHolding", "ResearchRun", "ResearchStrategy",
];

const dbPath = process.argv[2] ?? "dev.db";
const outPath = process.argv[3] ?? "scripts/sqlite-export.json";

const db = new Database(dbPath, { readonly: true });

const dump: Record<string, unknown[]> = {};
for (const table of TABLES) {
  const exists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table);
  if (!exists) {
    console.warn(`skip ${table}: table not found in ${dbPath}`);
    continue;
  }
  const rows = db.prepare(`SELECT * FROM "${table}"`).all();
  dump[table] = rows;
  console.log(`${table}: ${rows.length} rows`);
}

writeFileSync(outPath, JSON.stringify(dump, null, 2));
console.log(`\nWrote ${outPath}`);
