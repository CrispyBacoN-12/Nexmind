// Builds a daily-bar panel of liquid US common stocks that are NOT in the S&P 500.
//
// WHY THIS UNIVERSE EXISTS
//
// Ten mechanisms have now been measured against a matched random control on
// .cache/bars/sp500-1d.json and none is tradeable: four families closed earlier
// (trend-pullback continuation, Donchian/breakout, 13 confluence vetoes,
// cross-sectional MR + momentum) and six more on 2026-08-26
// (docs/quant/2026-08-26-mechanism-screen-results.md). Every one of them is a
// function of daily OHLCV, and every one was measured on the 491 most heavily
// analysed securities on earth. Finding no exploitable structure there is the
// expected result, not a surprise.
//
// So this changes the INPUT rather than the rule. The symbol set is disjoint
// from the S&P 500 by construction, which makes the follow-up a clean controlled
// comparison: the same six pre-registered mechanisms, the same folds, the same
// ladder, the same PANEL_SEED - only the universe differs. That isolates the
// question "was the null result about the mechanisms, or about the universe?",
// which no amount of further work on sp500-1d.json can answer.
//
// WHAT THIS PANEL CANNOT TELL YOU - read before quoting any number off it
//
// Every symbol here is currently listed. Small and mid caps delist far more
// often than large caps do, so the survivorship bias in this cache is WORSE
// than in sp500-1d.json, not better. Absolute avgR computed on it is not a
// meaningful number and must never be reported as one.
//
// The margin over the matched control still is, and that is the whole reason
// the control exists: it re-places entries within the SAME symbols, so a name
// that is only in the cache because it survived and tripled helps the rule and
// the control equally. Read margins. Do not read levels.
//
// The liquidity screen below carries the same caveat in miniature - it is
// measured on the most recent year, so a stock that was untradeable in 2016 and
// liquid in 2026 is included. That is universe-construction lookahead of exactly
// the same class, cancelled in exactly the same way, and it is why the screen is
// deliberately a floor on tradeability rather than anything resembling a filter
// on returns.
//
// TWO PASSES, AND WHY
//
// 5,000+ symbols of `max` history is roughly a gigabyte of JSON and several
// gigabytes of heap. Pass 1 fetches ONE YEAR for everything and keeps only
// liquidity statistics, discarding bars as it goes; pass 2 re-fetches full
// history for the survivors alone. It costs one extra cheap fetch and bounds
// peak memory to the output size.
//
// Usage: node --env-file=.env --import tsx scripts/cache-broad-universe.mts [target]
import { mkdir, writeFile } from "node:fs/promises";
import { fetchAlpacaCandlesBatch } from "@/lib/alpaca";
import { UNIVERSES } from "@/lib/trading/universe";
import type { Candle } from "@/lib/indicators";

/** The regime input. Present in every panel cache alongside the members (regime.ts). */
const REGIME_SYMBOL = "SPY";

/**
 * Tradeability floors, set from the actual account rather than from anything
 * measured: ~$2-3k of capital in whole shares across ~5 slots is ~$500 a
 * position. At $2M median daily dollar volume that is 0.025% of a day's tape -
 * no impact, and the binding cost is the spread, which DEFAULT_COST_MODEL
 * already charges. The $5 close floor is there because sub-$5 quotes tick in
 * increments that make an ATR-scaled stop meaningless, not because cheap stocks
 * underperform.
 */
const MIN_MEDIAN_DOLLAR_VOL = 2_000_000;
const MIN_MEDIAN_CLOSE = 5;

/** A fold needs PANEL_WARMUP_BARS = 250 before it can trade at all. */
const MIN_BARS = 300;

/**
 * Symbols to keep. ~1200 is ~2.4x sp500-1d.json, which keeps both the file and
 * the 200-run control within the same order of magnitude as the run that
 * produced the 2026-08-26 results. Raising it costs control runtime linearly.
 */
const TARGET = Number(process.argv[2] ?? 1200);

const NASDAQ_DIR = "https://www.nasdaqtrader.com/dynamic/symdir";
/** Warrants, units, rights and preferreds are not common stock and do not trade like it. */
const NON_COMMON = /warrant|\bunits?\b|\brights?\b|preferred|depositary|debenture|% Notes|subordinated/i;

async function directory(file: string, symbolCol: string): Promise<string[]> {
  const res = await fetch(`${NASDAQ_DIR}/${file}`);
  if (!res.ok) throw new Error(`${file}: upstream ${res.status}`);
  const lines = (await res.text()).split("\n");
  const header = lines[0].split("|");
  const out: string[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim() || line.startsWith("File Creation Time")) continue;
    const fields = line.split("|");
    if (fields.length !== header.length) continue;
    const row = Object.fromEntries(header.map((h, i) => [h, fields[i]]));
    const symbol = (row[symbolCol] ?? "").trim();
    if (row.ETF?.trim().toUpperCase() === "Y") continue;
    if (row["Test Issue"]?.trim().toUpperCase() === "Y") continue;
    // A plain 1-5 letter ticker. This also drops the "$" and "." forms NYSE uses
    // for preferred and class shares, which Alpaca and Yahoo spell differently.
    if (!/^[A-Z]{1,5}$/.test(symbol)) continue;
    if (NON_COMMON.test(row["Security Name"] ?? "")) continue;
    out.push(symbol);
  }
  return out;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

async function inChunks(symbols: string[], size: number, fn: (chunk: string[], done: number) => Promise<void>) {
  for (let i = 0; i < symbols.length; i += size) {
    await fn(symbols.slice(i, i + size), Math.min(i + size, symbols.length));
  }
}

