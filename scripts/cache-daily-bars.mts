// Fetches daily bars for a universe (plus SPY, the regime input) and writes them
// to a disk cache. Sweeps re-run dozens of times; without this they would re-pull
// ~500 symbols per run, which is slow and rate-limit hostile.
//
// Usage: node --env-file=.env --import tsx scripts/cache-daily-bars.mts [universe] [range]
//   universe: dow30 | nasdaq100 | sp500   (default sp500)
//   range:    5y | max                    (default max)
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fetchCandlesBatch } from "@/lib/marketData";
import { UNIVERSES } from "@/lib/trading/universe";
import type { Range } from "@/lib/yahoo";

const REGIME_SYMBOL = "SPY";

const universeKey = process.argv[2] ?? "sp500";
const range = (process.argv[3] ?? "max") as Range;

const universe = UNIVERSES[universeKey];
if (!universe) {
  console.error(`unknown universe "${universeKey}" — expected one of: ${Object.keys(UNIVERSES).join(", ")}`);
  process.exit(1);
}

const symbols = [...new Set([...universe.symbols, REGIME_SYMBOL])];
console.log(`fetching ${symbols.length} symbols, range=${range}, interval=1d ...`);

const started = Date.now();
const fetched = await fetchCandlesBatch(symbols, range, "1d");
console.log(`fetched ${fetched.size}/${symbols.length} symbols in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const bars: Record<string, { t: number; o: number; h: number; l: number; c: number; v: number }[]> = {};
for (const [sym, resp] of fetched) bars[sym] = resp.candles;

// Depth report — the number this task exists to produce.
const counts = Object.values(bars).map((b) => b.length).sort((a, b) => a - b);
const median = counts[Math.floor(counts.length / 2)] ?? 0;
const earliest = Math.min(...Object.values(bars).flatMap((b) => (b.length ? [b[0].t] : [])));
const latest = Math.max(...Object.values(bars).flatMap((b) => (b.length ? [b[b.length - 1].t] : [])));
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

console.log(`\n--- history depth ---`);
console.log(`bars per symbol: min=${counts[0]} median=${median} max=${counts[counts.length - 1]}`);
console.log(`date span: ${iso(earliest)} .. ${iso(latest)}  (~${(median / 252).toFixed(1)} years median)`);
console.log(`SPY bars: ${bars[REGIME_SYMBOL]?.length ?? 0}`);
const missing = symbols.filter((s) => !bars[s]);
if (missing.length) console.log(`missing (${missing.length}): ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? " ..." : ""}`);

const outPath = `.cache/bars/${universeKey}-1d.json`;
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), bars }));
console.log(`\nwrote ${outPath}`);
