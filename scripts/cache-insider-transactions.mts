// Builds .cache/insider/sp500-form4-ps.json — every open-market insider
// purchase (P) or sale (S) an S&P 500 officer, director, or 10%-owner has
// reported on Form 4, straight from SEC's bulk Insider Transactions Data
// Sets.
//
// WHY THIS EXISTS
//
// docs/STATE.md's entry-lateness and exit-geometry findings both close on
// price/volume alone: nexmind-entry-is-late and the weekly deep holdout
// leave a new DATA CLASS as the only untried axis. cache-earnings-dates.mts
// was the first attempt (event timing) and was itself a null result
// (nexmind-earnings-timing-not-an-entry). This is the second: what an
// insider actually did, not when a scheduled report landed.
//
// WHY BULK QUARTERLY ZIPS RATHER THAN THE PER-CIK SUBMISSIONS API
//
// cache-earnings-dates.mts hits data.sec.gov/submissions/CIK{...}.json once
// per symbol because the one field that script needs (acceptanceDateTime)
// lives directly in that filing index. Form 4's economic content — trans
// code, shares, price — is NOT in the index; it lives inside each filing's
// own XML body, which would mean one fetch per filing: tens of thousands
// across 490 symbols x 11 years, against SEC's 10 req/s fair-access limit.
// SEC separately publishes the same data pre-parsed into flat TSV files,
// one ZIP per calendar quarter, at
// https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets
// — roughly 45 fetches instead of tens of thousands.
//
// WHAT COUNTS AS AN INSIDER TRANSACTION HERE
//
// Only TRANS_CODE 'P' (open-market/private purchase) and 'S' (open-market/
// private sale) from the NONDERIV_TRANS table. Every other code — A grants,
// F tax withholding, M/X/O option exercises, G gifts, C conversions, D
// dispositions-to-issuer, and the rest of the Trans Code List — is a
// transaction the insider did not choose the timing of in the sense that
// matters for a signal. P/S is the subset where real cash moved and the
// insider picked when.
//
// THE FIELD THAT MAKES THIS POINT-IN-TIME BY CONSTRUCTION
//
// SUBMISSION.FILING_DATE is the calendar date EDGAR accepted the Form 4 —
// the same "receipt stamp" property cache-earnings-dates.mts already trusts
// in acceptanceDateTime, at day rather than minute precision (the bulk data
// set does not carry the intraday timestamp; only the per-filing index
// does, at the one-fetch-per-filing cost above). Every transaction also
// carries its own TRANS_TIMELINESS ('E' early, 'L' late, blank on-time), so
// a late filing — a stale point-in-time signal by the time it posts — can
// be excluded by a mechanism instead of trusted blind.
//
// WHO MADE THE TRADE
//
// REPORTINGOWNER.RPTOWNER_RELATIONSHIP ('Officer', 'Director',
// 'TenPercentOwner', and combinations) is joined in per accession number so
// a mechanism can tell a CFO's purchase from a passive fund's index
// rebalancing — the same distinction the P/S filter itself exists to draw,
// one level deeper. A joint filing can list more than one owner under one
// accession; ROLES is the deduplicated union across all of them, TITLE is
// the first non-empty RPTOWNER_TITLE seen.
//
// COVERAGE THIS CANNOT FIX
//
// Same survivorship note as cache-earnings-dates.mts: ISSUERTRADINGSYMBOL
// is matched against TODAY's S&P 500 list, applied retroactively. A name
// that IPO'd, spun off, or was renamed after a given quarter shows zero
// events before that date — not a defect in this data, the same reality
// the price/bar panel already lives with for the same symbols.
//
// QUARTER WINDOW
//
// Starts 2015q1 — a year of slack before FOLDS.fit opens 2016-01-01, the
// same margin cache-earnings-dates.mts keeps for its own warm-up/reaction-
// bar lookback. SEC publishes each quarter's data set some weeks to months
// after the quarter closes, so the most recent one or two quarters in the
// requested window may not exist yet: that is treated as "not yet
// published", not a fetch error, but ONLY at the tail of the window — a
// missing quarter followed by a quarter that DOES exist is a real error and
// aborts the run.
//
//   npx tsx scripts/cache-insider-transactions.mts
//   npx tsx scripts/cache-insider-transactions.mts --from=2024q1   # smoke test, fewer quarters
//
import AdmZip from "adm-zip";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { UNIVERSES } from "@/lib/trading/universe";

