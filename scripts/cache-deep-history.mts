// Builds .cache/bars/sp500-1d-deep.json — the pre-2016 half of the S&P 500's
// daily history, which this project has never had and never paid for.
//
// WHY THERE IS A SECOND CACHE BUILDER
//
// scripts/cache-daily-bars.mts goes through fetchCandlesBatch, which routes
// Alpaca -> Webull -> Yahoo and only reaches Yahoo when a provider ERRORS.
// Alpaca does not error; its equity data simply begins on 2016-01-04, and it
// answers a `max` request with everything it has. So every symbol in the main
// cache starts on the same day, that day is Alpaca's inception rather than the
// stock's, and Yahoo — which serves the same names back to the 1990s — has never
// been asked. The 2016 floor is a routing artifact. This script asks Yahoo
// directly for the years underneath it.
//
// It writes a SEPARATE file and never touches sp500-1d.json. The folds over the
// two caches are different windows with different provenance, and a spliced file
// would make "which data produced this number" unanswerable from the number.
//
// THE TRAP THIS SCRIPT EXISTS TO AVOID
//
// Yahoo's chart endpoint treats `interval` as a request and `range` as the thing
// it actually honours. Ask for `range=max&interval=1d` — which is what
// fetchYahooCandles would send — and it silently returns weekly, monthly or
// quarterly bars: AAPL comes back with 169 bars for 42 years, NVDA with 333.
// The bars are real, correctly adjusted session aggregates, so sanitizeSeries
// cannot reject them and a panel built on them would run all the way to a
// verdict. Explicit period1/period2 epoch seconds get honest daily bars (AAPL:
// 4,048 for 1999-2016). Every series is checked with isDailySeries before
// anything is written, and a single failure aborts the whole run rather than
// writing a file that is 99% right.
//
// Adjustment: parseYahooChart multiplies every OHLC field by adjclose/close, so
// these bars are split- AND dividend-adjusted — the same basis as Alpaca's
// `adjustment=all` in the main cache. marketData.ts records that the two
// providers agree to the cent on their two-year overlap.
//
//   npx tsx scripts/cache-deep-history.mts
//   npx tsx scripts/cache-deep-history.mts --limit=20     # smoke test
//
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseYahooChart } from "@/lib/yahoo";
import { isDailySeries, medianBarSpacingDays, sanitizeSeries } from "@/lib/bars";
import { UNIVERSES } from "@/lib/trading/universe";
import { DEEP_CACHE_START, DEEP_FOLD_LIST, DEEP_PANEL_CACHE_PATH } from "@/lib/research/panel";
import type { Candle } from "@/lib/indicators";

const REGIME_SYMBOL = "SPY";

/** Where the deep cache stops: the first bar the MAIN cache already has. */
const DEEP_CACHE_END = "2016-01-05";

const CONCURRENCY = 4;
const RETRIES = 3;

const epoch = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One symbol's daily bars over an explicit epoch window.
 *
 * Deliberately NOT fetchYahooCandles: that helper sends `range=`, which is the
 * downgrade trap in the header. Everything else — the headers, and
 * parseYahooChart for the adjustment — is the shared path.
 */
