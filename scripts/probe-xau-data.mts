// Phase 0 of the XAUUSD plan: what history does this broker actually have, and
// how much of it is real?
//
// Nothing downstream can be declared before this runs. XAU_FOLDS has to be cut
// on windows that exist and are dense; a fold declared over a year the broker
// serves thinly is a fold whose verdict is about the feed. So this measures
// first and the folds are written afterwards, in that order, and the numbers
// here are the input to that decision rather than a check on it.
//
// WHAT IT LOOKS FOR, AND WHY EACH ONE
//
// 1. DEPTH. The plan's stop condition is H1 shallower than ~8 years. A broker's
//    intraday history is a business decision, not a fact about gold, and there
//    is no way to know it but to ask.
//
// 2. RESOLUTION. isIntradaySeries, not a bar count. An MT5 server with no
//    history at the timeframe requested does not error — it answers with what it
//    has, and the bars it returns are individually well-formed. This is the same
//    class of failure as Yahoo silently downgrading `interval` over a long
//    `range` (STATE.md §5), and the only evidence either time is the spacing.
//
// 3. FROZEN PRINTS. sanitizeSeries drop count. The S&P cache carried 1,886 of
//    them and one symbol had 652 consecutive; three such bars owned an entire
//    fold's avgR (-8,952,720) before anyone noticed. Gold trades 24/5 and should
//    have essentially none. A large count means the feed is padded.
//
// 4. HOLES, PER YEAR. Depth alone would let a fold be declared over a year that
//    is 30% present. The per-year table is what the fold boundaries get read off
//    — coverage, not just presence.
//
// Read-only. Places nothing, writes nothing.
//
// Run: npx tsx scripts/probe-xau-data.mts [--symbol=XAUUSD] [--search=XAU]

import "dotenv/config";
import {
  fetchMt5Symbols, fetchMt5Account, fetchMt5CandleRange, isDemoAccount,
} from "@/lib/mt5";
import { sanitizeSeries, isIntradaySeries, medianBarSpacingDays } from "@/lib/bars";
import type { Candle } from "@/lib/indicators";

/** MT5 timeframe -> its nominal length in minutes. */
const TIMEFRAMES: Array<{ tf: string; minutes: number }> = [
  { tf: "M15", minutes: 15 },
  { tf: "H1", minutes: 60 },
  { tf: "H4", minutes: 240 },
  { tf: "D1", minutes: 1440 },
];

/** Wide enough to cover any broker's archive; the server clips to what it holds. */
const HISTORY_START = Date.UTC(1990, 0, 1) / 1000;

const arg = (name: string, fallback: string): string =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;

const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/**
 * Does the span between two bars contain a Saturday?
 *
 * Approximate on purpose. Broker server time is typically UTC+2/+3, so the week
 * closes around Friday 21:00 UTC and reopens Sunday 22:00 UTC — a window that
 * always contains Saturday in UTC whatever the exact offset. Getting the offset
 * right would need the broker's session table and would not change what this is
 * for: separating "the market was shut" from "bars are missing".
 */
function spansWeekend(fromSec: number, toSec: number): boolean {
  const DAY = 86_400;
  for (let d = Math.floor(fromSec / DAY) * DAY; d <= toSec; d += DAY) {
    if (new Date(d * 1000).getUTCDay() === 6 && d > fromSec && d < toSec) return true;
  }
  return false;
}

/** Walk the whole archive one page at a time, resuming on `truncated`. */
async function fetchAll(symbol: string, tf: string): Promise<Candle[]> {
  const now = Math.floor(Date.now() / 1000);
  const out: Candle[] = [];
  let from = HISTORY_START;
  for (let page = 0; page < 40; page++) {
    const { candles, truncated } = await fetchMt5CandleRange(symbol, tf, from, now);
    if (!candles.length) break;
    // The resume timestamp is inclusive on the server, so the first bar of the
    // next page repeats the last of this one.
    for (const c of candles) if (!out.length || c.t > out[out.length - 1].t) out.push(c);
    if (!truncated) break;
    const last = candles[candles.length - 1].t;
    if (last <= from) break; // no forward progress; stop rather than spin
    from = last;
  }
  return out;
}

interface YearRow { year: number; bars: number; missing: number; frozen: number }

