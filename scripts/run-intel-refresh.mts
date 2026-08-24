// Driver for the SCOUT live-intel refresh: pulls Finnhub news + the Fear & Greed
// index directly (no running Next.js server required — refreshFinnhubNews/
// refreshFearGreed are plain functions, same ones /api/intel/refresh calls).
// Usage: npx tsx scripts/run-intel-refresh.mts

import "dotenv/config";
import { refreshFinnhubNews, refreshFearGreed } from "../src/lib/intel/news";
import { prisma } from "../src/lib/db";

async function main() {
  const [news, fearGreed] = await Promise.all([refreshFinnhubNews(), refreshFearGreed()]);
  console.log(`news: inserted=${news.inserted} skipped=${news.skipped}${news.error ? ` error=${news.error}` : ""}`);
  console.log(`fearGreed: ${fearGreed ? `${fearGreed.value} (${fearGreed.label})` : "unavailable"}`);
  await prisma.$disconnect();
}

main();
