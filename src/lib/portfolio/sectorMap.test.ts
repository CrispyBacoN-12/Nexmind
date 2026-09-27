import assert from "node:assert/strict";
import { test } from "node:test";

import { FINNHUB_TO_GICS, GICS_SECTORS, resolveGicsSector } from "./sectorMap";

test("observed Finnhub values map to their GICS sector", () => {
  assert.equal(resolveGicsSector("AAPL", "Technology"), "Information Technology");
  assert.equal(resolveGicsSector("NVDA", "Semiconductors"), "Information Technology");
  assert.equal(resolveGicsSector("CSCO", "Communications"), "Information Technology");
  assert.equal(resolveGicsSector("GOOGL", "Media"), "Communication Services");
  assert.equal(resolveGicsSector("V", "Financial Services"), "Financials");
  assert.equal(resolveGicsSector("PG", "Consumer products"), "Consumer Staples");
  assert.equal(resolveGicsSector("AMT", "Real Estate"), "Real Estate");
});

test("Retail splits by symbol: staples retailers are overridden", () => {
  assert.equal(resolveGicsSector("AMZN", "Retail"), "Consumer Discretionary");
  assert.equal(resolveGicsSector("WMT", "Retail"), "Consumer Staples");
  assert.equal(resolveGicsSector("cost", "Retail"), "Consumer Staples");
});

test("missing or unmapped industry is Other, never a guess", () => {
  assert.equal(resolveGicsSector("XYZ", null), "Other");
  assert.equal(resolveGicsSector("XYZ", ""), "Other");
  assert.equal(resolveGicsSector("XYZ", "Software"), "Other"); // not a Finnhub value
});

test("every mapped value is one of the 11 sectors", () => {
  const valid = new Set<string>(GICS_SECTORS);
  for (const [k, v] of Object.entries(FINNHUB_TO_GICS)) assert.ok(valid.has(v), `${k} -> ${v}`);
});
