// Builds .cache/earnings/sp500-8k-item202.json — the date and CLOCK TIME of every
// earnings announcement the S&P 500 names have made, straight from SEC EDGAR.
//
// WHY THIS EXISTS
//
// Every mechanism this project has ever screened is a function of price and
// volume. docs/STATE.md §4g closed the universe axis, §0b closed the entry axis,
// and both name the same remaining move: a NEW DATA CLASS. This is the cheapest
// one available — event TIMING — and it is the only data class the repo can
// acquire without a paid feed or a point-in-time problem.
//
// WHY EDGAR RATHER THAN AN EARNINGS CALENDAR
//
// A vendor's earnings calendar fetched today is RESTATED history: the row says
// what the vendor currently believes the date was, and nothing in the response
// distinguishes a date that was known in 2016 from one corrected in 2024. A
// backtest built on that is reading tomorrow's newspaper about when the news
// broke.
//
// EDGAR does not have that failure mode, because it is not a calendar. It is the
// filing system's own receipt: `acceptanceDateTime` is the moment the document
// arrived on EDGAR's servers, stamped by EDGAR. It is point-in-time by
// construction — there is no later revision of when a file was received.
//
// WHAT AN "EARNINGS ANNOUNCEMENT" IS HERE
//
// Form 8-K carrying **item 2.02**, "Results of Operations and Financial
// Condition" — the press release, not the 10-Q that follows it days later.
// Item 2.02 has existed since August 2004, so it covers every fold this cache is
// built for (FOLDS.fit begins 2016-01-01). It is NOT valid for DEEP1 (2000-2005)
// and this script must not be pointed at that window without re-deriving what
// the pre-2004 8-K item numbering was.
//
// THE FIELD THAT MAKES THIS WORTH FETCHING
//
// `acceptanceDateTime` is UTC with minute precision: AAPL's 2026-07-30 filing is
// 20:30:28Z = 16:30:28 ET, i.e. thirty minutes AFTER the close. That single field
// decides which session reacts to the news, which is the whole content of the
// data class. A calendar giving only a date cannot tell "reported before the open
// on Tuesday" from "reported after the close on Tuesday", and those two are
// different trades one session apart.
//
// COVERAGE THIS CANNOT FIX
//
// The ticker -> CIK map is TODAY's map. A name that left the index and delisted
// is not in it, so this cache inherits exactly the membership survivorship that
// .cache/bars/sp500-1d.json already has — no better, no worse. Do not describe
// the result as survivorship-free.
//
//   npx tsx scripts/cache-earnings-dates.mts
//   npx tsx scripts/cache-earnings-dates.mts --limit=20     # smoke test
//
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { UNIVERSES } from "@/lib/trading/universe";

export const EARNINGS_CACHE_PATH = ".cache/earnings/sp500-8k-item202.json";

/**
 * How far back to keep events. FOLDS.fit opens 2016-01-01 and the panel cache's
 * first bar is 2016-01-04, so a year of slack is enough to cover the engine's
 * warm-up and still let a reaction bar be found for an announcement made just
 * before the fold opens.
 */
const WINDOW_FROM = "2015-01-01";

/** SEC asks for <=10 requests/second and a User-Agent that identifies the caller. */
const CONCURRENCY = 5;
const RETRIES = 3;
const UA = "NEXMIND research script (non-commercial backtest; contact via repository owner)";

/** Below this, the cache is not a sample of the universe and no verdict off it is readable. */
const MIN_SYMBOL_COVERAGE = 0.9;

interface Announcement {
  /** EDGAR's filingDate (calendar date the filing was accepted). */
  d: string;
  /** EDGAR's acceptanceDateTime, UTC, minute precision. The field this cache exists for. */
  t: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      // 404 from data.sec.gov means there is no such submissions file. That is a
      // real answer ("this CIK has no filings here"), not a transient failure,
      // and retrying it three times is just a slow way to return the same thing.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`sec ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(400 * 2 ** attempt);
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

interface RecentBlock {
  form?: string[];
  items?: string[];
  filingDate?: string[];
  acceptanceDateTime?: string[];
}

/** Pull the 8-K/item-2.02 rows out of one submissions block. */
function harvest(recent: RecentBlock | undefined, into: Announcement[]): void {
  if (!recent?.form) return;
  const { form, items = [], filingDate = [], acceptanceDateTime = [] } = recent;
  for (let i = 0; i < form.length; i++) {
    if (form[i] !== "8-K") continue;
    // The `items` string is a comma-separated list like "2.02,9.01". Split it
    // rather than substring-matching: "12.02" does not exist today, but a
    // substring test is the kind of thing that is right until the day it is not.
    if (!(items[i] ?? "").split(",").some((x) => x.trim() === "2.02")) continue;
    const d = filingDate[i];
    const t = acceptanceDateTime[i];
    if (!d || !t || d < WINDOW_FROM) continue;
    into.push({ d, t });
  }
}

/** Every 8-K item 2.02 this CIK has filed since WINDOW_FROM, oldest first. */
async function fetchAnnouncements(cik: string): Promise<Announcement[]> {
  const out: Announcement[] = [];
  const main = (await getJson(`https://data.sec.gov/submissions/CIK${cik}.json`)) as
    | { filings?: { recent?: RecentBlock; files?: { name: string; filingTo?: string }[] } }
    | null;
  if (!main?.filings) return out;

  harvest(main.filings.recent, out);

  // `filings.recent` holds only the most recent ~1000 filings. For a heavy filer
  // that can be fewer than ten years, which would silently truncate FIT. The
  // overflow lives in separate files, and each is fetched when its window
  // reaches into ours.
  for (const f of main.filings.files ?? []) {
    if (f.filingTo && f.filingTo < WINDOW_FROM) continue;
    const extra = (await getJson(`https://data.sec.gov/submissions/${f.name}`)) as RecentBlock | null;
    harvest(extra ?? undefined, out);
  }

  out.sort((a, b) => a.t.localeCompare(b.t));
  return out;
}

async function main() {
  const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);
  let symbols = [...UNIVERSES.sp500.symbols];
  if (limit > 0) symbols = symbols.slice(0, limit);

