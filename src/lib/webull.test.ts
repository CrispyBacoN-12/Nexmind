import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { intervalToWebullTimespan, rangeToWebullCount, parseWebullBars, fetchWebullCandles } from "./webull";

test("intervalToWebullTimespan maps every supported interval to a Timespan enum name", () => {
  assert.equal(intervalToWebullTimespan("1m"), "M1");
  assert.equal(intervalToWebullTimespan("5m"), "M5");
  assert.equal(intervalToWebullTimespan("15m"), "M15");
  assert.equal(intervalToWebullTimespan("30m"), "M30");
  assert.equal(intervalToWebullTimespan("60m"), "M60");
  assert.equal(intervalToWebullTimespan("1h"), "M60");
  assert.equal(intervalToWebullTimespan("1d"), "D");
  assert.equal(intervalToWebullTimespan("1wk"), "W");
});

test("rangeToWebullCount grows monotonically with range and is capped at 1200", () => {
  assert.ok(rangeToWebullCount("3mo", "1d") > rangeToWebullCount("1mo", "1d"));
  assert.ok(rangeToWebullCount("5y", "1d") > rangeToWebullCount("1y", "1d"));
  assert.equal(rangeToWebullCount("max", "5m"), 1200);
  assert.ok(rangeToWebullCount("1d", "1d") >= 1);
});

test("parseWebullBars converts bars to Candle[], sorted ascending by time", () => {
  const json = [
    { time: "2026-08-14T04:00:00.000+0000", open: "2", high: "4", low: "1.5", close: "3", volume: "200" },
    { time: "2026-08-13T04:00:00.000+0000", open: "1", high: "3", low: "0.5", close: "2", volume: "100" },
  ];
  const resp = parseWebullBars(json, "AAPL", "1d", "5m");
  assert.equal(resp.symbol, "AAPL");
  assert.equal(resp.candles.length, 2);
  assert.deepEqual(resp.candles[0], { t: Math.floor(Date.parse("2026-08-13T04:00:00.000+0000") / 1000), o: 1, h: 3, l: 0.5, c: 2, v: 100 });
  assert.equal(resp.price, 3); // last (latest-timestamp) close after sort
});

test("parseWebullBars drops extended-hours bars so output is RTH-only", () => {
  const json = [
    { time: "2026-08-13T04:00:00.000+0000", open: "1", high: "3", low: "0.5", close: "2", volume: "100", trading_session: "" },
    { time: "2026-08-14T04:00:00.000+0000", open: "2", high: "4", low: "1.5", close: "3", volume: "200", trading_session: "PRE" },
  ];
  const resp = parseWebullBars(json, "AAPL", "1d", "5m");
  assert.equal(resp.candles.length, 1);
  assert.equal(resp.candles[0].c, 2);
});

test("parseWebullBars keeps bars tagged trading_session RTH (the tag the live API actually sends for intraday regular-hours bars)", () => {
  const json = [
    { time: "2026-08-13T04:00:00.000+0000", open: "1", high: "3", low: "0.5", close: "2", volume: "100", trading_session: "RTH" },
    { time: "2026-08-14T04:00:00.000+0000", open: "2", high: "4", low: "1.5", close: "3", volume: "200", trading_session: "AH" },
  ];
  const resp = parseWebullBars(json, "AAPL", "1d", "5m");
  assert.equal(resp.candles.length, 1);
  assert.equal(resp.candles[0].c, 2);
});

test("parseWebullBars throws on empty or all-extended-hours bars (so the router can fall back)", () => {
  assert.throws(() => parseWebullBars([], "AAPL", "1d", "5m"));
  assert.throws(() => parseWebullBars({}, "AAPL", "1d", "5m"));
  assert.throws(() => parseWebullBars([{ time: "2026-08-14T04:00:00.000+0000", open: "1", high: "1", low: "1", close: "1", volume: "1", trading_session: "PRE" }], "AAPL", "1d", "5m"));
});

test("fetchWebullCandles throws when no API key is configured", async () => {
  const prevKey = process.env.WEBULL_PAPER_APP_KEY;
  const prevSecret = process.env.WEBULL_PAPER_APP_SECRET;
  delete process.env.WEBULL_PAPER_APP_KEY;
  delete process.env.WEBULL_PAPER_APP_SECRET;
  try {
    await assert.rejects(() => fetchWebullCandles("AAPL", "1d", "5m"), /WEBULL_PAPER_APP_KEY/);
  } finally {
    if (prevKey !== undefined) process.env.WEBULL_PAPER_APP_KEY = prevKey;
    if (prevSecret !== undefined) process.env.WEBULL_PAPER_APP_SECRET = prevSecret;
  }
});
