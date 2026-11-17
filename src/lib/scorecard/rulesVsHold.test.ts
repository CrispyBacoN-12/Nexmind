import test from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { etClock } from "@/lib/scanAgent/session";
import { rulesVsHoldSeries as build, type HoldTrade } from "./rulesVsHold";
import { rMultiple } from "./score";

function etEpoch(date: string, hhmm: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  for (const offset of [4, 5]) {
    const sec = Date.UTC(y, mo - 1, d, h + offset, mi) / 1000;
    const c = etClock(sec);
    if (c.date === date && c.minutes === h * 60 + mi) return sec;
  }
  throw new Error(`cannot resolve ${date} ${hhmm} ET`);
}

/** A daily bar as Alpaca stamps it: ET midnight of its session. */
const day = (date: string, c: number): Candle => ({ t: etEpoch(date, "00:00"), o: c, h: c, l: c, c, v: 1000 });
/** Long after every test date: every session counts as closed. */
const FAR = etEpoch("2027-01-04", "12:00");
/** No corporate action: the raw series is the adjusted one. */
const rulesVsHoldSeries = (trades: HoldTrade[], daily: Map<string, Candle[]>, cal: string) => build(trades, daily, daily, cal, FAR);
const spy = (...dates: string[]) => dates.map((d) => day(d, 500));

const trade = (over: Partial<HoldTrade> = {}): HoldTrade => ({
  ticker: "AAA",
  fill: 100,
  fillAt: etEpoch("2026-11-02", "10:35"),
  stop: 99,
  closedR: null,
  exitAt: null,
  ...over,
});

test("marks open trades at each close for both lines", () => {
  const daily = new Map([
    ["SPY", spy("2026-11-02", "2026-11-03")],
    ["AAA", [day("2026-11-02", 101), day("2026-11-03", 102)]],
  ]);
  assert.deepEqual(rulesVsHoldSeries([trade()], daily, "SPY"), [
    { date: "2026-11-02", rules: rMultiple(100, 101, 99), hold: rMultiple(100, 101, 99), n: 1 },
    { date: "2026-11-03", rules: rMultiple(100, 102, 99), hold: rMultiple(100, 102, 99), n: 1 },
  ]);
});

test("a closed trade is fixed at its R from its exit date in the rules line only", () => {
  const daily = new Map([
    ["SPY", spy("2026-11-02", "2026-11-03", "2026-11-04")],
    ["AAA", [day("2026-11-02", 101), day("2026-11-03", 102), day("2026-11-04", 97)]],
  ]);
  const pts = rulesVsHoldSeries([trade({ closedR: 1.5, exitAt: etEpoch("2026-11-03", "11:00") })], daily, "SPY");
  assert.equal(pts[0].rules, rMultiple(100, 101, 99));
  assert.equal(pts[1].rules, 1.5);
  assert.equal(pts[2].rules, 1.5);
  assert.equal(pts[2].hold, rMultiple(100, 97, 99));
});

test("forward-fills a missing close", () => {
  const daily = new Map([
    ["SPY", spy("2026-11-02", "2026-11-03")],
    ["AAA", [day("2026-11-02", 101)]],
  ]);
  const pts = rulesVsHoldSeries([trade()], daily, "SPY");
  assert.equal(pts.length, 2);
  assert.equal(pts[1].hold, rMultiple(100, 101, 99));
  assert.equal(pts[1].n, 1);
});

test("a trade with no bar at or after its fill date is left out", () => {
  const daily = new Map([
    ["SPY", spy("2026-11-02", "2026-11-03")],
    ["AAA", [day("2026-11-02", 101), day("2026-11-03", 102)]],
  ]);
  const pts = rulesVsHoldSeries([trade(), trade({ ticker: "GONE" })], daily, "SPY");
  assert.deepEqual(pts.map((p) => p.n), [1, 1]);
  assert.equal(pts[1].hold, rMultiple(100, 102, 99));
});

test("a trade joins on its own fill date; dates before any fill are omitted", () => {
  const daily = new Map([
    ["SPY", spy("2026-10-30", "2026-11-02", "2026-11-03")],
    ["AAA", [day("2026-10-30", 90), day("2026-11-02", 101), day("2026-11-03", 102)]],
    ["BBB", [day("2026-11-03", 51)]],
  ]);
  const late = trade({ ticker: "BBB", fill: 50, stop: 49, fillAt: etEpoch("2026-11-03", "10:40") });
  const pts = rulesVsHoldSeries([trade(), late], daily, "SPY");
  assert.deepEqual(pts.map((p) => [p.date, p.n]), [["2026-11-02", 1], ["2026-11-03", 2]]);
  assert.equal(pts[1].hold, rMultiple(100, 102, 99) + rMultiple(50, 51, 49));
});

test("no trades → []", () => {
  assert.deepEqual(rulesVsHoldSeries([], new Map([["SPY", spy("2026-11-02")]]), "SPY"), []);
});

test("a split after the fill: adjusted closes are marked in the fill's own price units", () => {
  // 2:1 split after 11-02: adjusted history is halved, raw shows the as-traded 101 then 51.
  const adjusted = new Map([
    ["SPY", spy("2026-11-02", "2026-11-03")],
    ["AAA", [day("2026-11-02", 50.5), day("2026-11-03", 51)]],
  ]);
  const raw = new Map([
    ["SPY", spy("2026-11-02", "2026-11-03")],
    ["AAA", [day("2026-11-02", 101), day("2026-11-03", 51)]],
  ]);
  const pts = build([trade()], adjusted, raw, "SPY", FAR);
  assert.equal(pts[0].hold, rMultiple(100, 101, 99));
  assert.equal(pts[1].hold, rMultiple(100, 102, 99));
});

test("a session not closed by the cutoff is left out (no partial daily bar)", () => {
  const daily = new Map([
    ["SPY", spy("2026-11-02", "2026-11-03")],
    ["AAA", [day("2026-11-02", 101), day("2026-11-03", 150)]],
  ]);
  const pts = build([trade()], daily, daily, "SPY", etEpoch("2026-11-03", "12:00"));
  assert.deepEqual(pts.map((p) => p.date), ["2026-11-02"]);
});
