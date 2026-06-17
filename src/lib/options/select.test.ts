import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseExpiry, chooseStrike, directionToType, sizeContracts } from "./select";
import type { OptionQuote } from "./chain";

const DAY = 86400;

test("directionToType: bullish→call, bearish→put, neutral→null", () => {
  assert.equal(directionToType("strong-buy"), "call");
  assert.equal(directionToType("buy"), "call");
  assert.equal(directionToType("avoid"), "put");
  assert.equal(directionToType("watch"), null);
  assert.equal(directionToType("hold"), null);
});

test("chooseExpiry: nearest expiry at least minDays out", () => {
  const now = 1_000_000_000;
  const expiries = [now + 5 * DAY, now + 35 * DAY, now + 80 * DAY];
  assert.equal(chooseExpiry(expiries, now, 30), now + 35 * DAY);
  assert.equal(chooseExpiry([now + 5 * DAY], now, 30), null);
});

test("sizeContracts: floor(budget / (100 * premium)); 0 when premium<=0", () => {
  assert.equal(sizeContracts(5000, 12), 4); // 5000/1200 = 4.16 → 4
  assert.equal(sizeContracts(50, 12), 0);
  assert.equal(sizeContracts(5000, 0), 0);
});

test("chooseStrike: picks the quote whose delta is closest to target", () => {
  const now = 1_000_000_000;
  const expiry = now + 30 * DAY;
  const q = (strike: number, iv: number): OptionQuote => ({ type: "call", strike, expiry, bid: 1, ask: 1, lastPrice: 1, impliedVolatility: iv });
  // For S=100, an ATM (strike 100) call has delta ~0.5; deep OTM (130) much lower; ITM (70) higher.
  const quotes = [q(70, 0.3), q(100, 0.3), q(130, 0.3)];
  const chosen = chooseStrike(quotes, 100, "call", 0.5, 0.04, now);
  assert.equal(chosen?.strike, 100);
});
