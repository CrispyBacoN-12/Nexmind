import { test } from "node:test";
import assert from "node:assert/strict";
import {
  screenBars,
  MIN_DAILY_RATIO,
  MAX_DAILY_RATIO,
  MAX_ZERO_VOLUME_SHARE,
  MAX_MEDIAN_SPACING_DAYS,
} from "./dataQuality";
import type { Candle } from "@/lib/indicators";

const DAY = 86_400;
const T0 = Date.UTC(2026, 0, 5) / 1000; // Monday 2026-01-05, fixed — no clock reads.

/** Build a series from closes; volume defaults to a plausible non-zero value. */
function series(closes: number[], volumes?: number[], stepDays = 1): Candle[] {
  return closes.map((c, i) => ({
    t: T0 + i * stepDays * DAY,
    o: c, h: c, l: c, c,
    v: volumes ? volumes[i] : 1_000_000,
  }));
}

test("an unadjusted split excludes the whole symbol, not just the split month", () => {
  // KLAC's real shape: Alpaca reports 2411.64 -> 254.54 on 2026-06-12 even with
  // adjustment=all, while Yahoo's adjclose shows a smooth 241.16 -> 254.54.
  const bars = new Map([
    ["KLAC", series([2135.64, 2411.64, 254.54, 260.1, 258.3])],
    ["MSFT", series([100, 101, 99, 102, 103])],
  ]);
  const { kept, excluded } = screenBars(bars);

  assert.deepEqual([...kept.keys()], ["MSFT"]);
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].symbol, "KLAC");
  assert.equal(excluded[0].reason, "discontinuity");
  // The whole history goes, because a 252-day lookback crossing that bar is
  // wrong for a year of rebalances, not for one month.
  assert.equal(kept.has("KLAC"), false);
});

test("the exclusion detail names the offending bar so a reader can check it by hand", () => {
  const { excluded } = screenBars(new Map([["KLAC", series([2411.64, 254.54, 260.1])]]));
  const { detail } = excluded[0];
  assert.match(detail, /2411\.64 -> 254\.54/);
  assert.match(detail, /2026-01-06/, "names the date of the second bar");
  assert.match(detail, /-89\.4%/);
});

test("the worst discontinuity is reported, not merely the first", () => {
  // A 3x followed by a 20:1 split: the split is the one worth naming.
  const { excluded } = screenBars(new Map([["X", series([10, 30, 30, 1.5])]]));
  assert.match(excluded[0].detail, /30\.00 -> 1\.50/);
});

test("moves inside the bounds are kept, including the bounds themselves", () => {
  // Exactly 2x and exactly 0.5x are legal; the screen must not clip real
  // volatility one tick beyond a genuine event.
  const bars = new Map([["X", series([100, 100 * MAX_DAILY_RATIO, 100, 100 * MIN_DAILY_RATIO])]]);
  const { kept, excluded } = screenBars(bars);
  assert.equal(excluded.length, 0);
  assert.equal(kept.size, 1);
});

test("a move just outside the bounds is excluded", () => {
  const over = screenBars(new Map([["X", series([100, 100 * MAX_DAILY_RATIO + 0.01])]]));
  assert.equal(over.excluded[0]?.reason, "discontinuity");
  const under = screenBars(new Map([["Y", series([100, 100 * MIN_DAILY_RATIO - 0.01])]]));
  assert.equal(under.excluded[0]?.reason, "discontinuity");
});

test("a mostly dead series is excluded as a placeholder, not treated as prices", () => {
  // FI's shape: 3.15 at zero volume for years, then a real print when Fiserv
  // took the ticker. The price jump alone would catch this one, so the fixture
  // keeps prices flat to isolate the volume rule.
  const closes = Array.from({ length: 100 }, () => 50);
  const volumes = closes.map((_, i) => (i < 20 ? 0 : 1_000_000));
  const { kept, excluded } = screenBars(new Map([["FI", series(closes, volumes)]]));
  assert.equal(kept.size, 0);
  assert.equal(excluded[0].reason, "staleSeries");
  assert.match(excluded[0].detail, /20\/100/);
});

test("a few zero-volume bars are tolerated — holidays and halts are not defects", () => {
  const closes = Array.from({ length: 100 }, () => 50);
  const volumes = closes.map((_, i) => (i < 5 ? 0 : 1_000_000));
  assert.ok(5 / 100 < MAX_ZERO_VOLUME_SHARE);
  const { kept, excluded } = screenBars(new Map([["X", series(closes, volumes)]]));
  assert.equal(excluded.length, 0);
  assert.equal(kept.size, 1);
});

test("a non-positive close is excluded before any ratio is computed", () => {
  // A zero close would make the next day's ratio Infinity and the previous
  // day's return -100%; neither is a price.
  const { kept, excluded } = screenBars(new Map([["X", series([10, 0, 10])]]));
  assert.equal(kept.size, 0);
  assert.equal(excluded[0].reason, "nonPositiveClose");
  assert.match(excluded[0].detail, /2026-01-06/);
});

test("a weekly series is excluded from a daily study", () => {
  // DOW's real shape: 388 bars, every one a Monday. Its bars fell on 37 market
  // holidays, and one of them became a month-end rebalance date.
  const closes = Array.from({ length: 50 }, (_, i) => 30 + i * 0.1);
  const { kept, excluded } = screenBars(new Map([["DOW", series(closes, undefined, 7)]]));
  assert.equal(kept.size, 0);
  assert.equal(excluded[0].reason, "wrongInterval");
  assert.match(excluded[0].detail, /50 bars spaced 7\.0 days apart/);
});

test("weekends and holiday breaks do not make a daily series look weekly", () => {
  // Five sessions, then a three-day weekend, repeated. The median gap is 1.
  const t: number[] = [];
  for (let w = 0; w < 20; w++) for (let d = 0; d < 5; d++) t.push(T0 + (w * 7 + d) * DAY);
  const bars: Candle[] = t.map((ts, i) => ({ t: ts, o: 50, h: 50, l: 50, c: 50 + i * 0.01, v: 1_000_000 }));
  assert.ok(MAX_MEDIAN_SPACING_DAYS >= 1);
  const { kept, excluded } = screenBars(new Map([["X", bars]]));
  assert.equal(excluded.length, 0, excluded[0]?.detail);
  assert.equal(kept.size, 1);
});

test("an empty series is excluded rather than silently kept", () => {
  const { kept, excluded } = screenBars(new Map([["X", []]]));
  assert.equal(kept.size, 0);
  assert.equal(excluded[0].reason, "staleSeries");
  assert.equal(excluded[0].detail, "no bars");
});

test("kept preserves the original bars untouched and excluded is sorted by symbol", () => {
  const good = series([10, 11, 12]);
  const bars = new Map([
    ["ZZZ", series([100, 1])],
    ["AAA", series([100, 1])],
    ["GOOD", good],
  ]);
  const { kept, excluded } = screenBars(bars);
  assert.equal(kept.get("GOOD"), good, "the same array instance is passed through");
  assert.deepEqual(excluded.map((e) => e.symbol), ["AAA", "ZZZ"]);
});
