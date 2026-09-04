import test from "node:test";
import assert from "node:assert/strict";
import { UNIVERSES } from "./universe";

// The merged universe is built by concatenation, so a symbol in both source
// lists would be scanned twice — two fetches and, on a setup, two full analyst
// rounds on the same bar. Nothing downstream dedupes for us.
test("sp500+nasdaq100 lists every symbol exactly once", () => {
  const symbols = UNIVERSES["sp500+nasdaq100"].symbols;
  assert.equal(new Set(symbols).size, symbols.length);
});

test("sp500+nasdaq100 is the union of its two sources", () => {
  const merged = new Set(UNIVERSES["sp500+nasdaq100"].symbols);
  for (const s of UNIVERSES["sp500"].symbols) assert.ok(merged.has(s), `${s} missing from merge`);
  for (const s of UNIVERSES["nasdaq100"].symbols) assert.ok(merged.has(s), `${s} missing from merge`);
});

// The nine NASDAQ-100 names that are not S&P 500 members are the entire point
// of the merge. scanUniverse fetches only the first 200 symbols, so they have
// to sit inside that window or the merge changes nothing.
test("the NASDAQ-only names fall inside the 200-symbol scan window", () => {
  const merged = UNIVERSES["sp500+nasdaq100"].symbols;
  const sp500 = new Set(UNIVERSES["sp500"].symbols);
  const ndxOnly = UNIVERSES["nasdaq100"].symbols.filter((s) => !sp500.has(s));

  assert.ok(ndxOnly.length > 0, "merge adds nothing — sources may have drifted");
  for (const s of ndxOnly) {
    assert.ok(merged.indexOf(s) < 200, `${s} sits past the scan window at ${merged.indexOf(s)}`);
  }
});
