import dns from "node:dns";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";

// This machine's IPv6 route to AWS is broken/blackholed: every connection
// attempt (WebSocket or fetch) tries the IPv6 candidates first, stalls for a
// full 10s connect timeout each, then falls back to IPv4 — surfacing as
// "Connection terminated unexpectedly" or ConnectTimeoutError. Prefer IPv4
// resolution so we hit a working address on the first try.
dns.setDefaultResultOrder("ipv4first");

// Query over HTTPS fetch instead of a held-open WebSocket, since a stateless
// per-request connection has nothing to time out mid-session the way a
// pooled WebSocket does.
neonConfig.poolQueryViaFetch = true;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required (Postgres connection string)");
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
