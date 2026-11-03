// One-off 3-year replay of the chart agent's long-sweep rule (scorecard agent #4,
// spec §7): rank the S&P 500 as the live scan would have at 10:30 ET each session,
// run the live setup pipeline on the top 20, score every setup as if bought, and
// judge it against random entries. Writes ScorecardSnapshot kind "replay" for the
// current CHART_RULE_VERSION. Never writes ChartSetup.
//
// Usage: node --env-file=.env --import tsx scripts/scorecard-replay.mts [--force] [--allow-missing]
//   --force          overwrite an existing replay snapshot for this rule version
//   --allow-missing  replay even if some tickers lack bars; the summary lists them
//
// Bars are cached per ticker under .cache/scorecard/:
//   <TICKER>.5m.json      adjusted 5-minute bars (setups and scoring)
//   <TICKER>.1d.json      adjusted daily bars (gap, ATR, setups)
//   <TICKER>.1d.raw.json  as-traded daily bars (the scan's price/volume floors)
// Each file stores the start/end it was fetched for. A cached file is never refetched
// while that range covers what the period needs; one that does not is refetched.
// The period comes from the cached SPY daily bars (SPY.1d.json), so a rerun replays
// the same period; delete that file to move it. Only 04:00-16:00 ET 5-minute bars
// are kept: nothing in the replay reads after-hours bars.
//
// The verdict is written once, so the script refuses to replay a partial universe:
// if any ticker still lacks any of its three files after fetching, it prints them
// and stops, unless --allow-missing is passed.

import { mkdir, open, readFile, rename, writeFile, stat } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { fetchAlpacaRange, SIP_DELAY_MS } from "@/lib/alpaca";
import type { Candle } from "@/lib/indicators";
import { UNIVERSES } from "@/lib/trading/universe";
import { etClock, etSessionCloseMs } from "@/lib/scanAgent/session";
import { CHART_RULE_VERSION } from "@/lib/chartAgent/types";
import { runReplay } from "@/lib/scorecard/replay";

const CACHE_DIR = ".cache/scorecard";
const YEARS = 3;
const INTRADAY_PAD_DAYS = 25; // prior sessions + rvol baseline
const DAILY_PAD_DAYS = 60; // ATR14 window + 10-day averages
const FETCH_WORKERS = 3;
const KEEP_FROM_MIN = 4 * 60; // 04:00 ET
const KEEP_TO_MIN = 16 * 60; // 16:00 ET
const REGULAR_FROM_MIN = 9 * 60 + 30; // 09:30 ET