export const INSIDER_CACHE_PATH = ".cache/insider/sp500-form4-ps.json";

const WINDOW_FROM_QUARTER: Quarter = { year: 2015, q: 1 };

/** SEC asks for <=10 requests/second and a User-Agent that identifies the caller. */
const RETRIES = 3;
const UA = "NEXMIND research script (non-commercial backtest; contact via repository owner)";

/** Below this, the cache is not a sample of the universe and no verdict off it is readable. */
const MIN_SYMBOL_COVERAGE = 0.9;

const TRANS_CODES = new Set(["P", "S"]);

interface InsiderEvent {
  /** SUBMISSION.FILING_DATE, ISO. The point-in-time anchor. */
  d: string;
  /** NONDERIV_TRANS.TRANS_DATE, ISO. The date the trade itself happened, not when it posted. */
  td: string;
  code: "P" | "S";
  shares: number;
  price: number;
  /** '' = on time, 'E' = early, 'L' = late. */
  timeliness: "" | "E" | "L";
  roles: string[];
  title: string | null;
}

interface Quarter {
  year: number;
  q: 1 | 2 | 3 | 4;
}

function quarterLabel(quarter: Quarter): string {
  return `${quarter.year}q${quarter.q}`;
}

/** Every quarter from WINDOW_FROM_QUARTER through the current calendar quarter, oldest first. */
function enumerateQuarters(from: Quarter): Quarter[] {
  const now = new Date();
  const currentQuarter: Quarter = { year: now.getUTCFullYear(), q: (Math.floor(now.getUTCMonth() / 3) + 1) as Quarter["q"] };
  const out: Quarter[] = [];
  let year = from.year;
  let q = from.q;
  while (year < currentQuarter.year || (year === currentQuarter.year && q <= currentQuarter.q)) {
    out.push({ year, q: q as Quarter["q"] });
    q++;
    if (q > 4) {
      q = 1;
      year++;
    }
  }
  return out;
}