/** Per-year coverage: bars present, and weekday bar-slots the feed skipped. */
function byYear(bars: Candle[], minutes: number): YearRow[] {
  const step = minutes * 60;
  const rows = new Map<number, YearRow>();
  const row = (t: number) => {
    const year = new Date(t * 1000).getUTCFullYear();
    let r = rows.get(year);
    if (!r) rows.set(year, (r = { year, bars: 0, missing: 0, frozen: 0 }));
    return r;
  };
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const r = row(b.t);
    r.bars++;
    if (b.o === b.h && b.h === b.l && b.l === b.c) r.frozen++;
    if (i === 0) continue;
    const gap = b.t - bars[i - 1].t;
    if (gap <= step * 1.5) continue;
    if (spansWeekend(bars[i - 1].t, b.t)) continue;
    // Charge the hole to the year it opens in, which is where a fold boundary
    // would have to notice it.
    row(bars[i - 1].t).missing += Math.round(gap / step) - 1;
  }
  return [...rows.values()].sort((a, b) => a.year - b.year);
}

async function main() {
  const search = arg("search", "XAU");
  const only = arg("symbol", "");

  const account = await fetchMt5Account();
  console.log(
    `account: ${account.tradeMode} (demo-safe=${isDemoAccount(account)})  ` +
    `${account.currency} balance=${account.balance}  leverage=1:${account.leverage}  ` +
    `margin_level=${account.marginLevel}  trade_allowed=${account.tradeAllowed}`,
  );

  const symbols = await fetchMt5Symbols(search);
  console.log(`\ngold symbols matching *${search}* (${symbols.length}):`);
  for (const s of symbols) {
    console.log(
      `  ${s.name.padEnd(14)} spread=${String(s.spread).padStart(5)}pt  digits=${s.digits}  ` +
      `contract=${s.tradeContractSize}  vol ${s.volumeMin}-${s.volumeMax} step ${s.volumeStep}  ` +
      `swapL=${s.swapLong} swapS=${s.swapShort} mode=${s.swapMode} x3=${s.swapRollover3Days}  ` +
      `tick ${s.tradeTickSize}/${s.tradeTickValue}  ${s.description}`,
    );
  }

  const targets = only ? [only] : symbols.slice(0, 1).map((s) => s.name);
  if (!targets.length) {
    console.log("\nno symbol to probe — pass --symbol=");
    return;
  }

  for (const symbol of targets) {
    console.log(`\n=== ${symbol} ===`);
    for (const { tf, minutes } of TIMEFRAMES) {
      let bars: Candle[];
      try {
        bars = await fetchAll(symbol, tf);
      } catch (e) {
        console.log(`  ${tf.padEnd(4)} FAILED: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      if (bars.length < 2) {
        console.log(`  ${tf.padEnd(4)} ${bars.length} bars — nothing to measure`);
        continue;
      }
      const { dropped } = sanitizeSeries(bars);
      const years = (bars[bars.length - 1].t - bars[0].t) / (365.25 * 86_400);
      const spacingMin = (medianBarSpacingDays(bars) ?? 0) * 1440;
      // D1 is checked as a daily series would be; the others against their own
      // nominal length. Both answer the same question: is this the resolution
      // the request named, or whatever the server had?
      const rightResolution = isIntradaySeries(bars, minutes);
      console.log(
        `  ${tf.padEnd(4)} ${String(bars.length).padStart(8)} bars  ` +
        `${iso(bars[0].t)} -> ${iso(bars[bars.length - 1].t)}  (${years.toFixed(2)}y)  ` +
        `median spacing ${spacingMin.toFixed(1)}m vs ${minutes}m ` +
        `${rightResolution ? "OK" : "*** WRONG RESOLUTION ***"}  frozen/dropped=${dropped}`,
      );

      // The per-year table is the one Phase 2 reads. Print it only for the
      // timeframe the plan actually intends to trade, or the log becomes noise.
      if (tf !== "H1") continue;
      console.log(`       year    bars   missing   miss%   frozen`);
      for (const r of byYear(bars, minutes)) {
        const pct = r.bars + r.missing > 0 ? (100 * r.missing) / (r.bars + r.missing) : 0;
        console.log(
          `       ${r.year}  ${String(r.bars).padStart(6)}  ${String(r.missing).padStart(7)}  ` +
          `${pct.toFixed(1).padStart(5)}%  ${String(r.frozen).padStart(6)}`,
        );
      }
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