// ---- symbol list ----

const listed = new Set([
  ...(await directory("nasdaqlisted.txt", "Symbol")),
  ...(await directory("otherlisted.txt", "ACT Symbol")),
]);
const sp500 = new Set(UNIVERSES.sp500.symbols);
const candidates = [...listed].filter((s) => !sp500.has(s) && s !== REGIME_SYMBOL).sort();
console.log(`directory: ${listed.size} common stocks listed, ${candidates.length} outside the S&P 500`);

// ---- pass 1: liquidity only, bars discarded as we go ----

console.log(`\npass 1 - screening ${candidates.length} symbols on 1y liquidity ...`);
const started = Date.now();
const passed: string[] = [];
let screened = 0;

await inChunks(candidates, 400, async (chunk, done) => {
  const fetched = await fetchAlpacaCandlesBatch(chunk, "1y", "1d");
  for (const [symbol, resp] of fetched) {
    const bars = resp.candles;
    if (bars.length < 120) continue; // less than half a year of tape: not screenable
    if (median(bars.map((b) => b.c)) < MIN_MEDIAN_CLOSE) continue;
    if (median(bars.map((b) => b.c * b.v)) < MIN_MEDIAN_DOLLAR_VOL) continue;
    passed.push(symbol);
  }
  screened = done;
  process.stdout.write(`  ${done}/${candidates.length} screened, ${passed.length} pass the floor\r`);
});
console.log(`\n  ${screened} screened in ${((Date.now() - started) / 1000).toFixed(0)}s - ${passed.length} tradeable`);

// Trim by even spacing across the alphabet rather than by taking the most
// liquid. Ranking on dollar volume and cutting at 1200 would hand back the
// S&P 400 - the next-largest caps - which is the segment this whole exercise is
// trying to get away from. Alphabetical position is deterministic, needs no RNG,
// and is uncorrelated with liquidity, so an evenly spaced sample spans the floor
// to the ceiling.
//
// Spacing is FRACTIONAL on purpose. An integer stride collapses to 1 as soon as
// the survivor count is less than twice `wanted`, and `filter(i % 1 === 0)`
// followed by a slice is not a stride at all - it is an alphabetical truncation
// that would have kept roughly A through M and silently thrown away the second
// half of the universe.
const wanted = TARGET;
const sorted = [...passed].sort();
const selected =
  wanted >= sorted.length
    ? sorted
    : Array.from({ length: wanted }, (_, i) => sorted[Math.floor((i * sorted.length) / wanted)]);
console.log(
  `  keeping ${selected.length} of ${sorted.length} (1 in ${(sorted.length / selected.length).toFixed(2)}, ` +
    `${selected[0]}..${selected[selected.length - 1]}) into pass 2 (target ${TARGET})`,
);

// ---- pass 2: full history for the survivors ----

console.log(`\npass 2 - fetching max history for ${selected.length + 1} symbols ...`);
const pass2 = Date.now();
const bars: Record<string, Candle[]> = {};
let short = 0;

await inChunks([REGIME_SYMBOL, ...selected], 200, async (chunk, done) => {
  const fetched = await fetchAlpacaCandlesBatch(chunk, "max", "1d");
  for (const [symbol, resp] of fetched) {
    if (symbol !== REGIME_SYMBOL && resp.candles.length < MIN_BARS) { short++; continue; }
    bars[symbol] = resp.candles;
  }
  process.stdout.write(`  ${done}/${selected.length + 1} fetched, ${Object.keys(bars).length} kept\r`);
});
console.log(`\n  done in ${((Date.now() - pass2) / 1000).toFixed(0)}s - ${short} dropped for < ${MIN_BARS} bars`);

// Everything that survived MIN_BARS is kept. There is deliberately NO second
// trim here. An earlier version sliced this list to TARGET after sorting it,
// which is an alphabetical truncation, not a sample - it silently cut the panel
// off at QGEN and threw away every symbol from R to Z. The final count is
// therefore TARGET minus the pass-2 dropouts, which is a number worth reading
// rather than a round one worth trusting.
const keep = Object.keys(bars).filter((s) => s !== REGIME_SYMBOL).sort();
const out: Record<string, Candle[]> = { [REGIME_SYMBOL]: bars[REGIME_SYMBOL] ?? [] };
for (const s of keep) out[s] = bars[s];

const counts = keep.map((s) => out[s].length).sort((a, b) => a - b);
const spans = keep.flatMap((s) => (out[s].length ? [out[s][0].t, out[s][out[s].length - 1].t] : []));
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

console.log(`\n--- panel ---`);
console.log(`symbols: ${keep.length} (+ ${REGIME_SYMBOL}, ${out[REGIME_SYMBOL].length} bars)`);
// Printed because the failure this file has already hit twice - keeping a
// prefix of the alphabet instead of a sample - is invisible in a symbol count.
const initials = [...new Set(keep.map((s) => s[0]))].sort().join("");
console.log(`alphabet: ${keep[0]}..${keep[keep.length - 1]} covering ${initials}`);
console.log(`bars per symbol: min=${counts[0]} median=${median(counts)} max=${counts[counts.length - 1]}`);
console.log(`date span: ${iso(Math.min(...spans))} .. ${iso(Math.max(...spans))}`);
if (!out[REGIME_SYMBOL].length) console.warn(`WARNING: ${REGIME_SYMBOL} missing - the market gate cannot read this panel`);

const outPath = ".cache/bars/broad-1d.json";
await mkdir(".cache/bars", { recursive: true });
await writeFile(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), bars: out }));
console.log(`\nwrote ${outPath}`);