/** SEC's bulk TSVs date field, e.g. "31-MAR-2016" -> "2016-03-31". */
const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};
function toIso(ddMonYyyy: string): string | null {
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(ddMonYyyy.trim());
  if (!m) return null;
  const mm = MONTHS[m[2]];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1]}`;
}

/** SEC's bulk TSVs have no quoting and no embedded tabs/newlines in-field. */
function parseTsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split("\n");
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const header = lines[0].split("\t");
  const rows = lines.slice(1).map((l) => l.split("\t"));
  return { header, rows };
}

function colIndex(header: string[], name: string): number {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`column ${name} not found (have: ${header.join(", ")})`);
  return i;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetches one quarterly ZIP. Returns null on 404 (not published), throws on any other failure. */
async function fetchQuarterZip(quarter: Quarter): Promise<Buffer | null> {
  const url = `https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/${quarterLabel(quarter)}_form345.zip`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`sec ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await sleep(800 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Every panel-symbol P/S event this one quarter's ZIP carries. */
function extractQuarterEvents(zipBuf: Buffer, symbolSet: Set<string>): Map<string, InsiderEvent[]> {
  const zip = new AdmZip(zipBuf);
  const submissionEntry = zip.getEntry("SUBMISSION.tsv");
  const nonderivEntry = zip.getEntry("NONDERIV_TRANS.tsv");
  const ownerEntry = zip.getEntry("REPORTINGOWNER.tsv");
  if (!submissionEntry || !nonderivEntry || !ownerEntry) {
    throw new Error("zip is missing one of SUBMISSION.tsv / NONDERIV_TRANS.tsv / REPORTINGOWNER.tsv");
  }

  const sub = parseTsv(submissionEntry.getData().toString("utf8"));
  const subAccIdx = colIndex(sub.header, "ACCESSION_NUMBER");
  const subDateIdx = colIndex(sub.header, "FILING_DATE");
  const subSymIdx = colIndex(sub.header, "ISSUERTRADINGSYMBOL");

  // accession -> {filingDate, symbol}, restricted up front to accessions that
  // belong to a symbol we track — every later join is against this map, so
  // rows for the other ~4,500 issuers per quarter never get parsed further.
  const bySymbol = new Map<string, { filingDate: string; symbol: string }>();
  for (const row of sub.rows) {
    const symbolRaw = row[subSymIdx]?.trim().toUpperCase();
    if (!symbolRaw || !symbolSet.has(symbolRaw)) continue;
    const filingDate = toIso(row[subDateIdx] ?? "");
    if (!filingDate) continue;
    bySymbol.set(row[subAccIdx], { filingDate, symbol: symbolRaw });
  }
  if (bySymbol.size === 0) return new Map();

  const own = parseTsv(ownerEntry.getData().toString("utf8"));
  const ownAccIdx = colIndex(own.header, "ACCESSION_NUMBER");
  const ownRelIdx = colIndex(own.header, "RPTOWNER_RELATIONSHIP");
  const ownTitleIdx = colIndex(own.header, "RPTOWNER_TITLE");

  const rolesByAccession = new Map<string, { roles: Set<string>; title: string | null }>();
  for (const row of own.rows) {
    const acc = row[ownAccIdx];
    if (!bySymbol.has(acc)) continue;
    let entry = rolesByAccession.get(acc);
    if (!entry) {
      entry = { roles: new Set(), title: null };
      rolesByAccession.set(acc, entry);
    }
    for (const r of (row[ownRelIdx] ?? "").split(",")) {
      const trimmed = r.trim();
      if (trimmed) entry.roles.add(trimmed);
    }
    if (!entry.title && (row[ownTitleIdx] ?? "").trim()) entry.title = row[ownTitleIdx].trim();
  }

  const nd = parseTsv(nonderivEntry.getData().toString("utf8"));
  const ndAccIdx = colIndex(nd.header, "ACCESSION_NUMBER");
  const ndCodeIdx = colIndex(nd.header, "TRANS_CODE");
  const ndDateIdx = colIndex(nd.header, "TRANS_DATE");
  const ndSharesIdx = colIndex(nd.header, "TRANS_SHARES");
  const ndPriceIdx = colIndex(nd.header, "TRANS_PRICEPERSHARE");
  const ndTimelyIdx = colIndex(nd.header, "TRANS_TIMELINESS");

  const out = new Map<string, InsiderEvent[]>();
  for (const row of nd.rows) {
    const code = row[ndCodeIdx];
    if (!TRANS_CODES.has(code)) continue;
    const acc = row[ndAccIdx];
    const filer = bySymbol.get(acc);
    if (!filer) continue;
    const tradeDate = toIso(row[ndDateIdx] ?? "");
    const shares = Number(row[ndSharesIdx]);
    const price = Number(row[ndPriceIdx]);
    if (!tradeDate || !Number.isFinite(shares) || !Number.isFinite(price)) continue;
    const timeliness = (row[ndTimelyIdx] ?? "").trim();
    const role = rolesByAccession.get(acc);
    const event: InsiderEvent = {
      d: filer.filingDate,
      td: tradeDate,
      code: code as "P" | "S",
      shares,
      price,
      timeliness: timeliness === "E" || timeliness === "L" ? timeliness : "",
      roles: role ? [...role.roles].sort() : [],
      title: role?.title ?? null,
    };
    const list = out.get(filer.symbol);
    if (list) list.push(event);
    else out.set(filer.symbol, [event]);
  }
  return out;
}

async function main() {
  const fromArg = process.argv.find((a) => a.startsWith("--from="))?.split("=")[1];
  let from = WINDOW_FROM_QUARTER;
  if (fromArg) {
    const m = /^(\d{4})q([1-4])$/.exec(fromArg);
    if (!m) throw new Error(`--from must look like 2024q1, got ${fromArg}`);
    from = { year: Number(m[1]), q: Number(m[2]) as Quarter["q"] };
  }

  const symbols = [...UNIVERSES.sp500.symbols];
  const symbolSet = new Set(symbols.map((s) => s.toUpperCase()));
  const quarters = enumerateQuarters(from);

  console.log(`SEC bulk Insider Transactions Data Sets — TRANS_CODE P/S for ${symbols.length} S&P 500 names`);
  console.log(`quarters: ${quarterLabel(quarters[0])}..${quarterLabel(quarters[quarters.length - 1])} (${quarters.length} total)\n`);

  const eventsBySymbol = new Map<string, InsiderEvent[]>();
  const notPublished: string[] = [];
  let sawGap = false;

  for (const quarter of quarters) {
    const label = quarterLabel(quarter);
    const zipBuf = await fetchQuarterZip(quarter);
    if (!zipBuf) {
      notPublished.push(label);
      console.log(`  ${label}: not yet published, skipping`);
      continue;
    }
    if (notPublished.length && !sawGap) {
      // A quarter fetched fine AFTER one or more 404s means those 404s were
      // a hole in the middle of history, not the publication frontier.
      sawGap = true;
    }
    const perSymbol = extractQuarterEvents(zipBuf, symbolSet);
    let quarterTotal = 0;
    for (const [sym, events] of perSymbol) {
      quarterTotal += events.length;
      const list = eventsBySymbol.get(sym);
      if (list) list.push(...events);
      else eventsBySymbol.set(sym, events);
    }
    console.log(`  ${label}: ${quarterTotal} P/S events across ${perSymbol.size} symbols`);
  }

  if (sawGap) {
    console.error(
      `\nABORTED: quarter(s) [${notPublished.join(", ")}] returned 404 but a LATER quarter fetched ` +
        `successfully — that is a hole in published history, not the publication frontier. Nothing was written.`,
    );
    process.exit(1);
  }

  for (const events of eventsBySymbol.values()) events.sort((a, b) => a.d.localeCompare(b.d));

  const covered = symbols.filter((s) => eventsBySymbol.has(s.toUpperCase()));
  const coverage = covered.length / symbols.length;
  console.log(`\nCOVERAGE: ${covered.length}/${symbols.length} symbols carry at least one P/S event (${(100 * coverage).toFixed(1)}%)`);
  if (coverage < MIN_SYMBOL_COVERAGE) {
    const missing = symbols.filter((s) => !eventsBySymbol.has(s.toUpperCase()));
    console.error(
      `\nABORTED: coverage below the ${(100 * MIN_SYMBOL_COVERAGE).toFixed(0)}% bar. ` +
        `missing (${missing.length}): ${missing.slice(0, 30).join(", ")}\nNothing was written.`,
    );
    process.exit(1);
  }

  const events: Record<string, InsiderEvent[]> = {};
  let total = 0;
  for (const [sym, list] of eventsBySymbol) {
    events[sym] = list;
    total += list.length;
  }

  const late = Object.values(events).flat().filter((e) => e.timeliness === "L").length;
  console.log(`EVENTS: ${total} P/S transactions (${late} filed late, ${((100 * late) / total).toFixed(1)}%)`);

  const payload = {
    source: "SEC bulk Insider Transactions Data Sets (Form 3/4/5), TRANS_CODE P/S from NONDERIV_TRANS",
    note: "FILING_DATE is EDGAR's own receipt date: point-in-time by construction. TRANS_DATE is the trade date, not the point-in-time anchor.",
    fetchedAt: new Date().toISOString(),
    quartersFrom: quarterLabel(quarters[0]),
    quartersThrough: quarterLabel(quarters[quarters.length - 1]),
    notPublished,
    symbols: Object.keys(events).length,
    events: total,
    data: events,
  };
  await mkdir(dirname(INSIDER_CACHE_PATH), { recursive: true });
  await writeFile(INSIDER_CACHE_PATH, JSON.stringify(payload));
  console.log(`\nwrote ${INSIDER_CACHE_PATH}`);
}

await main();
