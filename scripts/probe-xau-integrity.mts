// Phase 0 of the XAUUSD plan, second half: is the broker's gold history the
// history of gold?
//
// WHY THIS EXISTS AT ALL
//
// On a CFD the broker is both the counterparty and the only source of prices,
// and spot gold has no consolidated tape to check them against. That is a
// structurally worse position than the equity work, where Alpaca and Yahoo agree
// to the cent and either can convict the other. Nothing here fixes that. What it
// can do is catch the failure that has already happened once in this project:
// Webull served a "SPY" series that was a DIFFERENT INSTRUMENT for 84% of its
// length, spliced to real SPY at both ends, and every bar in it was well-formed.
// It was caught by an implausible relationship (a close 117% from its own
// SMA200), not by looking at any bar.
//
// So this compares relationships, in two ways that fail differently:
//
//   LEVELS — XAUUSD / GC=F should sit near 1 and drift only with the futures
//   basis; XAUUSD / GLD near 10.8 and drift slowly with the ETF's expense
//   accrual. A splice or a mis-adjustment is a STEP in that ratio, and a step is
//   visible even though neither series matches the other exactly.
//
//   RETURNS — daily log-return correlation. Levels can be off by a constant
//   forever and still be the same asset; returns cannot. A correlation well
//   under ~0.95 against GC=F means the broker's bars are not tracking gold,
//   whatever they are labelled.
//
// Neither is expected to be exact and a small mismatch is not a finding: spot
// and futures have a real basis, GLD trades a US session against gold's 24-hour
// one, and a daily bar built from H1 in UTC does not share a boundary with
// either. The thing being looked for is a step or a decorrelation, not a
// residual.
//
// Read-only. Places nothing, writes nothing.
//
// Run: npx tsx scripts/probe-xau-integrity.mts [--symbol=XAUUSD]

import "dotenv/config";
import { fetchMt5CandleRange } from "@/lib/mt5";
import { fetchAlpacaCandles } from "@/lib/alpaca";
import { parseYahooChart } from "@/lib/yahoo";
import { isDailySeries } from "@/lib/bars";
import type { Candle } from "@/lib/indicators";

const HISTORY_START = Date.UTC(1990, 0, 1) / 1000;
const DAY = 86_400;

const arg = (name: string, fallback: string): string =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;

const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const month = (t: number) => new Date(t * 1000).toISOString().slice(0, 7);

/** Broker H1 walked to the end, page by page. */
async function brokerH1(symbol: string): Promise<Candle[]> {
  const now = Math.floor(Date.now() / 1000);
  const out: Candle[] = [];
  let from = HISTORY_START;
  for (let page = 0; page < 40; page++) {
    const { candles, truncated } = await fetchMt5CandleRange(symbol, "H1", from, now);
    if (!candles.length) break;
    for (const c of candles) if (!out.length || c.t > out[out.length - 1].t) out.push(c);
    if (!truncated) break;
    const last = candles[candles.length - 1].t;
    if (last <= from) break;
    from = last;
  }
  return out;
}

/**
 * H1 -> one bar per UTC calendar day.
 *
 * A UTC day is not gold's trading day and is not GLD's either. That is fine and
 * deliberate: the comparison is between daily CLOSES a few hours apart, which
 * moves the correlation by a little and a splice by nothing.
 */
