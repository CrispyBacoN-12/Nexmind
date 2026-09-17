import "dotenv/config"; // mechanisms.ts reaches prisma through engine.ts -> scanner.ts, which constructs a client at module scope — same reason panelRun.test.ts does this
import { test } from "node:test";
import assert from "node:assert/strict";
import { XAU_MECHANISMS, XAU_HYPOTHESES, ALL_MECHANISMS, MECHANISMS, mechanismByKey } from "./mechanisms";
import type { Candle } from "@/lib/indicators";

// H1 bars starting at Monday 2026-09-07 00:00 UTC, so bar index === hour for the
// first day. Timestamps are unix SECONDS, which is what every Candle in this
// project carries and what the rules' hour extraction depends on.
const START = Date.UTC(2026, 8, 7) / 1000;
const HOUR = 3600;

function bars(closes: number[], band = 0.5): Candle[] {
  return closes.map((c, i) => ({
    t: START + i * HOUR,
    o: c,
    h: c + band,
    l: c - band,
    c,
    v: 1000,
  }));
}

test("the fixture's bar index is its UTC hour", () => {
  const b = bars([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(b.map((x) => new Date(x.t * 1000).getUTCHours()), [0, 1, 2, 3, 4, 5, 6, 7]);
});

/** 20 flat bars at 100 with the bar at `at` closing at `close`. */
function withSessionBar(at: number, close: number): Candle[] {
  const closes = Array(20).fill(100);
  closes[at] = close;
  return bars(closes);
}

const sessionBreak = mechanismByKey("xau-session-break").rule!;
const asiaFade = mechanismByKey("xau-asia-fade").rule!;
const dailyTrend = mechanismByKey("xau-daily-trend").rule!;

test("session-break fires only on the London and NY bars", () => {
  // The claim under test is intraday seasonality. A rule that also fired at
  // 03:00 would be testing "breakouts", which is a different hypothesis and is
  // not one of the four.
  for (let h = 0; h < 20; h++) {
    const verdict = sessionBreak(withSessionBar(h, 101))(h);
    assert.equal(verdict, h === 7 || h === 13 ? "long" : null, `hour ${h}`);
  }
});

test("session-break takes the direction of the break, and stands aside inside the range", () => {
  assert.equal(sessionBreak(withSessionBar(7, 101))(7), "long");
  assert.equal(sessionBreak(withSessionBar(7, 99))(7), "short");
  assert.equal(sessionBreak(withSessionBar(7, 100))(7), null); // inside 99.5-100.5
  assert.equal(sessionBreak(withSessionBar(7, 100.5))(7), null); // exactly at the high is not a break
});

test("asia-fade is the exact sign mirror of session-break, at the London bar only", () => {
  // The pair IS the measurement: if both rows beat their own controls, the
  // control is what is wrong, not the market.
  for (const close of [101, 99, 100]) {
    const s = sessionBreak(withSessionBar(7, close))(7);
    const f = asiaFade(withSessionBar(7, close))(7);
    assert.equal(f, s === null ? null : s === "long" ? "short" : "long");
  }
  // Silent at 13:00: the six bars before it are the London morning, not the
  // Asian session, so fading them would make the pair not a mirror.
  assert.equal(sessionBreak(withSessionBar(13, 101))(13), "long");
  assert.equal(asiaFade(withSessionBar(13, 101))(13), null);
});

test("a session rule stands aside when the six prior hours are not in the cache", () => {
  // A cache whose first bar is not midnight — which is the normal shape, since
  // the broker's history starts wherever it starts. The 07:00 bar is then near
  // the front of the array with fewer than six bars behind it, and the rule must
  // decline rather than compare against a partial range.
  const closes = Array(12).fill(100);
  closes[2] = 101; // index 2 is 07:00 when the series opens at 05:00
  const late = closes.map((c, i) => ({
    t: START + (5 + i) * HOUR, o: c, h: c + 0.5, l: c - 0.5, c, v: 1000,
  }));
  assert.equal(new Date(late[2].t * 1000).getUTCHours(), 7);
  assert.equal(sessionBreak(late)(2), null);
  assert.equal(asiaFade(late)(2), null);
});

/** 600 hourly bars: flat at 100, then a run of `step` per bar from index 500. */
function trending(step: number): Candle[] {
  return bars(Array.from({ length: 600 }, (_, i) => (i < 500 ? 100 : 100 + (i - 499) * step)));
}

test("daily-trend needs both the 20-day mean and the one-day breakout to agree", () => {
  const up = trending(1);
  assert.equal(dailyTrend(up)(560), "long");

  const down = trending(-1);
  assert.equal(dailyTrend(down)(560), "short");

  // Above the mean but not breaking out: the trend alone is not a signal, or
  // this would be a filter on nothing.
  const flatAfterRise = bars([
    ...Array.from({ length: 500 }, () => 100),
    ...Array.from({ length: 60 }, () => 150),
    ...Array.from({ length: 40 }, () => 150),
  ]);
  assert.equal(dailyTrend(flatAfterRise)(560), null);
});

test("daily-trend is silent until its 480-bar mean exists", () => {
  const up = trending(1);
  assert.equal(dailyTrend(up)(400), null);
  assert.equal(dailyTrend(up)(478), null);
});

test("no gold rule reads a bar it could not have seen", () => {
  // Truncating the series immediately after the decision bar must not change
  // the decision. This is the property the whole pre-registration rests on and
  // the one an indicator helper can silently break.
  const series: Candle[] = [...trending(1)];
  for (const m of XAU_MECHANISMS) {
    for (const i of [7, 13, 500, 560, 599]) {
      const full = m.rule!(series)(i);
      const truncated = m.rule!(series.slice(0, i + 1))(i);
      assert.equal(truncated, full, `${m.key} at bar ${i} depends on bars after it`);
    }
  }
});

test("the gold rules are kept out of the equity screen's row set", () => {
  // MECHANISMS is the population the equity multiple-testing argument was
  // written against. Three rules that can only fire on intraday UTC bars must
  // not enlarge it by being appended.
  const equity = new Set(MECHANISMS.map((m) => m.key));
  assert.ok(XAU_MECHANISMS.every((m) => !equity.has(m.key)));
  assert.equal(ALL_MECHANISMS.length, MECHANISMS.length + XAU_MECHANISMS.length);
});

test("mechanismByKey resolves across both name spaces and names the alternatives when it cannot", () => {
  assert.equal(mechanismByKey("xau-asia-fade").key, "xau-asia-fade");
  assert.equal(mechanismByKey("baseline").key, "baseline");
  assert.throws(() => mechanismByKey("nope"), /xau-asia-fade/);
});

test("mr-down3 reaches the gold screen unchanged, not as a translation", () => {
  const mr = XAU_HYPOTHESES[0];
  assert.equal(mr.key, "mr-down3");
  assert.equal(mr, mechanismByKey("mr-down3"));
  // Three consecutive lower closes, on hourly bars, with no parameter to move.
  const down = bars([105, 104, 103, 102, 103]);
  assert.equal(mr.rule!(down)(3), "long");
  assert.equal(mr.rule!(down)(4), null);
});
