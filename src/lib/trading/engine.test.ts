import "dotenv/config"; // engine.ts imports prisma at module scope — needs DATABASE_URL to construct, same as other DB-touching scripts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveExitOverride, minRiskRewardFor, buildRLState } from "./engine";
import type { ScanResult, ScanSnapshot } from "./scanner";

const snapshot: ScanSnapshot = {
  price: 100, sma20: null, sma50: null, rsi: null, adx: null, plusDI: null, minusDI: null, macdHist: null, atr: null,
};

function scan(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    symbol: "TEST", timeframe: "1h", side: "long", price: 100, atr: 1, snapshot, note: "", candles: [],
    ...overrides,
  };
}

test("resolveExitOverride: prefers a strategy's tuned preferredExit over the research ladder", () => {
  const s = scan({ preferredExit: { tp1Mult: 3.0, singleTarget: false } });
  assert.deepEqual(resolveExitOverride(s, true), { atrTpMult: 3.0, singleTarget: false });
});

test("resolveExitOverride: falls back to the research ladder when there's no preferredExit", () => {
  const s = scan();
  assert.deepEqual(resolveExitOverride(s, true), { atrSlMult: 1.5, atrTpMult: 1.2, singleTarget: true });
});

test("resolveExitOverride: no override for a plain built-in strategy with no preferredExit", () => {
  const s = scan();
  assert.deepEqual(resolveExitOverride(s, false), {});
});

test("minRiskRewardFor: lowers the floor to match a tuned strategy's achievable R:R", () => {
  const s = scan({ preferredExit: { tp1Mult: 2.0, singleTarget: true } });
  assert.equal(minRiskRewardFor(s, false), 2.0 / 1.5);
});

test("minRiskRewardFor: never raises the floor above the default for a well-tuned strategy", () => {
  const s = scan({ preferredExit: { tp1Mult: 3.0, singleTarget: false } });
  assert.equal(minRiskRewardFor(s, false), 1.5);
});

test("minRiskRewardFor: research ladder floor applies when there's no preferredExit", () => {
  assert.equal(minRiskRewardFor(scan(), true), 0.5);
});

test("minRiskRewardFor: default floor applies for a plain built-in strategy", () => {
  assert.equal(minRiskRewardFor(scan(), false), 1.5);
});

test("buildRLState: exposurePct is riskUsd/balance (continuous) — matches Task 2's training-data definition", () => {
  const s = scan({ snapshot: { ...snapshot, adx: 30, rsi: 60, plusDI: 25, minusDI: 10 } });
  const state = buildRLState(s, "long", 100, 10000, 0);
  assert.equal(state.exposurePct, 0.01); // 100 / 10000
  assert.equal(state.cashPct, 0.99);
});

test("buildRLState: drawdownPct passes through the caller-computed equity-peak fraction unchanged", () => {
  const state = buildRLState(scan(), "long", 100, 10000, 0.05);
  assert.equal(state.drawdownPct, 0.05);
});

test("buildRLState: carries atr/adx/bbWidth straight from the scan result", () => {
  const s = scan({ atr: 3.2, snapshot: { ...snapshot, adx: 22, bbWidth: 0.015 } });
  const state = buildRLState(s, "long", 100, 10000, 0);
  assert.equal(state.atr, 3.2);
  assert.equal(state.adx, 22);
  assert.equal(state.bbWidth, 0.015);
});

test("buildRLState: proxyConfidence polarity follows side on identical indicators", () => {
  // Not exact negation: proxyConfidence's rsi/DI conviction terms clamp negative
  // support to 0 (rlProxyConfidence.ts), so magnitude(long) != magnitude(short)
  // whenever indicators favor one side, as they do here (rsi>50, plusDI>minusDI).
  // The invariant that actually holds — and that this test exists to confirm
  // buildRLState wires `side` through instead of hardcoding "long" — is sign
  // polarity: long is always >=0, short is always <=0.
  const s = scan({ snapshot: { ...snapshot, adx: 30, rsi: 60, plusDI: 25, minusDI: 10 } });
  const long = buildRLState(s, "long", 100, 10000, 0);
  const short = buildRLState(s, "short", 100, 10000, 0);
  assert.ok(long.proxyConfidence > 0);
  assert.ok(short.proxyConfidence < 0);
});

test("buildRLState: zero/negative balance doesn't divide by zero", () => {
  const state = buildRLState(scan(), "long", 100, 0, 0);
  assert.equal(state.exposurePct, 0);
  assert.equal(state.cashPct, 1);
});
