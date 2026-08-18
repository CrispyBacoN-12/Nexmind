// scripts/fetch-sp500-membership.mts
// One-off vendoring fetch: downloads fja05680/sp500's point-in-time S&P 500
// membership CSV to disk. Backtests and re-run scripts read only the cached
// file — this is the only place in the membership feature that touches the
// network. Re-run by hand to refresh; nothing else triggers it.
//
// Usage: npx tsx scripts/fetch-sp500-membership.mts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseMembershipCsv, buildMembershipIndex } from "@/lib/backtest/crossSectional/membership";

const URL =
  "https://raw.githubusercontent.com/fja05680/sp500/master/" +
  "S%26P%20500%20Historical%20Components%20%26%20Changes%20(Updated).csv";
const OUT = ".cache/sp500-membership.csv";

const res = await fetch(URL);
if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
const csv = await res.text();

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, csv);
console.log(`wrote ${OUT} (${csv.length} bytes)`);

const snapshots = parseMembershipCsv(csv);
const iso = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
const dayOf = (isoStr: string) => {
  const [y, m, d] = isoStr.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 1000 / 86_400);
};

console.log(`\n${snapshots.length} snapshots, ${iso(snapshots[0].day)} .. ${iso(snapshots[snapshots.length - 1].day)}`);

const isMember = buildMembershipIndex(snapshots);
const spotChecks: [string, string, boolean][] = [
  ["TSLA", "2020-12-04", false],
  ["TSLA", "2020-12-21", true],
  ["ATVI", "2023-10-02", true],
  ["ATVI", "2023-10-20", false],
];
console.log("\n--- spot checks ---");
let allPass = true;
for (const [symbol, date, expected] of spotChecks) {
  const actual = isMember(symbol, dayOf(date));
  const pass = actual === expected;
  if (!pass) allPass = false;
  console.log(`${pass ? "PASS" : "FAIL"}  ${symbol} on ${date}: expected ${expected}, got ${actual}`);
}
if (!allPass) {
  throw new Error("spot check failed — the CSV format may have changed; inspect .cache/sp500-membership.csv by hand");
}
