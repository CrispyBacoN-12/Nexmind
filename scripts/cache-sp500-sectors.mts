// Finnhub industry for every name in the deep panel, cached once for Test B.
//
// Test B's SECTOR gate needs a sector per name, and the portfolio module maps
// finnhubIndustry -> GICS with resolveGicsSector. This fetches the raw industry
// through the same fetchFundamentals the /advisor gate uses, so the simulator
// and the live gate read one classification. It is TODAY's classification, a
// limitation stated in docs/quant/PRE_REGISTRATION_TEST_B.md §8.
//
// Resumable: a name already cached without an error note is not refetched.
// Throttled to stay under Finnhub's free 60 calls/min (two calls per name).
//
//   node --env-file=.env --import tsx scripts/cache-sp500-sectors.mts

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

import { fetchFundamentals } from "@/lib/market/fundamentals";
import { DEEP_PANEL_CACHE_PATH, loadPanel } from "@/lib/research/panel";

export const SECTOR_CACHE_PATH = ".cache/sectors/sp500-deep-finnhub-industry.json";

interface Entry {
  industry: string | null;
  note: string | null;
  fetchedAt: string;
}

const PER_SYMBOL_MS = 2200;
const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const failed = (e: Entry | undefined) => !e || (e.note != null && /HTTP|error|fetch|not set/i.test(e.note));

async function main() {
  const panel = loadPanel(DEEP_PANEL_CACHE_PATH);
  const symbols = panel.symbols.filter((s) => s !== "SPY");
  const cache: Record<string, Entry> = existsSync(SECTOR_CACHE_PATH) ? JSON.parse(readFileSync(SECTOR_CACHE_PATH, "utf8")) : {};
  mkdirSync(dirname(SECTOR_CACHE_PATH), { recursive: true });

  const todo = symbols.filter((s) => failed(cache[s]));
  console.log(`${symbols.length} names, ${symbols.length - todo.length} cached, ${todo.length} to fetch`);

  for (const [i, sym] of todo.entries()) {
    let entry: Entry | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const t0 = Date.now();
      try {
        const f = await fetchFundamentals(sym);
        entry = { industry: f.industry, note: f.note ?? null, fetchedAt: new Date().toISOString() };
      } catch (e) {
        entry = { industry: null, note: `error: ${e instanceof Error ? e.message : String(e)}`, fetchedAt: new Date().toISOString() };
      }
      await sleep(Math.max(0, PER_SYMBOL_MS - (Date.now() - t0)));
      if (!failed(entry)) break;
      await sleep(15_000 * attempt); // back off on a 429
    }
    cache[sym] = entry!;
    writeFileSync(SECTOR_CACHE_PATH, JSON.stringify(cache, null, 1));
    console.log(`${String(i + 1).padStart(3)}/${todo.length} ${sym.padEnd(6)} ${entry!.industry ?? "—"}${entry!.note ? `  (${entry!.note})` : ""}`);
  }

  const stillFailed = symbols.filter((s) => failed(cache[s]));
  console.log(`done: ${symbols.length - stillFailed.length}/${symbols.length} ok${stillFailed.length ? `; failed: ${stillFailed.join(" ")}` : ""}`);
}

await main();
