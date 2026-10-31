import { test } from "node:test";
import assert from "node:assert/strict";
import type { FilingHit } from "@/lib/riskSentry/filingWatch";
import type { TvRow } from "./types";
import {
  activityScore,
  atrPct,
  earningsTag,
  gapFor,
  passesBase,
  SCAN_SCORE_FORMULA,
  triggersFor,
  volumeFor,
} from "./filter";

const DATES = { session: "2026-10-30", previous: "2026-10-29" };
// Noon New York (EDT, UTC-4) on the given 2026-10 day, in epoch seconds.
const noonEt = (day: number): number => Date.UTC(2026, 9, day, 16, 0) / 1000;

function row(over: Partial<TvRow> = {}): TvRow {
  return {
    ticker: "TEST",
    exchange: "NASDAQ",
    type: "stock",
    close: 100,
    changePct: 1,
    gapPct: 1,
    premarketChangePct: 1,
    premarketVolume: 10_000,
    rvolIntraday: 1,
    rvol10d: 1,
    avgVolume10d: 2_000_000,
    atr: 3,
    earningsLastAt: null,
    earningsLastTime: null,
    earningsNextAt: null,
    earningsNextTime: null,
    ...over,
  };
}

function filing(tier: "red" | "notable"): FilingHit {
  return {
    ticker: "TEST",
    form: "8-K",
    acceptedAt: "2026-10-30T12:00:00Z",
    items: [{ code: "1.03", label: "x", tier }],
    tier,
    url: "https://example.com",
  };
}

test("base filter rejects cheap, illiquid and sleepy names, keeps an expensive one", () => {
  assert.equal(passesBase(row({ close: 4, atr: 0.2 })), false); // price 4
  assert.equal(passesBase(row({ avgVolume10d: 500_000 })), false);
  assert.equal(passesBase(row({ close: 100, atr: 1.0 })), false); // ATR% 1.0
  assert.equal(passesBase(row({ type: "fund" })), false);
  assert.equal(passesBase(row({ avgVolume10d: null })), false);
  assert.equal(passesBase(row({ atr: null })), false);
  // $900 stock, ATR% 2, 2M volume: no upper price bound.
  const big = row({ close: 900, atr: 18, avgVolume10d: 2_000_000 });
  assert.equal(atrPct(big), 2);
  assert.equal(passesBase(big), true);
});

test("null fields fail their trigger without throwing", () => {
  const r = row({
    gapPct: null,
    premarketChangePct: null,
    premarketVolume: null,
    rvolIntraday: null,
    rvol10d: null,
  });
  assert.deepEqual(triggersFor(r, "pre", null), []);
  assert.deepEqual(triggersFor(r, "open", null), []);
  assert.deepEqual(triggersFor(r, "closed", null), []);
  assert.equal(volumeFor(r, "pre").value, null);
  assert.equal(volumeFor(r, "open").value, null);
  assert.equal(gapFor(r, "pre"), null);
  const score = activityScore(null, volumeFor(r, "pre"), null, []);
  assert.ok(Number.isFinite(score));
  assert.equal(score, 0);
  // zero average volume must not become Infinity/NaN
  assert.equal(volumeFor(row({ avgVolume10d: 0 }), "pre").value, null);
  assert.equal(atrPct(row({ close: 0 })), null);
});

test("pre-market uses pre-market numbers, the session uses the open gap and intraday rvol", () => {
  const r = row({
    gapPct: 2.5,
    premarketChangePct: -3.5,
    premarketVolume: 80_000,
    avgVolume10d: 2_000_000,
    rvolIntraday: 4,
    rvol10d: 1.5,
  });
  assert.equal(gapFor(r, "pre"), -3.5);
  assert.equal(gapFor(r, "open"), 2.5);
  assert.equal(gapFor(r, "closed"), 2.5);
  assert.deepEqual(volumeFor(r, "pre"), { kind: "premarketPct", value: 4 });
  assert.deepEqual(volumeFor(r, "open"), { kind: "rvol", value: 4 });
  assert.deepEqual(volumeFor(r, "closed"), { kind: "rvol", value: 1.5 });
});

