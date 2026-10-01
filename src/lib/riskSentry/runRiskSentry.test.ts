import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import type { EarningsInfo } from "@/lib/advisor/types";
import { runRiskSentry, RISK_SENTRY_LAST_GATE_SETTING, type RunRiskSentryDeps } from "./runRiskSentry";

const TODAY = new Date("2026-09-16T12:00:00Z");
const DAY_SEC = 86_400;
const DAY_MS = 86_400_000;
const T0 = Date.parse("2020-01-01T00:00:00Z") / 1000;

function bars(n: number, closeAt: (i: number) => number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = closeAt(i);
    return { t: T0 + i * DAY_SEC, o: c, h: c + 1, l: c - 1, c, v: 1000 };
  });
}
const uptrend = (n = 300) => bars(n, (i) => 100 + i);
const downtrend = (n = 300) => bars(n, (i) => 1000 - i);

function candlesFromReturns(returns: number[]): Candle[] {
  let price = 100;
  const closes = [price];
  for (const r of returns) {
    price *= 1 + r;
    closes.push(price);
  }
  return closes.map((c, i) => ({ t: T0 + i * DAY_SEC, o: c, h: c + 1, l: c - 1, c, v: 1000 }));
}

const NO_EARNINGS: EarningsInfo = { date: null, hour: null, note: "no report scheduled in the next 120 days" };

function baseDeps(overrides: Partial<RunRiskSentryDeps> = {}): RunRiskSentryDeps {
  return {
    getRiskSentryHoldings: async () => [],
    getJournalOpenTickers: async () => [],
    setRiskSentryHoldings: async () => {},
    fetchCandlesBatch: async () => new Map(),
    fetchCandles: async () => ({ candles: uptrend() }),
    fetchNextEarnings: async () => NO_EARNINGS,
    getSetting: async (_k: string, fallback: string) => fallback,
    setSetting: async () => {},
    ...overrides,
  };
}

test("no holdings configured returns skipped with no message", async () => {
  const summary = await runRiskSentry(baseDeps(), TODAY);
  assert.equal(summary.skipped, true);
  assert.equal(summary.message, null);
});

test("open journal positions are checked even when the manual list is empty", async () => {
  let fetched: string[] = [];
  const deps = baseDeps({
    getJournalOpenTickers: async () => ["KO"],
    fetchCandlesBatch: async (symbols) => {
      fetched = symbols;
      return new Map([["KO", { candles: uptrend() }]]);
    },
  });
  const summary = await runRiskSentry(deps, TODAY);
  assert.equal(summary.skipped, false);
  assert.deepEqual(fetched, ["KO"]);
});

test("journal and manual holdings are checked together, a shared ticker once", async () => {
  let fetched: string[] = [];
  const deps = baseDeps({
    getJournalOpenTickers: async () => ["KO", "XOM"],
    getRiskSentryHoldings: async () => ["xom", "AAPL"],
    fetchCandlesBatch: async (symbols) => {
      fetched = symbols;
      return new Map();
    },
  });
  await runRiskSentry(deps, TODAY);
  assert.deepEqual(fetched, ["KO", "XOM", "AAPL"]);
});

test("all-clear holdings produce a null message", async () => {
  const candles = uptrend();
  const deps = baseDeps({
    getRiskSentryHoldings: async () => ["AAPL"],
    fetchCandlesBatch: async () => new Map([["AAPL", { candles }]]),
  });
  const summary = await runRiskSentry(deps, TODAY);
  assert.equal(summary.skipped, false);
  assert.equal(summary.message, null);
});

test("a mix of the three checks composes into one message, not three", async () => {
  const RETURNS = [0.01, -0.02, 0.015, 0.03, -0.01, 0.02, -0.015, 0.025, 0.01, -0.005];
  const sameCandles = candlesFromReturns(RETURNS);
  const soonDate = new Date(TODAY.getTime() + DAY_MS).toISOString().slice(0, 10);

  const deps = baseDeps({
    getRiskSentryHoldings: async () => ["AAA", "BBB"],
    fetchCandlesBatch: async () => new Map([["AAA", { candles: sameCandles }], ["BBB", { candles: sameCandles }]]),
    fetchCandles: async () => ({ candles: downtrend() }), // benchAbove -> false
    fetchNextEarnings: async (ticker: string) => (ticker === "AAA" ? { date: soonDate, hour: "amc" } : NO_EARNINGS),
    getSetting: async () => "above", // last reading was above -> flips to below
  });

  const summary = await runRiskSentry(deps, TODAY);
  assert.match(summary.message ?? "", /Earnings this week/);
  assert.match(summary.message ?? "", /Market gate flipped/);
  assert.match(summary.message ?? "", /Correlated holdings/);
});

test("persists the new gate reading via setSetting", async () => {
  let persisted: [string, string] | null = null;
  const deps = baseDeps({
    getRiskSentryHoldings: async () => ["AAPL"],
    fetchCandlesBatch: async () => new Map([["AAPL", { candles: uptrend() }]]),
    setSetting: async (key: string, value: string) => {
      persisted = [key, value];
    },
  });
  await runRiskSentry(deps, TODAY);
  assert.deepEqual(persisted, [RISK_SENTRY_LAST_GATE_SETTING, "above"]);
});