async function fetchDeepDaily(symbol: string): Promise<Candle[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${epoch(DEEP_CACHE_START)}&period2=${epoch(DEEP_CACHE_END)}` +
    `&interval=1d&includeAdjustedClose=true`;

  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        // Two of Yahoo's failures mean "there is nothing here", and retrying
        // either one forever would be the same as a hang. They are told apart by
        // the body, not the status, and the difference matters to the caller:
        //
        //   404 Not Found   — no such ticker (verified: ZZZZNOTREAL)
        //   400 Bad Request "Data doesn't exist for startDate = …"
        //                   — the ticker is real but listed AFTER this window.
        //                     ABNB (IPO 2020) is the worked example; ~14 of every
        //                     50 S&P names listed after 2000, so this is the
        //                     COMMON case, not an edge one.
        //
        // Anything else — 429, 5xx, a body that does not parse — is transient
        // and goes back through the backoff.
        const body = await res.text().catch(() => "");
        const code = (() => {
          try {
            return (JSON.parse(body) as { chart?: { error?: { code?: string } } }).chart?.error?.code ?? null;
          } catch {
            return null;
          }
        })();
        if (code === "Not Found" || code === "Bad Request") return [];
        throw new Error(`yahoo ${res.status}${code ? ` ${code}` : ""}`);
      }
      return parseYahooChart(await res.json(), symbol, "max", "1d").candles;
    } catch (e) {
      lastErr = e;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function main() {
  const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);
  // REGIME_SYMBOL is kept across --limit deliberately: it is appended last, so a
  // plain slice would drop it and the smoke test would build a deep cache with
  // zero SPY bars — the one symbol every fold needs for its regime filter.
  let symbols = [...new Set([...UNIVERSES.sp500.symbols, REGIME_SYMBOL])];
  if (limit > 0) symbols = [...new Set([...symbols.slice(0, limit), REGIME_SYMBOL])];

  console.log(
    `fetching ${symbols.length} symbols from Yahoo, ${DEEP_CACHE_START}..${DEEP_CACHE_END}, interval=1d ` +
      `(explicit period1/period2 — never range=)`,
  );
  const started = Date.now();

  let done = 0;
  const results = await mapWithConcurrency(symbols, CONCURRENCY, async (sym) => {
    let candles: Candle[] = [];
    let error: string | null = null;
    try {
      candles = await fetchDeepDaily(sym);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${symbols.length} …`);
    return { sym, candles, error };
  });

  console.log(`fetched in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  // THE GUARD. Checked before a single byte is written, on the raw series, and
  // fatal rather than skip-and-continue: a downgraded series is not a missing
  // symbol, it is a wrong one, and a cache that is 99% daily bars produces a
  // verdict that is 100% unreadable.
  // A 1-bar series cannot HAVE a spacing, so isDailySeries returns false for a
  // reason that is not a downgrade and it is reported separately below — but it
  // must not fall through the gap between the two checks and reach the cache
  // unexamined, which is what a bare `length >= 2` filter here used to allow.
  const downgraded = results
    .filter((r) => r.candles.length >= 2 && !isDailySeries(r.candles))
    .map((r) => `${r.sym} (${r.candles.length} bars, median spacing ${medianBarSpacingDays(r.candles)}d)`);
  if (downgraded.length) {
    console.error(
      `\nABORTED: Yahoo served non-daily bars for ${downgraded.length} symbol(s) despite interval=1d.\n` +
        `Nothing was written. See the header of this script.\n  ` +
        downgraded.slice(0, 20).join("\n  "),
    );
    process.exit(1);
  }

  const bars: Record<string, Candle[]> = {};
  for (const r of results) if (r.candles.length >= 2) bars[r.sym] = r.candles;

  const failed = results.filter((r) => r.error);
  // Empty and single-bar together: one bar is what a wrong or delisted ticker
  // returns, it is unverifiable as daily, and bars.test.ts pins that the builder
  // must not write it as though it had been checked.
  const empty = results.filter((r) => !r.error && r.candles.length < 2);
  if (failed.length) {
    console.error(
      `\nABORTED: ${failed.length} symbol(s) errored after ${RETRIES} attempts — a partial cache would silently ` +
        `change which names participate in a fold.\n  ` +
        failed.slice(0, 20).map((r) => `${r.sym}: ${r.error}`).join("\n  "),
    );
    process.exit(1);
  }

  // Depth report. Printed against the folds this cache exists to serve, because
  // "4,000 bars" says nothing about whether deep1 has anything in it.
  const counts = Object.values(bars).map((b) => b.length).sort((a, b) => a - b);
  const times = Object.values(bars).flatMap((b) => (b.length ? [b[0].t, b[b.length - 1].t] : []));
  console.log(`\n--- history depth ---`);
  console.log(`symbols with data: ${counts.length}/${symbols.length}` + (empty.length ? `  (no data: ${empty.map((r) => r.sym).join(", ")})` : ""));
  console.log(`bars per symbol: min=${counts[0]} median=${counts[counts.length >> 1]} max=${counts[counts.length - 1]}`);
  console.log(`date span: ${iso(Math.min(...times))} .. ${iso(Math.max(...times))}`);
  console.log(`SPY bars: ${bars[REGIME_SYMBOL]?.length ?? 0}`);

  // Placeholder count, reported not applied: loadPanel runs sanitizeSeries on
  // every read, so filtering here as well would hide from the panel how much of
  // this cache is filler.
  let placeholders = 0;
  for (const b of Object.values(bars)) placeholders += sanitizeSeries(b).dropped;
  console.log(`placeholder bars present (dropped on load, not here): ${placeholders}`);

  for (const fold of DEEP_FOLD_LIST) {
    const from = epoch(fold.from), to = epoch(fold.to);
    let participating = 0;
    for (const b of Object.values(bars)) if (b.some((x) => x.t >= from && x.t < to)) participating++;
    console.log(`  ${fold.name} ${fold.from}..${fold.to}: ${participating} symbols have bars`);
  }

  await mkdir(dirname(DEEP_PANEL_CACHE_PATH), { recursive: true });
  await writeFile(DEEP_PANEL_CACHE_PATH, JSON.stringify({ fetchedAt: new Date().toISOString(), bars }));
  console.log(`\nwrote ${DEEP_PANEL_CACHE_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
