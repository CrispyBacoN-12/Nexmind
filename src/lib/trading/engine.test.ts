import "dotenv/config"; // engine.ts imports prisma at module scope — needs DATABASE_URL to construct, same as other DB-touching scripts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveExitOverride, minRiskRewardFor } from "./engine";
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

test("resolveExitOverride: threads slMult + trail through from a trailing-stop strategy's preferredExit", () => {
  const s = scan({
    preferredExit: {
      tp1Mult: 3.5, singleTarget: true, slMult: 2.0, trail: { activateMult: 1.0, offsetMult: 1.75 },
    },
  });
  assert.deepEqual(resolveExitOverride(s, false), {
    atrTpMult: 3.5, singleTarget: true, atrSlMult: 2.0, trail: { activateMult: 1.0, offsetMult: 1.75 },
  });
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

