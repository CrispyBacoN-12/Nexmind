// One-off 3-year replay of the chart agent's long-sweep rule (scorecard agent #4,
// spec §7): rank the S&P 500 as the live scan would have at 10:30 ET each session,
// run the live setup pipeline on the top 20, score every setup as if bought, and
// judge it against random entries. Writes ScorecardSnapshot kind "replay" for the
// current CHART_RULE_VERSION. Never writes ChartSetup.
//
// Usage: node --env-file=.env --import tsx scripts/scorecard-replay.mts [--force]
//   --force  overwrite an existing replay snapshot for this rule version
//
// Bars are cached per ticker under .cache/scorecard/ (<TICKER>.5m.json,
// <TICKER>.1d.json); a cached file is never refetched. The period comes from the
// cached SPY daily bars (SPY.1d.json), so a rerun replays the same period; delete
// the folder to move it. Only 04:00-16:00 ET 5-minute bars are kept: nothing in the
// replay reads after-hours bars.

import { mkdir, readFile, rename, writeFile, stat } from "node:fs/promises";
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
const INTRADAY_PAD_DAYS = 15; // prior sessions + rvol baseline
const DAILY_PAD_DAYS = 60; // ATR14 window + 10-day averages
const FETCH_WORKERS = 3;
const KEEP_FROM_MIN = 4 * 60; // 04:00 ET
const KEEP_TO_MIN = 16 * 60; // 16:00 ET

const force = process.argv.includes("--force");
const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 60_000).toFixed(1)} min`;

type Row = [number, number, number, number, number, number];
interface CacheFile {
  fetchedAt: string;
  start: string;
  end: string;
  bars: Row[];
}

const pathFor = (ticker: string, kind: "5m" | "1d") => `${CACHE_DIR}/${ticker}.${kind}.json`;
const exists = (p: string) => stat(p).then(() => true, () => false);

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Atomic: a crash mid-write leaves no truncated file that would never be refetched. */
async function writeCache(path: string, file: CacheFile): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(file));
  await rename(tmp, path);
}

async function readCache(path: string): Promise<CacheFile | null> {
  if (!(await exists(path))) return null;
  return JSON.parse(await readFile(path, "utf8")) as CacheFile;
}

const toRow = (c: Candle): Row => [c.t, c.o, c.h, c.l, c.c, c.v];
const toCandle = ([t, o, h, l, c, v]: Row): Candle => ({ t, o, h, l, c, v });

async function loadBars(ticker: string, kind: "5m" | "1d"): Promise<Candle[]> {
  const file = await readCache(pathFor(ticker, kind));
  return file ? file.bars.map(toCandle) : [];
}

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
  await writeCache(spyPath, { fetchedAt: new Date().toISOString(), start, end, bars: spy.map(toRow) });
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

// 2. Bars: daily in one chunked batch, 5-minute one ticker at a time (a few in parallel).
const universe = [...new Set(UNIVERSES.sp500.symbols)];
const missing = new Set<string>();

const needDaily: string[] = [];
for (const t of universe) if (!(await exists(pathFor(t, "1d")))) needDaily.push(t);
if (needDaily.length) {
  const start = `${addDays(from, -DAILY_PAD_DAYS)}T00:00:00Z`;
  console.log(`fetching daily bars for ${needDaily.length} tickers ...`);
  const got = await fetchAlpacaRange(needDaily, start, endIso, "1d");
  for (const t of needDaily) {
    const bars = got.get(t);
    if (!bars?.length) {
      missing.add(t);
      continue;
    }
    await writeCache(pathFor(t, "1d"), { fetchedAt: new Date().toISOString(), start, end: endIso, bars: bars.map(toRow) });
  }
}

const needIntraday: string[] = [];
for (const t of universe) if (!(await exists(pathFor(t, "5m")))) needIntraday.push(t);
console.log(`5-minute bars: ${universe.length - needIntraday.length} cached, ${needIntraday.length} to fetch`);
const intradayStart = `${addDays(from, -INTRADAY_PAD_DAYS)}T00:00:00Z`;
let done = 0;
let next = 0;
async function worker(): Promise<void> {
  while (next < needIntraday.length) {
    const t = needIntraday[next++];
    const bars = (await fetchAlpacaRange([t], intradayStart, endIso, "5m")).get(t);
    if (bars?.length) {
      const kept = bars.filter((b) => {
        const m = etClock(b.t).minutes;
        return m >= KEEP_FROM_MIN && m < KEEP_TO_MIN;
      });
      await writeCache(pathFor(t, "5m"), { fetchedAt: new Date().toISOString(), start: intradayStart, end: endIso, bars: kept.map(toRow) });
    } else {
      missing.add(t);
    }
    if (++done % 25 === 0 || done === needIntraday.length) {
      console.log(`fetched ${done}/${needIntraday.length} tickers (${elapsed()})`);
    }
  }
}
await Promise.all(Array.from({ length: FETCH_WORKERS }, worker));
if (missing.size) console.log(`no bars (${missing.size}, retried on the next run): ${[...missing].join(", ")}`);

// 3. Replay.
const summary = await runReplay({
  sessions,
  universe,
  loadIntraday: (t) => loadBars(t, "5m"),
  loadDaily: (t) => loadBars(t, "1d"),
  log: (msg) => console.log(`${msg} (${elapsed()})`),
});

// 4. Store. Checked again: the run is long and another one may have finished meanwhile.
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
