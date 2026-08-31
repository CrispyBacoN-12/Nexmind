import "dotenv/config"; // engine.ts imports prisma at module scope — needs DATABASE_URL to construct, same as other DB-touching scripts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveExitOverride, minRiskRewardFor, signalBarStart } from "./engine";
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

const bar = (t: number) => ({ t, o: 100, h: 101, l: 99, c: 100, v: 1000 });

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


// --- re-entry guard ---------------------------------------------------------
//
// 2026-08-24: portfolio #11 opened CSX eight times and KMX five times off ONE
// weekly bar. The dedupe at engine.ts:108 only asks whether a position is
// currently open, so a setup that stopped out inside the same tick was no
// longer open, and the next scan of the same unchanged weekly bar took it
// again. Two real setups were recorded as 12 closed trades and -4.69R instead
// of -0.17R. The guard key has to be the bar the signal fired on.

const WEEK = 7 * 86400;

test("signalBarStart: the guard key is the bar the signal fired on, not the wall clock", () => {
  // scanner.ts:278 fires on candles[length - 1] and ships that tail as
  // scan.candles, so the last candle is the bar under decision.
  const t = Date.UTC(2026, 7, 24) / 1000;
  const s = scan({ candles: [bar(t - WEEK), bar(t)] });
  assert.deepEqual(signalBarStart(s), new Date(Date.UTC(2026, 7, 24)));
});

test("signalBarStart: candle stamps are seconds and must not be read as milliseconds", () => {
  // An off-by-1000 here dates every bar to 1970 and the guard silently matches
  // every trade ever opened, which reads as "already taken" forever.
  const s = scan({ candles: [bar(Date.UTC(2026, 7, 24) / 1000)] });
  assert.equal(signalBarStart(s)!.getUTCFullYear(), 2026);
});

test("signalBarStart: no candles means no key, so the guard cannot be applied", () => {
  // Better to fall through to the open-position check than to invent a bar
  // boundary and block a legitimate entry.
  assert.equal(signalBarStart(scan({ candles: [] })), null);
});
