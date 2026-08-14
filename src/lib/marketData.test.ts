import "dotenv/config"; // marketData.ts -> webull.ts -> webull/symbols.ts imports prisma at module scope — needs DATABASE_URL to construct, same as other DB-touching scripts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldTryAlpaca, shouldTryWebull, isMt5Symbol, toMt5Ticker, toFallbackTicker } from "./marketData";

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

test("isMt5Symbol matches spot gold/silver and 6-letter forex crosses", () => {
  assert.equal(isMt5Symbol("XAUUSD"), true);
  assert.equal(isMt5Symbol("xauusd"), true); // case-insensitive
  assert.equal(isMt5Symbol("XAGUSD"), true);
  assert.equal(isMt5Symbol("EURUSD"), true);
  assert.equal(isMt5Symbol("GBPJPY"), true);
  assert.equal(isMt5Symbol("AAPL"), false);
  assert.equal(isMt5Symbol("GC=F"), true); // Yahoo gold futures ticker aliases to spot XAUUSD
  assert.equal(isMt5Symbol("XAUUSDm"), false); // broker suffix not in defaults
  assert.equal(isMt5Symbol("XAUUSDm", ["XAUUSDM"]), true); // ...unless allow-listed via MT5_SYMBOLS
});

test("toMt5Ticker aliases the Yahoo-style tickers watchlists actually store", () => {
  assert.equal(toMt5Ticker("GC=F"), "XAUUSD"); // gold futures -> spot gold
  assert.equal(toMt5Ticker("SI=F"), "XAGUSD"); // silver futures -> spot silver
  assert.equal(toMt5Ticker("EURUSD=X"), "EURUSD"); // Yahoo forex suffix stripped
  assert.equal(toMt5Ticker("GBPJPY=X"), "GBPJPY");
  assert.equal(toMt5Ticker("XAUUSD"), "XAUUSD"); // already-bare tickers pass through
  assert.equal(toMt5Ticker("AAPL"), null);
  assert.equal(toMt5Ticker("^GSPC"), null);
  assert.equal(toMt5Ticker("BTC-USD"), null);
});

test("toFallbackTicker translates bare MT5 tickers back to what Alpaca/Yahoo understand", () => {
  assert.equal(toFallbackTicker("XAUUSD", "XAUUSD"), "GC=F"); // spot gold -> Yahoo futures feed
  assert.equal(toFallbackTicker("XAGUSD", "XAGUSD"), "SI=F"); // spot silver -> Yahoo futures feed
  assert.equal(toFallbackTicker("EURUSD", "EURUSD"), "EURUSD=X"); // forex cross -> Yahoo suffix
  assert.equal(toFallbackTicker("AAPL", null), "AAPL"); // no MT5 ticker resolved -> unchanged
});
