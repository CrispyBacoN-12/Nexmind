// regime.ts is pure — no prisma, no network, no fs — so these run without DATABASE_URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import {
  buildRegimeSeries, realizedVol, regimeAt, labelRegime,
  TREND_PERIOD, VOL_PERIOD, type RegimeThresholds,
} from "./regime";

const DAY = 86_400;
const T0 = Date.parse("2020-01-01T00:00:00Z") / 1000;

/** Daily bars whose close is `closeAt(i)`. */
function bars(n: number, closeAt: (i: number) => number, t0 = T0): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = closeAt(i);
    return { t: t0 + i * DAY, o: c, h: c + 1, l: c - 1, c, v: 1000 };
  });
}

const rising = (n: number, t0 = T0) => bars(n, (i) => 100 + i, t0);
const falling = (n: number, t0 = T0) => bars(n, (i) => 1000 - i, t0);

const TH: RegimeThresholds = { breadthOn: 0.6, breadthOff: 0.4, volOff: null };

// ---- buildRegimeSeries ----

test("buildRegimeSeries throws when the benchmark is absent instead of returning nulls", () => {
  // A series of nulls does not fail the gate, it silently switches the gate off.
  // That is the one failure mode nobody would notice in a log.
  assert.throws(
    () => buildRegimeSeries({ AAPL: rising(300) }),
    /benchmark "SPY" is not in the bar map/,
  );
  assert.throws(() => buildRegimeSeries({ SPY: [] }), /is not in the bar map/);
});

test("buildRegimeSeries runs on the benchmark's calendar and marks trend against its own SMA200", () => {
  const series = buildRegimeSeries({ SPY: rising(300), AAPL: rising(300) });
  assert.equal(series.bars.length, 300);
  assert.equal(series.benchmark, "SPY");
  // Nothing has a 200-period average before bar 199.
  assert.equal(series.bars[TREND_PERIOD - 2].benchSma, null);
  assert.equal(series.bars[TREND_PERIOD - 2].benchAbove, null);
  assert.ok(series.bars[TREND_PERIOD - 1].benchSma != null);
  assert.equal(series.bars[299].benchAbove, true, "a monotonically rising close is above its own trailing mean");
  assert.equal(buildRegimeSeries({ SPY: falling(300) }).bars[299].benchAbove, false);
});

test("breadth counts members above their own SMA200, and excludes the benchmark from its own count", () => {
  // SPY sitting in the numerator would make breadth partly a restatement of the
  // trend leg, so the two features would agree by construction rather than by
  // observation.
  const series = buildRegimeSeries({
    SPY: rising(300),
    UP1: rising(300), UP2: rising(300), UP3: rising(300),
    DOWN1: falling(300),
  });
  const last = series.bars[299];
  assert.equal(last.breadthN, 4, "four members, benchmark excluded");
  assert.ok(Math.abs(last.breadth! - 0.75) < 1e-12);
});

test("breadth's denominator holds only the members that had enough history that session", () => {
  // A name that listed late did not participate. Counting it as a silent
  // below-trend zero would read as deteriorating breadth caused by a listing.
  const late = rising(300, T0 + 100 * DAY); // first bar 100 sessions in
  const series = buildRegimeSeries({ SPY: rising(500), EARLY: rising(500), LATE: late });
  // At session 250 the late name is only 150 bars old — short of TREND_PERIOD.
  assert.equal(series.bars[250].breadthN, 1);
  // By session 350 it is 250 bars old and joins the count.
  assert.equal(series.bars[350].breadthN, 2);
  // And once its history runs out it leaves again, rather than freezing at its
  // last known state — a delisted name is not a name below trend.
  assert.equal(series.bars[450].breadthN, 1);
});

test("a session no member traded has breadth null rather than 0", () => {
  // 0 means "every member is below trend", which is a market event. "No data"
  // is not, and the two must never share a value.
  const offCalendar = bars(300, (i) => 100 + i, T0 + 12 * 3600); // members half a day off
  const series = buildRegimeSeries({ SPY: rising(300), AAPL: offCalendar });
  assert.equal(series.bars[299].breadth, null);
  assert.equal(series.bars[299].breadthN, 0);
});

// ---- realizedVol ----

test("realizedVol is null until the window is full and annualizes a constant-drift series to ~0", () => {
  const v = realizedVol(bars(60, (i) => 100 * 1.001 ** i), VOL_PERIOD);
  assert.equal(v[VOL_PERIOD - 1], null, "one bar short of a full window is still null");
  assert.ok(v[VOL_PERIOD] != null);
  // Constant log return => zero dispersion => zero vol, regardless of the drift.
  assert.ok(Math.abs(v[59]!) < 1e-9, `constant-drift vol should be ~0, got ${v[59]}`);
});

