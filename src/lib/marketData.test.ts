import "dotenv/config"; // marketData.ts -> webull.ts needs the Webull credentials from .env
import { test } from "node:test";
import assert from "node:assert/strict";
import { coversDays, isStale, maxBarAgeDays, providerOrder, sanitizeResponse, shouldTryAlpaca, shouldTryWebull } from "./marketData";

test("shouldTryAlpaca is true only when both key and secret are present", () => {
  assert.equal(shouldTryAlpaca({ ALPACA_KEY: "k", ALPACA_SECRET: "s" }), true);
  assert.equal(shouldTryAlpaca({ ALPACA_KEY: "k" }), false);
  assert.equal(shouldTryAlpaca({ ALPACA_SECRET: "s" }), false);
  assert.equal(shouldTryAlpaca({}), false);
});

test("shouldTryWebull is true only when both key and secret are present", () => {
  assert.equal(shouldTryWebull({ WEBULL_APP_KEY: "k", WEBULL_APP_SECRET: "s" }), true);
  assert.equal(shouldTryWebull({ WEBULL_APP_KEY: "k" }), false);
  assert.equal(shouldTryWebull({ WEBULL_APP_SECRET: "s" }), false);
  assert.equal(shouldTryWebull({}), false);
});

test("coversDays treats a truncated provider response as insufficient", () => {
  const day = 86400;
  const span = (days: number) => [{ t: 0 }, { t: days * day }];

  // The case that broke the blind-test gate: Webull caps every request at 1200
  // bars, so a 5y/1h request comes back as a valid, non-empty ~256-day series.
  // Nothing about the response says "truncated" — only its span does.
  assert.equal(coversDays(span(256), 400), false);
  assert.equal(coversDays(span(1826), 400), true);
  assert.equal(coversDays(span(400), 400), true, "exactly the requirement must pass");

  // minDays 0 is the default for every live scan caller: no depth requirement,
  // so any response (including an empty one) is the provider's answer and this
  // predicate must not start rejecting responses those callers accept today.
  assert.equal(coversDays([], 0), true);
  assert.equal(coversDays(span(1), 0), true);

  // An empty response can never cover a positive requirement.
  assert.equal(coversDays([], 400), false);
});

test("providerOrder puts Alpaca ahead of Webull and Yahoo last", () => {
  // Measured 2026-08-30: on the 2y daily overlap, Webull's closes disagree with
  // Alpaca's by more than 1% on 99.4% of SPY bars, 86.6% of AAPL's and 71.3% of
  // KO's, and its SPY series splices in a different instrument for 84% of its
  // length. Webull answered first and never threw, so Alpaca was never reached.
  assert.deepEqual(
    providerOrder({ ALPACA_KEY: "k", ALPACA_SECRET: "s", WEBULL_APP_KEY: "k", WEBULL_APP_SECRET: "s" }),
    ["alpaca", "webull", "yahoo"],
  );
});

test("providerOrder drops a provider whose credentials are missing, and always ends at Yahoo", () => {
  assert.deepEqual(providerOrder({ WEBULL_APP_KEY: "k", WEBULL_APP_SECRET: "s" }), ["webull", "yahoo"]);
  assert.deepEqual(providerOrder({ ALPACA_KEY: "k", ALPACA_SECRET: "s" }), ["alpaca", "yahoo"]);
  assert.deepEqual(providerOrder({}), ["yahoo"]);
});

test("sanitizeResponse drops placeholder bars from a live provider response", () => {
  // The live path's half of the fix behind panel.ts's sanitizeSeries: a 2y daily
  // Webull pull carries up to 181 frozen o=h=l=c bars (WMT), which is what SAGE
  // spends 5 of its 6 vetoes on.
  const real = (t: number, c: number) => ({ t, o: c, h: c + 1, l: c - 1, c, v: 1000 });
  const frozen = (t: number, c: number) => ({ t, o: c, h: c, l: c, c, v: 0 });
  const resp = {
    symbol: "WMT", range: "2y" as const, interval: "1d" as const, provider: "webull" as const,
    price: 85, candles: [real(0, 90), frozen(86400, 85), real(172800, 92), frozen(259200, 85)],
  };

  const clean = sanitizeResponse(resp);
  assert.equal(clean.candles.length, 2);
  assert.deepEqual(clean.candles.map((b) => b.c), [90, 92]);
  // price must follow the surviving bars — a dropped last bar cannot keep
  // reporting its invented price as the quote.
  assert.equal(clean.price, 92);
  assert.equal(clean.provider, "webull", "everything else about the response is unchanged");
});

test("sanitizeResponse leaves a clean series exactly as it found it", () => {
  const resp = {
    symbol: "SPY", range: "2y" as const, interval: "1d" as const, provider: "alpaca" as const,
    price: 101, candles: [{ t: 0, o: 100, h: 102, l: 99, c: 100, v: 5 }, { t: 86400, o: 100, h: 103, l: 99, c: 101, v: 7 }],
  };
  assert.deepEqual(sanitizeResponse(resp), resp);
});

const DAY_S = 86_400;
const NOW_S = Math.floor(Date.parse("2026-08-30T12:00:00Z") / 1000);
const endingDaysAgo = (days: number) => [
  { t: NOW_S - (days + 400) * DAY_S },
  { t: NOW_S - days * DAY_S },
];

test("maxBarAgeDays allows a weekly bar to be older than a daily one", () => {
  // A weekly bar is stamped at the start of its week, so on a Friday the newest
  // legitimate weekly bar is already 4 days old — a daily threshold would
  // reject every healthy weekly series.
  assert.ok(maxBarAgeDays("1wk") > maxBarAgeDays("1d"));
  assert.ok(maxBarAgeDays("1d") >= 6, "must survive a long weekend plus a market holiday");
  assert.ok(maxBarAgeDays("1wk") >= 14, "must survive a stale week plus a holiday");
});

test("isStale accepts a series that ends where a healthy provider would end it", () => {
  assert.equal(isStale(endingDaysAgo(0), "1d", NOW_S), false);
  assert.equal(isStale(endingDaysAgo(4), "1d", NOW_S), false, "Friday close read on a Tuesday holiday week");
  assert.equal(isStale(endingDaysAgo(6), "1wk", NOW_S), false, "last week's weekly bar");
});

test("isStale catches the frozen-fixture series that coversDays waves through", () => {
  // The exact shape that made sandbox dangerous: 15 of 50 symbols ended at
  // 2026-07-15 — 46 days stale — with 400+ days of span behind them, so
  // coversDays(700) was satisfied and nothing else looked.
  const frozen = endingDaysAgo(46);
  assert.equal(coversDays(frozen, 300), true, "coversDays is blind to this by design");
  assert.equal(isStale(frozen, "1d", NOW_S), true);
  assert.equal(isStale(frozen, "1wk", NOW_S), true);
});

test("isStale treats an empty series as stale rather than fresh", () => {
  assert.equal(isStale([], "1d", NOW_S), true);
});
