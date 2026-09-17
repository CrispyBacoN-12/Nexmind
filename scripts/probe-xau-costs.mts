// Phase 1 — measure what this broker actually charges to trade gold.
//
// Why this is a probe and not a constant: DEFAULT_COST_MODEL (0.5bps slippage
// + 1bp commission, engine.ts:99) carries a comment saying it was calibrated
// from an MT5 gold account, and nobody has re-derived it since. The stocks work
// then measured that moving 0.5bps -> 5bps shifts fold avgR by ~0.03R, which is
// the size of every effect this project has ever hunted. An assumed cost is not
// a rounding error here; on this instrument it is most of the answer.
//
// Two things this prints that a broker's fee page cannot:
//
//   1. Cost in R, not bps. A cost only means something against the stop it is
//      paid over, and an H1 gold stop is a fraction of a daily equity one. In
//      bps 35 points looks negligible (0.79); against a 1.5xATR H1 stop it is
//      ~0.06R, which is larger than the effect size the gate is built to find.
//   2. p90 and p99 by hour, not "typical". Plan D4 pre-registers that the gate
//      must pass at the p90 cost level, and D4's session filter is a claim about
//      specific hours. An advertised "from 0.1" spread answers neither.
//
// The profile ACCUMULATES across runs into
// .cache/xau/spread-profile-<server>.json, keyed by (day-of-week x hour),
// because a spread profile is a claim about a week and one run sees minutes of
// it. Percentiles are kept as an exact integer histogram of spread-in-points
// rather than a sample, so merging runs cannot drift and the file stays small.
//
// One file per server, and it refuses to mix: comparing Standard against Raw
// means two profiles, never one averaged profile that describes neither.
//
// Usage:
//   npx tsx scripts/probe-xau-costs.mts             one sample, then report
//   npx tsx scripts/probe-xau-costs.mts --watch     sample until stopped
//   npx tsx scripts/probe-xau-costs.mts --report    print the saved file only
//   --interval=15  minutes between passes in --watch
//   --minutes=20   how much tick history each pass asks for
// Which broker is chosen by MT5_TERMINAL_PATH on the bridge, not here.

import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { fetchMt5Account, fetchMt5Symbols, fetchMt5Ticks, fetchMt5CandleRange } from "@/lib/mt5";
import { atr } from "@/lib/indicators";

const SYMBOL = process.env.XAU_SYMBOL ?? "XAUUSD";
const SL_MULT = 1.5; // the multiple the engine sizes its stop at
const ATR_PERIOD = 14;
const ATR_LOOKBACK_DAYS = 365;
const DEFAULT_INTERVAL_MIN = 15;
// Ask for a little more history than the gap between passes, so a pass that
// runs late cannot leave a hole. lastTickT makes the overlap free.
const OVERLAP_MIN = 5;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, dflt: number) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : dflt;
};

interface Bucket {
  n: number;
  /** spread in whole points -> how many ticks showed it */
  hist: Record<string, number>;
}

interface Profile {
  server: string;
  tradeMode: string;
  symbol: string;
  point: number;
  digits: number;
  contractSize: number;
  tickValue: number;
  tickSize: number;
  volumeMin: number;
  volumeStep: number;
  swapLong: number;
  swapShort: number;
  swapMode: number;
  swapRollover3Days: number;
  tradeStopsLevel: number;
  firstSampleAt: number;
  lastSampleAt: number;
  /** Highest tick timestamp already counted, so a re-run cannot double-count. */
  lastTickT: number;
  ticksSeen: number;
  priceSum: number;
  /** key `${dayOfWeek}-${hour}`, both UTC, dayOfWeek 0 = Sunday. */
  buckets: Record<string, Bucket>;
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");

function load(path: string): Profile | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Profile) : null;
}

function save(path: string, p: Profile) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(p, null, 2));
}

/** Exact percentile off the integer histogram; null on an empty bucket. */
function pct(hist: Record<string, number>, q: number): number | null {
  const keys = Object.keys(hist).map(Number).sort((a, b) => a - b);
  const total = keys.reduce((s, k) => s + hist[String(k)], 0);
  if (total === 0) return null;
  const target = q * total;
  let seen = 0;
  for (const k of keys) {
    seen += hist[String(k)];
    if (seen >= target) return k;
  }
  return keys[keys.length - 1];
}

function mergeHist(into: Record<string, number>, from: Record<string, number>) {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
}

