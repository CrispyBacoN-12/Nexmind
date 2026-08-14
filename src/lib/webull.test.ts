import "dotenv/config"; // webull.ts -> webull/symbols.ts imports prisma at module scope — needs DATABASE_URL to construct, same as other DB-touching scripts
import { test } from "node:test";
import assert from "node:assert/strict";
import { intervalToWebullType, rangeToWebullCount, parseWebullBars, fetchWebullCandles } from "./webull";

test("intervalToWebullType maps every supported interval", () => {
  assert.equal(intervalToWebullType("5m"), "m5");
  assert.equal(intervalToWebullType("15m"), "m15");
  assert.equal(intervalToWebullType("30m"), "m30");
  assert.equal(intervalToWebullType("60m"), "m60");
  assert.equal(intervalToWebullType("1h"), "m60");
  assert.equal(intervalToWebullType("1d"), "d1");
  assert.equal(intervalToWebullType("1wk"), "w1");
});

test("rangeToWebullCount grows monotonically with range and is capped at 2000", () => {
  assert.ok(rangeToWebullCount("3mo", "1d") > rangeToWebullCount("1mo", "1d"));
  assert.ok(rangeToWebullCount("5y", "1d") > rangeToWebullCount("1y", "1d"));
  assert.equal(rangeToWebullCount("max", "5m"), 2000);
  assert.ok(rangeToWebullCount("1d", "1d") >= 1);
});

test("parseWebullBars converts bars to Candle[], sorted ascending by time", () => {
  const json = {
    data: [
      { timestamp: 200, open: 2, high: 4, low: 1.5, close: 3, volume: 200 },
      { timestamp: 100, open: 1, high: 3, low: 0.5, close: 2, volume: 100 },
    ],
  };
  const resp = parseWebullBars(json, "AAPL", "1d", "5m");
  assert.equal(resp.symbol, "AAPL");
  assert.equal(resp.candles.length, 2);
  assert.deepEqual(resp.candles[0], { t: 100, o: 1, h: 3, l: 0.5, c: 2, v: 100 });
  assert.equal(resp.price, 3); // last (latest-timestamp) close after sort
});

test("parseWebullBars drops extended-hours bars so output is RTH-only", () => {
  const json = {
    data: [
      { timestamp: 100, open: 1, high: 3, low: 0.5, close: 2, volume: 100, isExtendedHours: false },
      { timestamp: 200, open: 2, high: 4, low: 1.5, close: 3, volume: 200, isExtendedHours: true },
    ],
  };
  const resp = parseWebullBars(json, "AAPL", "1d", "5m");
  assert.equal(resp.candles.length, 1);
  assert.equal(resp.candles[0].t, 100);
});

test("parseWebullBars throws on empty or all-extended-hours bars (so the router can fall back)", () => {
  assert.throws(() => parseWebullBars({ data: [] }, "AAPL", "1d", "5m"));
  assert.throws(() => parseWebullBars({}, "AAPL", "1d", "5m"));
  assert.throws(() => parseWebullBars({ data: [{ timestamp: 1, open: 1, high: 1, low: 1, close: 1, volume: 1, isExtendedHours: true }] }, "AAPL", "1d", "5m"));
});

test("fetchWebullCandles throws when no API key is configured", async () => {
  const prevKey = process.env.WEBULL_APP_KEY;
  const prevSecret = process.env.WEBULL_APP_SECRET;
  delete process.env.WEBULL_APP_KEY;
  delete process.env.WEBULL_APP_SECRET;
  try {
    await assert.rejects(() => fetchWebullCandles("AAPL", "1d", "5m"), /WEBULL_APP_KEY/);
  } finally {
    if (prevKey !== undefined) process.env.WEBULL_APP_KEY = prevKey;
    if (prevSecret !== undefined) process.env.WEBULL_APP_SECRET = prevSecret;
  }
});
