import "dotenv/config"; // rlProxyConfidence.ts -> scanner.ts -> research/adapter.ts imports prisma at module scope — needs DATABASE_URL to construct, same as other DB-touching scripts
import { test } from "node:test";
import assert from "node:assert/strict";
import { proxyConfidence } from "./rlProxyConfidence";

test("proxyConfidence: strong long conviction produces a positive value", () => {
  const v = proxyConfidence({ adx: 40, rsi: 65, plusDI: 30, minusDI: 10, side: "long" });
  assert.ok(v > 0, `expected positive, got ${v}`);
  assert.ok(v <= 1);
});

test("proxyConfidence: mirrored indicators for the opposite side produce the negated magnitude", () => {
  const long = proxyConfidence({ adx: 40, rsi: 65, plusDI: 30, minusDI: 10, side: "long" });
  const short = proxyConfidence({ adx: 40, rsi: 35, plusDI: 10, minusDI: 30, side: "short" });
  assert.equal(short, -long);
});

test("proxyConfidence: missing indicator data returns exactly 0", () => {
  assert.equal(proxyConfidence({ adx: null, rsi: 60, plusDI: 20, minusDI: 10, side: "long" }), 0);
  assert.equal(proxyConfidence({ adx: 30, rsi: null, plusDI: 20, minusDI: 10, side: "long" }), 0);
});

test("proxyConfidence: side alone flips the sign when indicators are neutral", () => {
  const neutral = { adx: 30, rsi: 50, plusDI: 20, minusDI: 20 };
  const long = proxyConfidence({ ...neutral, side: "long" });
  const short = proxyConfidence({ ...neutral, side: "short" });
  assert.equal(short, -long);
  assert.ok(long > 0); // trend strength alone still contributes above the ADX floor
});

test("proxyConfidence: ADX at the setup-gate floor contributes zero trend-strength", () => {
  const v = proxyConfidence({ adx: 20, rsi: 50, plusDI: 20, minusDI: 20, side: "long" });
  assert.equal(v, 0);
});
