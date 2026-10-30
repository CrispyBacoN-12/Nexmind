import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import type { EarningsInfo } from "@/lib/advisor/types";
import {
  runRiskSentry,
  RISK_SENTRY_FILINGS_CHECKED_TO_SETTING,
  RISK_SENTRY_LAST_GATE_SETTING,
  type RunRiskSentryDeps,
} from "./runRiskSentry";
import type { FilingFetchResult } from "./filingWatch";

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
    getJournalOpenPositions: async () => [],
    setRiskSentryHoldings: async () => {},
    fetchCandlesBatch: async () => new Map(),
    fetchCandles: async () => ({ candles: uptrend() }),
    fetchNextEarnings: async () => NO_EARNINGS,
    fetchRecentFilings: async (tickers: string[]) =>
      new Map<string, FilingFetchResult>(tickers.map((t) => [t, { filings: [] }])),
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
    getJournalOpenPositions: async () => [{ ticker: "KO", stop: 1 }],
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
    getJournalOpenPositions: async () => [{ ticker: "KO", stop: 1 }, { ticker: "XOM", stop: 1 }],
    getRiskSentryHoldings: async () => ["xom", "AAPL"],
    fetchCandlesBatch: async (symbols) => {
      fetched = symbols;
      return new Map();
    },
  });
  await runRiskSentry(deps, TODAY);
  assert.deepEqual(fetched, ["KO", "XOM", "AAPL"]);
});

test("a journal position whose last close is under its stop leads the message", async () => {
  const candles = uptrend(); // last close 399
  const deps = baseDeps({
    getJournalOpenPositions: async () => [{ ticker: "KO", stop: 400 }],
    fetchCandlesBatch: async () => new Map([["KO", { candles }]]),
  });
  const summary = await runRiskSentry(deps, TODAY);
  assert.equal(summary.stops.length, 1);
  assert.equal(summary.stops[0].kind, "breached");
  assert.match(summary.message ?? "", /^\*\*Stop hit\*\*\nKO: closed 399\.00 at\/below stop 400\.00/);
});

test("manual-list holdings have no stop and are never stop-checked", async () => {
  const deps = baseDeps({
    getRiskSentryHoldings: async () => ["AAPL"],
    fetchCandlesBatch: async () => new Map([["AAPL", { candles: downtrend() }]]),
  });
  const summary = await runRiskSentry(deps, TODAY);
  assert.deepEqual(summary.stops, []);
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
      if (key === RISK_SENTRY_LAST_GATE_SETTING) persisted = [key, value];
    },
  });
  await runRiskSentry(deps, TODAY);
  assert.deepEqual(persisted, [RISK_SENTRY_LAST_GATE_SETTING, "above"]);
});

const restatement = (acceptedAt: string): FilingFetchResult => ({
  filings: [{ form: "8-K", items: ["4.02", "9.01"], acceptedAt, url: "https://www.sec.gov/x" }],
});

test("a red 8-K sits right after stop hits and reads in New York time", async () => {
  const deps = baseDeps({
    getJournalOpenPositions: async () => [{ ticker: "KO", stop: 400 }],
    getRiskSentryHoldings: async () => ["AAPL"],
    fetchCandlesBatch: async () => new Map([["KO", { candles: uptrend() }], ["AAPL", { candles: uptrend() }]]),
    fetchNextEarnings: async () => ({ date: "2026-09-17", hour: "amc" }),
    fetchRecentFilings: async () => new Map([["KO", { filings: [] }], ["AAPL", restatement("2026-09-15T20:05:00.000Z")]]),
  });
  const summary = await runRiskSentry(deps, TODAY);
  const msg = summary.message ?? "";
  assert.equal(summary.filings.hits.length, 1);
  assert.ok(msg.indexOf("**Stop hit**") < msg.indexOf("**SEC 8-K filings**"));
  assert.ok(msg.indexOf("**SEC 8-K filings**") < msg.indexOf("**Earnings this week**"));
  assert.match(msg, /AAPL — RED: 8-K 2026-09-15 16:05 ET — 4\.02 prior financial statements/);
});

test("the first run reads the last three days and stores the run start as the next window start", async () => {
  const writes = new Map<string, string>();
  const deps = baseDeps({
    getRiskSentryHoldings: async () => ["AAPL"],
    fetchCandlesBatch: async () => new Map([["AAPL", { candles: uptrend() }]]),
    fetchRecentFilings: async () => new Map([["AAPL", restatement("2026-09-10T00:00:00.000Z")]]), // 6 days old
    setSetting: async (k: string, v: string) => {
      writes.set(k, v);
    },
  });
  const summary = await runRiskSentry(deps, TODAY);
  assert.equal(summary.filingsSince, "2026-09-13T12:00:00.000Z");
  assert.deepEqual(summary.filings.hits, []);
  assert.equal(writes.get(RISK_SENTRY_FILINGS_CHECKED_TO_SETTING), TODAY.toISOString());
});

test("a stored window end is resumed from, so an older filing still inside it alerts", async () => {
  const deps = baseDeps({
    getRiskSentryHoldings: async () => ["AAPL"],
    fetchCandlesBatch: async () => new Map([["AAPL", { candles: uptrend() }]]),
    fetchRecentFilings: async () => new Map([["AAPL", restatement("2026-09-10T00:00:00.000Z")]]),
    getSetting: async (k: string, fallback: string) =>
      k === RISK_SENTRY_FILINGS_CHECKED_TO_SETTING ? "2026-09-08T12:00:00.000Z" : fallback,
  });
  const summary = await runRiskSentry(deps, TODAY);
  assert.equal(summary.filings.hits.length, 1);
});

test("an EDGAR failure is named in the message and holds the window where it was", async () => {
  const writes = new Map<string, string>();
  const deps = baseDeps({
    getRiskSentryHoldings: async () => ["AAPL"],
    fetchCandlesBatch: async () => new Map([["AAPL", { candles: uptrend() }]]),
    fetchRecentFilings: async () => new Map([["AAPL", { error: "sec HTTP 503" }]]),
    setSetting: async (k: string, v: string) => {
      writes.set(k, v);
    },
  });
  const summary = await runRiskSentry(deps, TODAY);
  assert.match(summary.message ?? "", /NOT checked \(EDGAR failed, read these yourself\): AAPL \(sec HTTP 503\)/);
  assert.equal(writes.has(RISK_SENTRY_FILINGS_CHECKED_TO_SETTING), false);
});

test("a fund with no SEC filer is not an alert", async () => {
  const deps = baseDeps({
    getRiskSentryHoldings: async () => ["SPY"],
    fetchCandlesBatch: async () => new Map([["SPY", { candles: uptrend() }]]),
    fetchRecentFilings: async () => new Map([["SPY", { noFiler: true as const }]]),
  });
  const summary = await runRiskSentry(deps, TODAY);
  assert.equal(summary.message, null);
  assert.deepEqual(summary.filings.noFiler, ["SPY"]);
});