function toDaily(bars: Candle[]): Candle[] {
  const days = new Map<number, Candle>();
  for (const b of bars) {
    const key = Math.floor(b.t / DAY) * DAY;
    const d = days.get(key);
    if (!d) days.set(key, { t: key, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    else {
      d.h = Math.max(d.h, b.h);
      d.l = Math.min(d.l, b.l);
      d.c = b.c;
      d.v += b.v;
    }
  }
  return [...days.values()].sort((a, b) => a.t - b.t);
}

/** Yahoo daily over an explicit epoch window — never `range=`, see cache-deep-history.mts. */
async function yahooDaily(symbol: string, fromSec: number, toSec: number): Promise<Candle[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${Math.floor(fromSec)}&period2=${Math.floor(toSec)}&interval=1d&includeAdjustedClose=true`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`yahoo ${res.status} for ${symbol}`);
  return parseYahooChart(await res.json(), symbol, "max", "1d").candles;
}

const pct = (xs: number[], p: number): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};

/** Pair two daily series on the UTC day they share. */
function align(a: Candle[], b: Candle[]): Array<{ t: number; a: number; b: number }> {
  const byDay = new Map(b.map((c) => [Math.floor(c.t / DAY) * DAY, c.c]));
  const out: Array<{ t: number; a: number; b: number }> = [];
  for (const c of a) {
    const key = Math.floor(c.t / DAY) * DAY;
    const other = byDay.get(key);
    if (other != null && other > 0 && c.c > 0) out.push({ t: key, a: c.c, b: other });
  }
  return out;
}

function correlation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

function report(label: string, pairs: Array<{ t: number; a: number; b: number }>) {
  if (pairs.length < 30) {
    console.log(`\n${label}: only ${pairs.length} shared days — not enough to say anything`);
    return;
  }
  const ratios = pairs.map((p) => p.a / p.b);
  console.log(
    `\n${label}: ${pairs.length} shared days  ${iso(pairs[0].t)} -> ${iso(pairs[pairs.length - 1].t)}`,
  );
  console.log(
    `  ratio  p1=${pct(ratios, 0.01).toFixed(4)}  p50=${pct(ratios, 0.5).toFixed(4)}  ` +
    `p99=${pct(ratios, 0.99).toFixed(4)}  spread=${(pct(ratios, 0.99) / pct(ratios, 0.01)).toFixed(3)}x`,
  );

  const ra: number[] = [], rb: number[] = [];
  for (let i = 1; i < pairs.length; i++) {
    // Skip a pair that straddles a hole in either series; a return measured
    // across a week-long gap is not a daily return.
    if (pairs[i].t - pairs[i - 1].t > 5 * DAY) continue;
    ra.push(Math.log(pairs[i].a / pairs[i - 1].a));
    rb.push(Math.log(pairs[i].b / pairs[i - 1].b));
  }
  console.log(`  daily log-return correlation over ${ra.length} pairs: ${correlation(ra, rb).toFixed(4)}`);

  // A splice shows as a STEP in the level ratio between adjacent months, not as
  // noise inside one. Monthly medians, then the biggest month-over-month jumps.
  const perMonth = new Map<string, number[]>();
  for (const p of pairs) {
    const k = month(p.t);
    let bucket = perMonth.get(k);
    if (!bucket) perMonth.set(k, (bucket = []));
    bucket.push(p.a / p.b);
  }
  const months = [...perMonth.entries()].map(([k, v]) => ({ k, med: pct(v, 0.5) })).sort((x, y) => x.k.localeCompare(y.k));
  const jumps = months.slice(1).map((m, i) => ({ from: months[i].k, to: m.k, jump: m.med / months[i].med }));
  jumps.sort((x, y) => Math.abs(Math.log(y.jump)) - Math.abs(Math.log(x.jump)));
  console.log("  largest month-over-month ratio steps (a splice is a step, not noise):");
  for (const j of jumps.slice(0, 5)) {
    console.log(`    ${j.from} -> ${j.to}  x${j.jump.toFixed(4)}${Math.abs(Math.log(j.jump)) > 0.05 ? "   *** STEP ***" : ""}`);
  }
}

async function main() {
  const symbol = arg("symbol", "XAUUSD");

  const h1 = await brokerH1(symbol);
  if (h1.length < 100) throw new Error(`${symbol}: only ${h1.length} H1 bars — run probe-xau-data.mts first`);
  const daily = toDaily(h1);
  console.log(
    `${symbol}: ${h1.length} H1 bars -> ${daily.length} UTC daily bars  ` +
    `${iso(daily[0].t)} -> ${iso(daily[daily.length - 1].t)}  isDailySeries=${isDailySeries(daily)}`,
  );

  const from = daily[0].t, to = daily[daily.length - 1].t + DAY;

  // GC=F — COMEX front-month gold. Same asset, plus a futures basis that drifts
  // slowly and cannot produce a step.
  try {
    report("vs GC=F (Yahoo, explicit period1/period2)", align(daily, await yahooDaily("GC=F", from, to)));
  } catch (e) {
    console.log(`\nvs GC=F: FAILED ${e instanceof Error ? e.message : e}`);
  }

  // GLD — the ETF, ~1/10 an ounce and shrinking with expenses. Only reaches back
  // to Alpaca's 2016 inception, so this is a check on the recent half only.
  try {
    const gld = await fetchAlpacaCandles("GLD", "max", "1d");
    report("vs GLD (Alpaca SIP, adjustment=all)", align(daily, gld.candles));
  } catch (e) {
    console.log(`\nvs GLD: FAILED ${e instanceof Error ? e.message : e}`);
  }

  console.log(
    "\nReminder for whatever gets written from this: the broker is both the " +
    "counterparty and the price source, and spot gold has no consolidated tape. " +
    "Passing here means no splice was found, not that the feed was verified.",
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
