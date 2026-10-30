import { test } from "node:test";
import assert from "node:assert/strict";
import { fillGuard, QUOTE_MAX_AGE_MIN, type FillGuardInput } from "./fillGuard";
import { sizeShares } from "./sizing";

const NOW = 1_800_000_000;

// $2,500 / 5 slots, 1% risk: slot $500, risk budget $25.
// entry 100, stop 95 -> risk budget allows 5, slot affords 5. Both bind.
function input(over: Partial<FillGuardInput> = {}): FillGuardInput {
  const entry = over.entry ?? 100;
  const stop = over.stop ?? 95;
  const sizing = sizeShares({ entry, slDistance: entry - stop, capital: 2500, maxSlots: 5, riskPct: 1 });
  return { entry, stop, sizing, capital: 2500, maxSlots: 5, riskPct: 1, quote: null, nowSec: NOW, ...over };
}

test("walk-away is the tighter of the two caps at the card's share count", () => {
  const g = fillGuard(input());
  // risk: 95 + 25/5 = 100; afford: 500/5 = 100. Both exactly at the entry.
  assert.equal(g.walkAwayPrice, 100);

  // A cheaper stock with risk headroom: entry 40, stop 38 -> risk allows 12, slot affords 12.
  const h = fillGuard(input({ entry: 40, stop: 38 }));
  assert.equal(h.walkAwayBoundBy, "risk");
  assert.ok(Math.abs((h.walkAwayPrice as number) - (38 + 25 / 12)) < 1e-9);
});

test("walk-away is never below the entry the card sized at", () => {
  for (const [entry, stop] of [
    [100, 95],
    [40, 38],
    [230, 222.5],
    [12.3, 11.1],
  ]) {
    const g = fillGuard(input({ entry, stop }));
    if (g.walkAwayPrice != null) assert.ok(g.walkAwayPrice >= entry - 1e-9, `${entry}: ${g.walkAwayPrice}`);
  }
});

test("zero shares has no walk-away price", () => {
  const g = fillGuard(input({ entry: 900, stop: 880 }));
  assert.equal(g.walkAwayPrice, null);
});

test("no quote says so and changes nothing", () => {
  const g = fillGuard(input({ quote: { price: null, at: null, note: "FINNHUB_API_KEY not set" } }));
  assert.equal(g.quote, null);
  assert.equal(g.atQuote, null);
  assert.match(g.quoteNote, /FINNHUB_API_KEY not set/);
});

test("a stale quote is never used as the price now", () => {
  const g = fillGuard(input({ quote: { price: 110, at: NOW - (QUOTE_MAX_AGE_MIN + 1) * 60 } }));
  assert.equal(g.quote?.fresh, false);
  assert.equal(g.atQuote, null);
  assert.match(g.quoteNote, /not treated as the price now/);
});

test("a fresh quote above the entry re-measures risk against the SAME stop", () => {
  const g = fillGuard(input({ quote: { price: 104, at: NOW - 60 } }));
  assert.ok(g.atQuote);
  // 5 shares * (104 - 95) = 45, not the card's 25.
  assert.equal(g.atQuote.plannedRiskUsd, 45);
  assert.equal(g.atQuote.overWalkAway, true);
  // Re-sized at 104 against stop 95: risk allows floor(25/9)=2, slot affords floor(500/104)=4.
  assert.equal(g.atQuote.resized.shares, 2);
});

test("a fresh quote above the entry but inside the walk-away keeps the size", () => {
  const g = fillGuard(input({ entry: 40, stop: 38, quote: { price: 40.05, at: NOW } })); // walk-away is 38 + 25/12 = 40.083
  assert.equal(g.atQuote?.overWalkAway, false);
});

test("a fresh quote at or below the entry needs no resize", () => {
  const g = fillGuard(input({ quote: { price: 99, at: NOW } }));
  assert.equal(g.atQuote, null);
  assert.equal(g.belowStop, false);
});

test("a fresh quote at or below the stop is flagged", () => {
  const g = fillGuard(input({ quote: { price: 95, at: NOW } }));
  assert.equal(g.belowStop, true);
});

test("without a clock the quote cannot be aged and is not used", () => {
  const g = fillGuard(input({ nowSec: null, quote: { price: 110, at: NOW } }));
  assert.equal(g.quote?.fresh, false);
  assert.equal(g.atQuote, null);
});
