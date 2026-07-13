// Runs the new src/lib/trading/screener.ts against the real S&P 500 universe
// to see how large a shortlist the default liquidity/volatility criteria
// produce, and spot-check a few pass/fail reasons.
// Usage: npx tsx scripts/screen-sp500.ts
import { screenUniverse, DEFAULT_SCREEN_CRITERIA } from "../src/lib/trading/screener";
import { UNIVERSES } from "../src/lib/trading/universe";

async function main() {
  const symbols = UNIVERSES["sp500"].symbols;
  console.log(`Screening ${symbols.length} sp500 symbols with criteria:`, DEFAULT_SCREEN_CRITERIA);
  const results = await screenUniverse(symbols);

  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);
  console.log(`\nPassed: ${passed.length} / ${results.length}`);

  console.log(`\nTop 20 by dollar volume:`);
  for (const r of passed.slice(0, 20)) {
    console.log(`  ${r.symbol.padEnd(6)} price=$${r.price!.toFixed(2).padStart(8)} $vol=${(r.avgDollarVolume! / 1e6).toFixed(0).padStart(5)}M atr%=${r.atrPct!.toFixed(2).padStart(5)} adx=${r.adx?.toFixed(0) ?? "-"}`);
  }

  const reasonCounts = new Map<string, number>();
  for (const r of failed) {
    const key = r.reason?.split(" ").slice(0, 2).join(" ") ?? "unknown";
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
  }
  console.log(`\nFailure reasons (grouped):`);
  for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }

  console.log(`\nSample failures:`);
  for (const r of failed.slice(0, 8)) {
    console.log(`  ${r.symbol}: ${r.reason}`);
  }
}
main().then(() => process.exit(0));
