// Lightweight cron: sweeps WebullShadowOrder rows still pending/open/filled,
// polls Webull for fill/exit status, and applies updates through the
// monotonicity-guarded update layer. Cheap — a handful of GET calls, not a
// scan. Also invoked as a backstop from the swing-scan cron (see runScan.ts).
// Usage: node --import tsx scripts/poll-webull-shadow-orders.mts
import { prisma } from "@/lib/db";
import { pollOpenShadowOrders } from "../src/lib/webull/pollShadowOrders";

pollOpenShadowOrders()
  .then((summary) => console.log(`webull shadow poll: ${summary.checked} checked, ${summary.updated} updated, ${summary.errors} errors`))
  .catch((e) => { console.error(`FATAL ${String(e)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
