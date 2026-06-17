import { test } from "node:test";
import assert from "node:assert/strict";
import { bsPrice, greeks, RISK_FREE_RATE } from "./blackScholes";

test("RISK_FREE_RATE default is 4%", () => {
  assert.equal(RISK_FREE_RATE, 0.04);
});

test("bsPrice: ATM call, S=K=100, T=1, r=0, sigma=0.2 ≈ 7.97", () => {
  const p = bsPrice("call", 100, 100, 1, 0, 0.2);
  assert.ok(Math.abs(p - 7.9656) < 0.02, `got ${p}`);
});

test("bsPrice: ATM put equals call when r=0 (put-call parity, S=K)", () => {
  const c = bsPrice("call", 100, 100, 1, 0, 0.2);
  const p = bsPrice("put", 100, 100, 1, 0, 0.2);
  assert.ok(Math.abs(c - p) < 1e-6, `call ${c} put ${p}`);
});

test("greeks: ATM call delta is ~0.54, put delta ~-0.46 (S=K=100,T=1,r=0,sig=0.2)", () => {
  const gc = greeks("call", 100, 100, 1, 0, 0.2);
  const gp = greeks("put", 100, 100, 1, 0, 0.2);
  assert.ok(gc.delta > 0.5 && gc.delta < 0.6, `call delta ${gc.delta}`);
  assert.ok(gp.delta > -0.5 && gp.delta < -0.4, `put delta ${gp.delta}`);
  assert.ok(Math.abs(gp.delta - (gc.delta - 1)) < 1e-9);
  assert.ok(gc.gamma > 0 && gc.vega > 0);
});

test("bsPrice: expired/zero-T returns intrinsic", () => {
  assert.ok(Math.abs(bsPrice("call", 120, 100, 0, 0.04, 0.2) - 20) < 1e-9);
  assert.ok(Math.abs(bsPrice("put", 80, 100, 0, 0.04, 0.2) - 20) < 1e-9);
  assert.equal(bsPrice("call", 80, 100, 0, 0.04, 0.2), 0);
});

test("greeks: deep-ITM call delta → ~1, deep-OTM → ~0", () => {
  assert.ok(greeks("call", 200, 100, 1, 0.04, 0.2).delta > 0.95);
  assert.ok(greeks("call", 50, 100, 1, 0.04, 0.2).delta < 0.05);
});

test("greeks: at/after expiry (T=0) degenerate — ITM delta ±1, OTM 0, others 0", () => {
  const itmCall = greeks("call", 120, 100, 0, 0.04, 0.2);
  assert.equal(itmCall.delta, 1);
  assert.equal(itmCall.gamma, 0);
  assert.equal(itmCall.vega, 0);
  const itmPut = greeks("put", 80, 100, 0, 0.04, 0.2);
  assert.equal(itmPut.delta, -1);
  const otm = greeks("call", 80, 100, 0, 0.04, 0.2);
  assert.equal(otm.delta, 0);
});