test("realizedVol scales with dispersion and reports an annualized fraction", () => {
  // Alternating +/-1% daily has |log return| ~0.01, so annualized ~ 0.01*sqrt(252) ~ 0.159.
  const alt = bars(80, (i) => (i % 2 === 0 ? 100 : 101));
  const v = realizedVol(alt, VOL_PERIOD)[79]!;
  assert.ok(v > 0.1 && v < 0.25, `expected ~0.16 annualized, got ${v}`);
});

test("realizedVol refuses a non-positive close rather than logging it", () => {
  // Math.log(0) is -Infinity, which would propagate through every window that
  // touches the bad bar instead of costing just that one.
  const bad = bars(60, (i) => (i === 30 ? 0 : 100 + i));
  const v = realizedVol(bad, VOL_PERIOD);
  assert.ok(v.every((x) => x == null || Number.isFinite(x)), "no Infinity or NaN may survive");
  assert.equal(v[31], null, "the window containing the bad bar is dropped, not poisoned");
  assert.ok(v[59] != null, "windows past it recover");
});

test("realizedVol returns all nulls for a series too short to have a return", () => {
  assert.deepEqual(realizedVol([], 20), []);
  assert.deepEqual(realizedVol(bars(1, () => 100), 20), [null]);
});

// ---- regimeAt ----

test("regimeAt never returns a bar dated after the query — the whole point of the function", () => {
  // Reading tomorrow's breadth is how a gate scores a spectacular backtest and
  // nothing else. This is the test that would catch it.
  const series = buildRegimeSeries({ SPY: rising(300), AAPL: rising(300) });
  for (const probe of [0, 5, 150, 299]) {
    const t = series.bars[probe].t;
    assert.equal(regimeAt(series, t)!.t, t, "an exact session match returns itself");
    assert.ok(regimeAt(series, t + DAY - 1)!.t <= t + DAY - 1);
  }
  // A timestamp between two sessions resolves backwards, not forwards.
  const between = series.bars[100].t + 3600;
  assert.equal(regimeAt(series, between)!.t, series.bars[100].t);
});

test("regimeAt returns null before the series starts, and holds the last bar after it ends", () => {
  const series = buildRegimeSeries({ SPY: rising(300), AAPL: rising(300) });
  assert.equal(regimeAt(series, series.bars[0].t - 1), null, "no regime existed yet — not the first bar");
  assert.equal(regimeAt(series, series.bars[299].t + 365 * DAY)!.t, series.bars[299].t);
  assert.equal(regimeAt({ benchmark: "SPY", bars: [] }, T0), null);
});

// ---- labelRegime ----

const bar = (breadth: number | null, benchAbove: boolean | null, vol: number | null = null) =>
  ({ t: T0, benchClose: 100, benchSma: 99, benchAbove, breadth, breadthN: 400, realizedVol: vol });

test("labelRegime fails to unknown, never to risk-on", () => {
  // "Not enough history to check" and "checked and cleared" are different
  // claims. Defaulting an unchecked bar to risk-on would let the gate wave
  // through exactly the warm-up stretch it cannot see.
  assert.equal(labelRegime(null, TH), "unknown");
  assert.equal(labelRegime(bar(null, true), TH), "unknown");
  assert.equal(labelRegime(bar(0.8, null), TH), "unknown");
});

test("labelRegime cuts risk-on / neutral / risk-off at the given thresholds", () => {
  assert.equal(labelRegime(bar(0.7, true), TH), "risk-on");
  assert.equal(labelRegime(bar(0.6, true), TH), "risk-on", "breadthOn is inclusive");
  assert.equal(labelRegime(bar(0.7, false), TH), "neutral", "strong breadth under a broken benchmark is not risk-on");
  assert.equal(labelRegime(bar(0.5, true), TH), "neutral");
  assert.equal(labelRegime(bar(0.4, true), TH), "neutral", "breadthOff is exclusive");
  assert.equal(labelRegime(bar(0.39, true), TH), "risk-off");
});

test("the vol leg overrides breadth, and is off entirely when volOff is null", () => {
  const withVol: RegimeThresholds = { ...TH, volOff: 0.35 };
  assert.equal(labelRegime(bar(0.9, true, 0.40), withVol), "risk-off", "a vol spike outranks broad participation");
  assert.equal(labelRegime(bar(0.9, true, 0.35), withVol), "risk-off", "volOff is inclusive");
  assert.equal(labelRegime(bar(0.9, true, 0.20), withVol), "risk-on");
  // Missing vol must not be read as calm — but it also must not veto on its own.
  assert.equal(labelRegime(bar(0.9, true, null), withVol), "risk-on");
  assert.equal(labelRegime(bar(0.9, true, 0.99), TH), "risk-on", "volOff null disables the leg");
});