const force = process.argv.includes("--force");
const allowMissing = process.argv.includes("--allow-missing");
const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 60_000).toFixed(1)} min`;

type Kind = "5m" | "1d" | "1d.raw";
type Row = [number, number, number, number, number, number];
/** `start`/`end` first, so the coverage check can read them from the file's head. */
interface CacheFile {
  start: string;
  end: string;
  fetchedAt: string;
  bars: Row[];
}
interface Range {
  start: string;
  end: string;
}

const pathFor = (ticker: string, kind: Kind) => `${CACHE_DIR}/${ticker}.${kind}.json`;
const exists = (p: string) => stat(p).then(() => true, () => false);

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Atomic: a crash mid-write leaves no truncated file behind. */
async function writeCache(path: string, file: CacheFile): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(file));
  await rename(tmp, path);
}

async function readCache(path: string): Promise<CacheFile | null> {
  if (!(await exists(path))) return null;
  return JSON.parse(await readFile(path, "utf8")) as CacheFile;
}

/** The range a cache file was fetched for, read from its first bytes (files are MBs). */
async function cachedRange(path: string): Promise<Range | null> {
  if (!(await exists(path))) return null;
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(512);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const head = buf.subarray(0, bytesRead).toString("utf8");
    const start = /"start":"([^"]+)"/.exec(head)?.[1];
    const end = /"end":"([^"]+)"/.exec(head)?.[1];
    return start && end ? { start, end } : null;
  } finally {
    await fh.close();
  }
}

const covers = (have: Range | null, need: Range): boolean =>
  have !== null && Date.parse(have.start) <= Date.parse(need.start) && Date.parse(have.end) >= Date.parse(need.end);

const toRow = (c: Candle): Row => [c.t, c.o, c.h, c.l, c.c, c.v];
const toCandle = ([t, o, h, l, c, v]: Row): Candle => ({ t, o, h, l, c, v });

async function existingSnapshot() {
  return prisma.scorecardSnapshot.findUnique({
    where: { kind_ruleVersion: { kind: "replay", ruleVersion: CHART_RULE_VERSION } },
  });
}

// 0. Refuse early, before hours of fetching, if the result already exists.
if ((await existingSnapshot()) && !force) {
  console.error(`a replay snapshot for ${CHART_RULE_VERSION} already exists; pass --force to overwrite it`);
  await prisma.$disconnect();
  process.exit(1);
}
await mkdir(CACHE_DIR, { recursive: true });

// 1. The period: sessions from SPY's daily bars, 3 years ending at the last finished session.
const spyPath = pathFor("SPY", "1d");
if (!(await exists(spyPath))) {
  const end = new Date(Date.now() - SIP_DELAY_MS - 60_000).toISOString();
  const start = new Date(Date.now() - (YEARS * 366 + 10) * 86_400_000).toISOString();
  const spy = (await fetchAlpacaRange(["SPY"], start, end, "1d")).get("SPY");
  if (!spy?.length) throw new Error("no SPY daily bars: cannot define the sessions");
  await writeCache(spyPath, { start, end, fetchedAt: new Date().toISOString(), bars: spy.map(toRow) });
}
const spyFile = (await readCache(spyPath))!;
const fetchedAtMs = Date.parse(spyFile.fetchedAt);
const finished = spyFile.bars
  .map((r) => etClock(r[0]).date)
  .filter((d) => etSessionCloseMs(d) + SIP_DELAY_MS <= fetchedAtMs);
if (finished.length === 0) throw new Error(`no finished session in ${spyPath}`);
const to = finished[finished.length - 1];
const fromExclusive = `${Number(to.slice(0, 4)) - YEARS}${to.slice(4)}`;
const sessions = [...new Set(finished.filter((d) => d > fromExclusive))].sort();
const from = sessions[0];
const endIso = new Date(etSessionCloseMs(to)).toISOString();
console.log(`period ${from} .. ${to}: ${sessions.length} sessions`);

const need: Record<Kind, Range> = {
  "5m": { start: `${addDays(from, -INTRADAY_PAD_DAYS)}T00:00:00.000Z`, end: endIso },
  "1d": { start: `${addDays(from, -DAILY_PAD_DAYS)}T00:00:00.000Z`, end: endIso },
  "1d.raw": { start: `${addDays(from, -DAILY_PAD_DAYS)}T00:00:00.000Z`, end: endIso },
};
const isCovered = async (t: string, kind: Kind) => covers(await cachedRange(pathFor(t, kind)), need[kind]);

const hasRegularBar = (rows: Row[]): boolean =>
  rows.some((r) => {
    const m = etClock(r[0]).minutes;
    return m >= REGULAR_FROM_MIN && m < KEEP_TO_MIN;
  });

/**
 * A 5-minute file counts only if it covers the period AND holds at least one
 * regular-session bar: a covered file with no bars (or only pre-market ones) would
 * otherwise pass the refuse-partial check and silently drop the ticker.
 */
async function intradayUsable(t: string): Promise<boolean> {
  if (!(await isCovered(t, "5m"))) return false;
  const file = await readCache(pathFor(t, "5m"));
  return file !== null && hasRegularBar(file.bars);
}

/** Bars of a file that covers the period; [] otherwise, so a stale file is never read. */
async function loadBars(ticker: string, kind: Kind): Promise<Candle[]> {
  const file = await readCache(pathFor(ticker, kind));
  return file && covers(file, need[kind]) ? file.bars.map(toCandle) : [];
}

// 2. Bars: daily (adjusted, then raw) in chunked batches, 5-minute one ticker at a
// time (a few in parallel). Only files missing or not covering the period are fetched.
const universe = [...new Set(UNIVERSES.sp500.symbols)];

for (const [kind, adjustment] of [["1d", "all"], ["1d.raw", "raw"]] as const) {
  const todo: string[] = [];
  for (const t of universe) if (!(await isCovered(t, kind))) todo.push(t);
  if (!todo.length) continue;
  console.log(`fetching ${kind} bars for ${todo.length} tickers ...`);
  const got = await fetchAlpacaRange(todo, need[kind].start, need[kind].end, "1d", adjustment);
  for (const t of todo) {
    const bars = got.get(t);
    if (bars?.length) {
      await writeCache(pathFor(t, kind), { ...need[kind], fetchedAt: new Date().toISOString(), bars: bars.map(toRow) });
    }
  }
}

const needIntraday: string[] = [];
for (const t of universe) if (!(await intradayUsable(t))) needIntraday.push(t);
console.log(`5-minute bars: ${universe.length - needIntraday.length} cached, ${needIntraday.length} to fetch`);
let done = 0;
let next = 0;
async function worker(): Promise<void> {
  while (next < needIntraday.length) {
    const t = needIntraday[next++];
    const bars = (await fetchAlpacaRange([t], need["5m"].start, need["5m"].end, "5m")).get(t);
    if (bars?.length) {
      const kept = bars
        .filter((b) => {
          const m = etClock(b.t).minutes;
          return m >= KEEP_FROM_MIN && m < KEEP_TO_MIN;
        })
        .map(toRow);
      // Not written without a regular bar, so a rerun fetches it again.
      if (hasRegularBar(kept)) {
        await writeCache(pathFor(t, "5m"), { ...need["5m"], fetchedAt: new Date().toISOString(), bars: kept });
      }
    }
    if (++done % 25 === 0 || done === needIntraday.length) {
      console.log(`fetched ${done}/${needIntraday.length} tickers (${elapsed()})`);
    }
  }
}
await Promise.all(Array.from({ length: FETCH_WORKERS }, worker));

// 3. Every ticker must have all three files covering the period (the 5-minute one with
// at least one regular-session bar), unless allowed.
const missing: string[] = [];
for (const t of universe) {
  const kinds: Kind[] = [];
  if (!(await intradayUsable(t))) kinds.push("5m");
  for (const kind of ["1d", "1d.raw"] as const) if (!(await isCovered(t, kind))) kinds.push(kind);
  if (kinds.length) missing.push(t);
  if (kinds.length) console.log(`  missing ${t}: ${kinds.join(", ")}`);
}
if (missing.length && !allowMissing) {
  console.error(
    `${missing.length} tickers lack bars (${missing.join(", ")}). Rerun to retry the fetch, ` +
      "or pass --allow-missing to replay without them (the summary will list them).",
  );
  await prisma.$disconnect();
  process.exit(1);
}

// 4. Replay.
const summary = await runReplay({
  sessions,
  universe,
  loadIntraday: (t) => loadBars(t, "5m"),
  loadDaily: (t) => loadBars(t, "1d"),
  loadRawDaily: (t) => loadBars(t, "1d.raw"),
  log: (msg) => console.log(`${msg} (${elapsed()})`),
});

// 5. Store. Checked again: the run is long and another one may have finished meanwhile.
const data = summary as unknown as Prisma.InputJsonValue;
const key = { kind: "replay", ruleVersion: CHART_RULE_VERSION };
if (force) {
  await prisma.scorecardSnapshot.upsert({
    where: { kind_ruleVersion: key },
    create: { ...key, data },
    update: { data, computedAt: new Date() },
  });
} else {
  if (await existingSnapshot()) {
    console.error("a replay snapshot appeared while this ran; not overwriting (rerun with --force)");
    process.exitCode = 1;
  } else {
    await prisma.scorecardSnapshot.create({ data: { ...key, data } });
  }
}

const { cumulativeR, ...printable } = summary;
console.log(JSON.stringify({ ...printable, cumulativeRFinal: cumulativeR.at(-1) ?? null }, null, 2));
console.log(`verdict: ${summary.pass ? "ผ่าน" : "ไม่ผ่าน"} (${elapsed()})`);
await prisma.$disconnect();
