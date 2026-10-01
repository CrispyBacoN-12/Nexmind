import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeHoldingSources, normalizeHoldingTickers, RISK_SENTRY_MAX_HOLDINGS } from "./holdings";

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

test("merge puts open journal positions first, then manual extras, deduped", () => {
  assert.deepEqual(mergeHoldingSources(["NVDA", "ko"], ["AAPL", "nvda", "MSFT"]), ["NVDA", "KO", "AAPL", "MSFT"]);
});

test("merge with an empty journal is the manual list unchanged", () => {
  assert.deepEqual(mergeHoldingSources([], ["AAPL", "MSFT"]), ["AAPL", "MSFT"]);
});

test("merge with no manual list is the journal alone", () => {
  assert.deepEqual(mergeHoldingSources(["XOM"], []), ["XOM"]);
});

test("when the cap binds, manual extras are dropped before journal positions", () => {
  const journal = ["AAA", "BBB"];
  const manual = Array.from({ length: RISK_SENTRY_MAX_HOLDINGS }, (_, i) => `M${String.fromCharCode(65 + i)}`);
  const merged = mergeHoldingSources(journal, manual);
  assert.equal(merged.length, RISK_SENTRY_MAX_HOLDINGS);
  assert.deepEqual(merged.slice(0, 2), journal);
});