  console.log(`SEC EDGAR — 8-K item 2.02 (earnings press release) for ${symbols.length} S&P 500 names, ${WINDOW_FROM}..now`);

  console.log("fetching ticker -> CIK map…");
  const raw = (await getJson("https://www.sec.gov/files/company_tickers.json")) as Record<
    string,
    { cik_str: number; ticker: string }
  > | null;
  if (!raw) throw new Error("company_tickers.json returned nothing");

  const cikByTicker = new Map<string, string>();
  for (const row of Object.values(raw)) {
    cikByTicker.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
  }
  console.log(`  ${cikByTicker.size} tickers in the map`);

  // EDGAR writes class shares with a dot (BRK.B); this repo's universe uses a
  // dash (BRK-B), which is the provider convention the bar caches are keyed on.
  // Try the cache's own spelling first so a symbol is never matched to the wrong
  // filer, then the one substitution that is known to differ.
  const lookup = (sym: string) =>
    cikByTicker.get(sym.toUpperCase()) ?? cikByTicker.get(sym.toUpperCase().replace("-", "."));

  const started = Date.now();
  let done = 0;
  const results = await mapWithConcurrency(symbols, CONCURRENCY, async (sym) => {
    const cik = lookup(sym);
    let events: Announcement[] = [];
    let error: string | null = null;
    if (cik) {
      try {
        events = await fetchAnnouncements(cik);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${symbols.length} …`);
    return { sym, cik: cik ?? null, events, error };
  });
  console.log(`fetched in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  // A partial cache would silently change which names carry events, and a name
  // with no events simply never trades — it would look like a rule that fires
  // rarely rather than like missing data. Abort instead.
  const failed = results.filter((r) => r.error);
  if (failed.length) {
    console.error(
      `\nABORTED: ${failed.length} symbol(s) errored after ${RETRIES} attempts.\n  ` +
        failed.slice(0, 20).map((r) => `${r.sym}: ${r.error}`).join("\n  "),
    );
    process.exit(1);
  }

  const noCik = results.filter((r) => !r.cik).map((r) => r.sym);
  const noEvents = results.filter((r) => r.cik && !r.events.length).map((r) => r.sym);
  const covered = results.filter((r) => r.events.length);
  const coverage = covered.length / results.length;

  console.log(`\nCOVERAGE: ${covered.length}/${results.length} symbols carry at least one event (${(100 * coverage).toFixed(1)}%)`);
  if (noCik.length) console.log(`  no CIK in EDGAR's map (${noCik.length}): ${noCik.slice(0, 30).join(", ")}`);
  if (noEvents.length) console.log(`  CIK found but no 8-K item 2.02 (${noEvents.length}): ${noEvents.slice(0, 30).join(", ")}`);
  if (coverage < MIN_SYMBOL_COVERAGE) {
    console.error(`\nABORTED: coverage below the ${(100 * MIN_SYMBOL_COVERAGE).toFixed(0)}% bar. Nothing was written.`);
    process.exit(1);
  }

  const events: Record<string, Announcement[]> = {};
  let total = 0;
  for (const r of covered) {
    events[r.sym] = r.events;
    total += r.events.length;
  }

  // Rate report. Four a year is what a US issuer files; anything far from it
  // means item 2.02 is not being caught, and the screen's own COVERAGE CHECK
  // re-asserts this against the fold windows rather than against the raw span.
  const spanYears = (Date.now() - Date.parse(`${WINDOW_FROM}T00:00:00Z`)) / (365.25 * 24 * 3600 * 1000);
  const perYear = covered.map((r) => r.events.length / spanYears).sort((a, b) => a - b);
  const median = perYear[Math.floor(perYear.length / 2)];
  console.log(`EVENTS: ${total} announcements, median ${median.toFixed(2)} per symbol per year over ${spanYears.toFixed(1)}y`);

  const payload = {
    source: "SEC EDGAR submissions API — form 8-K carrying item 2.02 (Results of Operations)",
    note: "acceptanceDateTime is UTC and is EDGAR's own receipt timestamp: point-in-time by construction.",
    fetchedAt: new Date().toISOString(),
    windowFrom: WINDOW_FROM,
    symbols: Object.keys(events).length,
    announcements: total,
    events,
  };
  await mkdir(dirname(EARNINGS_CACHE_PATH), { recursive: true });
  await writeFile(EARNINGS_CACHE_PATH, JSON.stringify(payload));
  console.log(`\nwrote ${EARNINGS_CACHE_PATH}`);
}

await main();