test("earnings tags", () => {
  // last report on `previous` after the close -> reported
  assert.equal(
    earningsTag(row({ earningsLastAt: noonEt(29), earningsLastTime: 1 }), DATES),
    "reported",
  );
  // last report on `session` before the open -> reported
  assert.equal(
    earningsTag(row({ earningsLastAt: noonEt(30), earningsLastTime: -1 }), DATES),
    "reported",
  );
  // unknown time on the session date counts as reported
  assert.equal(
    earningsTag(row({ earningsLastAt: noonEt(30), earningsLastTime: 0 }), DATES),
    "reported",
  );
  // `previous` before the open was the previous session's own news -> not tagged
  assert.equal(
    earningsTag(row({ earningsLastAt: noonEt(29), earningsLastTime: -1 }), DATES),
    null,
  );
  // next on `session` after the close -> tonight
  assert.equal(
    earningsTag(row({ earningsNextAt: noonEt(30), earningsNextTime: 1 }), DATES),
    "tonight",
  );
  // next on `session` before the open, last a month ago -> nothing
  assert.equal(
    earningsTag(
      row({
        earningsNextAt: noonEt(30),
        earningsNextTime: -1,
        earningsLastAt: noonEt(30) - 30 * 86_400,
        earningsLastTime: 1,
      }),
      DATES,
    ),
    null,
  );
  assert.equal(earningsTag(row(), DATES), null);
});

test("earnings tonight alone never qualifies", () => {
  const r = row({ gapPct: 0.5, premarketChangePct: 0.5, rvolIntraday: 1, rvol10d: 1 });
  assert.deepEqual(triggersFor(r, "open", "tonight"), []);
  assert.deepEqual(triggersFor(r, "pre", "tonight"), []);
});

test("triggers fire at the pre-registered thresholds", () => {
  assert.deepEqual(triggersFor(row({ gapPct: -2 }), "open", null), ["gap"]);
  assert.deepEqual(triggersFor(row({ gapPct: 1.99 }), "open", null), []);
  assert.deepEqual(triggersFor(row({ rvolIntraday: 2 }), "open", null), ["volume"]);
  // pre-market volume: 3% of a 2M average = 60k shares
  assert.deepEqual(
    triggersFor(row({ premarketVolume: 60_000, premarketChangePct: 0 }), "pre", null),
    ["volume"],
  );
  assert.deepEqual(
    triggersFor(row({ premarketVolume: 59_000, premarketChangePct: 0 }), "pre", null),
    [],
  );
  assert.deepEqual(
    triggersFor(row({ gapPct: 5, rvolIntraday: 3 }), "open", "reported"),
    ["gap", "volume", "earnings"],
  );
});

test("score is the documented sum", () => {
  const vol = { kind: "rvol" as const, value: 3 };
  assert.equal(activityScore(-4, vol, "reported", [filing("red")]), 4 + 3 + 3 + 2);
  // red beats notable, notable alone is 1, not additive
  assert.equal(activityScore(0, vol, null, [filing("notable"), filing("red")]), 3 + 2);
  assert.equal(activityScore(0, vol, null, [filing("notable")]), 3 + 1);
  // volume points are capped at 10 for both metrics
  assert.equal(activityScore(null, { kind: "rvol", value: 50 }, null, []), 10);
  assert.equal(activityScore(null, { kind: "premarketPct", value: 50 }, null, []), 10);
  assert.equal(activityScore(null, { kind: "premarketPct", value: 8 }, null, []), 4);
  // tonight adds nothing
  assert.equal(activityScore(1, vol, "tonight", []), 1 + 3);
});

test("score formula is a Thai one-liner", () => {
  assert.ok(/[฀-๿]/.test(SCAN_SCORE_FORMULA));
  assert.ok(!SCAN_SCORE_FORMULA.includes("\n"));
});
