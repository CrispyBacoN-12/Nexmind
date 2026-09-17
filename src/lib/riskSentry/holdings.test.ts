import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHoldingTickers, RISK_SENTRY_MAX_HOLDINGS } from "./holdings";

test("valid tickers pass through, uppercased and trimmed", () => {
  assert.deepEqual(normalizeHoldingTickers(["aapl", "MSFT", " nvda "]), ["AAPL", "MSFT", "NVDA"]);
});

test("invalid tokens are dropped, not thrown", () => {
  assert.deepEqual(normalizeHoldingTickers(["AAPL", "", "not a ticker!", "123"]), ["AAPL"]);
});

test("duplicates collapse to the first occurrence", () => {
  assert.deepEqual(normalizeHoldingTickers(["AAPL", "aapl", "AAPL"]), ["AAPL"]);
});

test("caps at RISK_SENTRY_MAX_HOLDINGS", () => {
  const many = Array.from({ length: RISK_SENTRY_MAX_HOLDINGS + 5 }, (_, i) => `T${String.fromCharCode(65 + (i % 26))}`);
  assert.equal(normalizeHoldingTickers(many).length, RISK_SENTRY_MAX_HOLDINGS);
});

test("non-array input returns an empty list", () => {
  assert.deepEqual(normalizeHoldingTickers(null), []);
  assert.deepEqual(normalizeHoldingTickers("AAPL"), []);
});

test("round-trips through JSON exactly as setRiskSentryHoldings/getRiskSentryHoldings would", () => {
  const input = ["tsla", "AAPL", "tsla", "  msft "];
  const stored = JSON.stringify(normalizeHoldingTickers(input));
  const readBack = normalizeHoldingTickers(JSON.parse(stored));
  assert.deepEqual(readBack, ["TSLA", "AAPL", "MSFT"]);
});