/** One sampling pass: pull recent ticks, fold them into the profile. */
async function sample(p: Profile, minutes: number): Promise<number> {
  let ticks;
  try {
    ({ ticks } = await fetchMt5Ticks(p.symbol, minutes));
  } catch (e) {
    // A closed market has no ticks. That is a fact about the week, not a
    // failure — record nothing and say so rather than abort a multi-day run.
    console.log(`  no ticks (${e instanceof Error ? e.message : e}) — market closed or feed idle`);
    return 0;
  }
  let added = 0;
  for (const t of ticks) {
    if (t.t <= p.lastTickT) continue; // counted on an earlier pass
    if (!(t.ask > 0) || !(t.bid > 0)) continue;
    const spreadPts = Math.round((t.ask - t.bid) / p.point);
    if (spreadPts < 0) continue; // crossed book: a feed artifact, not a cost
    const d = new Date(t.t * 1000);
    const b = (p.buckets[`${d.getUTCDay()}-${d.getUTCHours()}`] ??= { n: 0, hist: {} });
    b.n += 1;
    b.hist[String(spreadPts)] = (b.hist[String(spreadPts)] ?? 0) + 1;
    p.priceSum += (t.ask + t.bid) / 2;
    p.ticksSeen += 1;
    if (t.t > p.lastTickT) p.lastTickT = t.t;
    added += 1;
  }
  p.lastSampleAt = Math.floor(Date.now() / 1000);
  return added;
}

/**
 * Median 1.5xATR H1 stop in dollars — the denominator that turns a spread into
 * R. Read off the same instrument and timeframe the plan trades (D2), because
 * a cost expressed against someone else's stop is not this venue's cost.
 */
async function medianStop(): Promise<{ stop: number; bars: number }> {
  const now = Math.floor(Date.now() / 1000);
  const { candles } = await fetchMt5CandleRange(SYMBOL, "H1", now - ATR_LOOKBACK_DAYS * 86400, now);
  const stops = atr(candles, ATR_PERIOD)
    .filter((v): v is number => v != null && v > 0)
    .map((v) => SL_MULT * v)
    .sort((x, y) => x - y);
  if (stops.length === 0) throw new Error("no ATR available — cannot express cost in R");
  return { stop: stops[Math.floor(stops.length / 2)], bars: candles.length };
}

const HOUR_NOTES: Record<number, string> = {
  7: "London open",
  13: "NY open / US data",
  14: "NY cash",
  21: "rollover",
  22: "Asia thin",
};

function report(p: Profile, stop: number, bars: number) {
  const avgPrice = p.priceSum / Math.max(1, p.ticksSeen);
  const usd = (pts: number) => pts * p.point;
  const bps = (pts: number) => (usd(pts) / avgPrice) * 1e4;
  const inR = (pts: number) => usd(pts) / stop;

  console.log(`\n=== ${p.symbol} cost profile — ${p.server} [${p.tradeMode}] ===`);
  console.log(
    `ticks ${p.ticksSeen.toLocaleString()} over ` +
      `${new Date(p.firstSampleAt * 1000).toISOString().slice(0, 16)} -> ` +
      `${new Date(p.lastSampleAt * 1000).toISOString().slice(0, 16)}, avg mid $${avgPrice.toFixed(2)}`,
  );
  console.log(
    `R denominator: median ${SL_MULT}xATR(${ATR_PERIOD}) H1 stop = $${stop.toFixed(2)} ` +
      `(${bars.toLocaleString()} bars, last ${ATR_LOOKBACK_DAYS}d)`,
  );

  // The contract spec has to be internally consistent before any of the money
  // arithmetic below means anything: for a USD-quoted, USD-profit symbol,
  // contractSize x tickSize should equal tickValue. MetaQuotes-Demo reports
  // contract 100 with tickValue 0.1, which disagree by 10x — and a 10x error in
  // cost per ounce moves the commission break-even from 6 points to 60.
  const implied = p.contractSize * p.tickSize;
  const ratio = p.tickValue > 0 ? implied / p.tickValue : NaN;
  console.log(
    `contract ${p.contractSize} x tickSize ${p.tickSize} = ${implied} vs tickValue ${p.tickValue}` +
      (Math.abs(ratio - 1) < 0.01
        ? "  OK"
        : `  *** INCONSISTENT by ${ratio.toFixed(1)}x — cost per ounce is unresolved, ` +
          `every dollar figure below inherits it ***`),
  );
  console.log(
    `stops level ${p.tradeStopsLevel}pt = $${usd(p.tradeStopsLevel).toFixed(2)}` +
      (p.tradeStopsLevel > 0 && usd(p.tradeStopsLevel) >= stop
        ? "  *** wider than the median stop — the rule cannot be placed here at all ***"
        : "  (inside the median stop)"),
  );
  console.log(
    `min volume ${p.volumeMin} step ${p.volumeStep} -> smallest risk at the median stop = ` +
      `$${(stop * p.contractSize * p.volumeMin).toFixed(2)}/trade`,
  );
  console.log(
    `swap long ${p.swapLong} / short ${p.swapShort} per lot per night ` +
      `(mode ${p.swapMode}, charged x3 on weekday ${p.swapRollover3Days})`,
  );

  const all: Record<string, number> = {};
  for (const b of Object.values(p.buckets)) mergeHist(all, b.hist);

  console.log(`\noverall spread (one full spread = one round trip: buy the ask, sell the bid):`);
  for (const q of [0.5, 0.9, 0.99]) {
    const pts = pct(all, q);
    if (pts == null) continue;
    console.log(
      `  p${String(q * 100).padStart(2)}  ${String(pts).padStart(4)}pt  ` +
        `$${usd(pts).toFixed(2)}  ${bps(pts).toFixed(3)} bps  ${inR(pts).toFixed(4)} R`,
    );
  }

  console.log(`\nby hour (UTC), weekdays pooled — the column XAU_SESSION_FILTER is declared from:`);
  console.log(`  hh        n   p50pt  p90pt  p99pt    p50 R    p90 R   note`);
  for (let h = 0; h < 24; h++) {
    const hist: Record<string, number> = {};
    let n = 0;
    for (let d = 0; d < 7; d++) {
      const b = p.buckets[`${d}-${h}`];
      if (b) {
        mergeHist(hist, b.hist);
        n += b.n;
      }
    }
    const hh = String(h).padStart(2, "0");
    if (n === 0) {
      console.log(`  ${hh}        —      (no samples yet)              ${HOUR_NOTES[h] ?? ""}`);
      continue;
    }
    const p50 = pct(hist, 0.5)!;
    const p90 = pct(hist, 0.9)!;
    const p99 = pct(hist, 0.99)!;
    console.log(
      `  ${hh}  ${String(n).padStart(7)}  ${String(p50).padStart(6)} ${String(p90).padStart(6)} ` +
        `${String(p99).padStart(6)}   ${inR(p50).toFixed(4)}   ${inR(p90).toFixed(4)}   ${HOUR_NOTES[h] ?? ""}`,
    );
  }

  const covered = Object.keys(p.buckets).length;
  console.log(`\ncoverage: ${covered}/168 (day x hour) cells have samples.`);
  if (covered < 120) {
    console.log(
      `  NOT ENOUGH to pre-register XAU_SESSION_FILTER — keep --watch running. A filter fitted to`,
    );
    console.log(`  partial coverage is a filter fitted to whenever this script happened to be running.`);
  }
  console.log(`\nRead the R column, not the bps column: cost is only meaningful against the stop it is`);
  console.log(`paid over, and these are H1 stops. To compare a commission account against a spread-only`);
  console.log(`one, the break-even is (commission per lot, round turn) / (contract size), in points —`);
  console.log(`the commission account wins whenever the spread-only account is wider than that.`);
}

// --- main ---------------------------------------------------------------

const account = await fetchMt5Account();
if (account.server === "unknown") {
  // A spread profile is a measurement OF a venue; unlabelled it is worthless,
  // and worse, it would be silently merged into whichever file was there.
  throw new Error("bridge did not report a server — restart it so the profile can be labelled");
}
const spec = (await fetchMt5Symbols(SYMBOL)).find((s) => s.name === SYMBOL);
if (!spec) throw new Error(`${SYMBOL} not found on ${account.server}`);

const path = `.cache/xau/spread-profile-${safe(account.server)}.json`;
const now = Math.floor(Date.now() / 1000);
const profile: Profile = load(path) ?? {
  server: account.server,
  tradeMode: account.tradeMode,
  symbol: SYMBOL,
  point: spec.point,
  digits: spec.digits,
  contractSize: spec.tradeContractSize,
  tickValue: spec.tradeTickValue,
  tickSize: spec.tradeTickSize,
  volumeMin: spec.volumeMin,
  volumeStep: spec.volumeStep,
  swapLong: spec.swapLong,
  swapShort: spec.swapShort,
  swapMode: spec.swapMode,
  swapRollover3Days: spec.swapRollover3Days,
  tradeStopsLevel: spec.tradeStopsLevel,
  firstSampleAt: now,
  lastSampleAt: now,
  lastTickT: 0,
  ticksSeen: 0,
  priceSum: 0,
  buckets: {},
};

// Refuse to pour a second broker's ticks into an existing profile rather than
// silently averaging two venues into one file that describes neither.
if (profile.server !== account.server) {
  throw new Error(`profile at ${path} is ${profile.server}, terminal is on ${account.server}`);
}

if (!flag("report")) {
  const interval = opt("interval", DEFAULT_INTERVAL_MIN);
  // The bridge caps /ticks at 120 minutes and times out at 4s, so a pass asks
  // for a window it can actually answer within.
  const minutes = Math.min(120, Math.max(1, opt("minutes", interval + OVERLAP_MIN)));
  console.log(
    `sampling ${SYMBOL} on ${account.server} [${account.tradeMode}] — ${minutes}m of ticks per pass` +
      (flag("watch") ? `, every ${interval}m until stopped` : ""),
  );
  for (;;) {
    const added = await sample(profile, minutes);
    save(path, profile);
    console.log(
      `  ${new Date().toISOString().slice(0, 16)}  +${added} ticks  ` +
        `total ${profile.ticksSeen.toLocaleString()}  -> ${path}`,
    );
    if (!flag("watch")) break;
    await new Promise((r) => setTimeout(r, interval * 60_000));
  }
}

const { stop, bars } = await medianStop();
report(profile, stop, bars);
