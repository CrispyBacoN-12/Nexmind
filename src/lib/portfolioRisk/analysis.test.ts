// buildPortfolioAnalysis on fake data sources. Made-up tickers only.

import { test } from "node:test";
import assert from "node:assert/strict";

import type { EarningsInfo, LiveQuote } from "@/lib/advisor/types";
import type { Candle } from "@/lib/indicators";

import { buildPortfolioAnalysis, makePacer, type AnalysisDeps } from "./analysis";
import type { HoldingRow } from "./store";

const row = (ticker: string, shares: number, avgCost: number, kind: HoldingRow["kind"], industry: string | null = null): HoldingRow => ({
  ticker,
  shares,
  avgCost,
  note: "",
  kind,
  industry,
  updatedAt: "2026-11-25T00:00:00.000Z",
});

function bars(n: number, close: number, move = 0.01): Candle[] {
  let c = close;
  return Array.from({ length: n }, (_, i) => {
    if (i > 0) c *= 1 + (i % 2 === 0 ? move : -move);
    return { t: 1_700_000_000 + i * 86400, o: c, h: c, l: c, c, v: 1 };
  });
}

function deps(over: Partial<AnalysisDeps> & { calls?: string[] } = {}): AnalysisDeps {
  const calls = over.calls ?? [];
  const log = (what: string) => (t: string) => calls.push(`${what}:${t}`);
  const prices: Record<string, number> = { AAA: 10, BBB: 20, CCC: 5 };
  return {
    pace: over.pace ?? (async () => void calls.push("pace")),
    liveQuote:
      over.liveQuote ??
      (async (t: string): Promise<LiveQuote> => {
        log("quote")(t);
        return { price: prices[t] ?? null, at: 1_795_000_000 };
      }),
    earnings:
      over.earnings ??
      (async (t: string): Promise<EarningsInfo> => {
        log("earnings")(t);
        return t === "AAA" ? { date: "2026-12-03", hour: "amc" } : { date: null, hour: null, note: "none" };
      }),
    profile:
      over.profile ??
      (async (t: string) => {
        log("profile")(t);
        return { kind: "stock" as const, industry: "Software", note: null };
      }),
    candles: over.candles ?? new Map([["AAA", bars(200, 10, 0.02)], ["BBB", bars(200, 20, 0.01)], ["CCC", bars(200, 5, 0.01)]]),
    spy: over.spy === undefined ? bars(200, 400, 0.01) : over.spy,
  };
}

const HOLD = [row("AAA", 10, 8, "stock", "Semiconductors"), row("BBB", 5, 20, "etf"), row("CCC", 20, 6, null)];

test("buildPortfolioAnalysis: end to end on fakes", async () => {
  const calls: string[] = [];
  const a = await buildPortfolioAnalysis(HOLD, deps({ calls }), "2026-11-25");
  assert.equal(a.total, 10 * 10 + 5 * 20 + 20 * 5);
  assert.deepEqual(a.profileUpdates, [{ ticker: "CCC", kind: "stock", industry: "Software" }]);
  assert.ok(!calls.includes("earnings:BBB"), "ETFs skip earnings");
  assert.ok(calls.includes("earnings:CCC"), "a backfilled stock gets earnings");
  // pace before every external call
  const external = calls.filter((c) => c !== "pace").length;
  assert.equal(calls.filter((c) => c === "pace").length, external);
  for (let i = 0; i < calls.length; i++) if (calls[i] !== "pace") assert.equal(calls[i - 1], "pace", `${calls[i]} not paced`);
  const aaa = a.rows.find((r) => r.ticker === "AAA")!;
  assert.ok(aaa.beta != null && Math.abs(aaa.beta - 2) < 1e-6);
  assert.equal(aaa.priceSource, "live");
  assert.deepEqual(a.industries.map((b) => b.label).sort(), ["ETF / กองทุน", "Semiconductors", "Software"].sort());
  assert.ok(a.market.beta != null);
});

test("buildPortfolioAnalysis: falls back to last close", async () => {
  const a = await buildPortfolioAnalysis(
    [row("AAA", 1, 8, "stock", "Semiconductors"), row("ZZZ", 1, 8, "stock", "X")],
    deps({
      liveQuote: async () => ({ price: null, at: null, note: "FINNHUB_API_KEY not set" }),
      candles: new Map([["AAA", bars(200, 10)]]),
    }),
    "2026-11-25",
  );
  const aaa = a.rows.find((r) => r.ticker === "AAA")!;
  assert.equal(aaa.priceSource, "lastClose");
  assert.ok(aaa.priceNote?.includes("FINNHUB_API_KEY not set"));
  assert.deepEqual(a.unpriced, ["ZZZ"]);
  assert.ok(a.missing.some((m) => m.ticker === "ZZZ" && m.what === "price"));
});

test("buildPortfolioAnalysis: earnings window", async () => {
  const dates: Record<string, string> = { AAA: "2026-12-03", BBB: "2026-12-20", CCC: "2026-11-20" };
  const a = await buildPortfolioAnalysis(
    [row("AAA", 1, 8, "stock", "S"), row("BBB", 1, 8, "stock", "S"), row("CCC", 1, 8, "stock", "S")],
    deps({ earnings: async (t) => ({ date: dates[t], hour: null }) }),
    "2026-11-25",
  );
  assert.deepEqual(a.earnings.map((e) => [e.ticker, e.days]), [["AAA", 8]]);
});

test("buildPortfolioAnalysis: one failing source per holding is reported, rest renders", async () => {
  const a = await buildPortfolioAnalysis(
    HOLD,
    deps({
      earnings: async (t) => {
        if (t === "AAA") throw new Error("Finnhub HTTP 429");
        return { date: null, hour: null, note: "none" };
      },
    }),
    "2026-11-25",
  );
  assert.ok(a.missing.some((m) => m.ticker === "AAA" && m.what === "earnings"));
  assert.equal(a.rows.length, 3);
  assert.ok(a.industries.length > 0);
});

test("buildPortfolioAnalysis: a refused earnings call is reported, not read as none coming", async () => {
  const a = await buildPortfolioAnalysis(
    [row("AAA", 1, 8, "stock", "S"), row("BBB", 1, 8, "stock", "S")],
    deps({
      earnings: async (t) =>
        t === "AAA" ? { date: null, hour: null, note: "Finnhub HTTP 429" } : { date: null, hour: null, note: "no report scheduled in the next 120 days" },
    }),
    "2026-11-25",
  );
  assert.ok(a.missing.some((m) => m.ticker === "AAA" && m.what === "earnings" && m.reason.includes("429")));
  assert.ok(!a.missing.some((m) => m.ticker === "BBB" && m.what === "earnings"));
});

test("buildPortfolioAnalysis: ETFs are not chained into move-together clusters", async () => {
  const same = bars(200, 10, 0.02);
  const a = await buildPortfolioAnalysis(
    [row("AAA", 1, 8, "stock", "S"), row("BBB", 1, 8, "etf"), row("CCC", 1, 8, "stock", "S")],
    deps({ candles: new Map([["AAA", same], ["BBB", same], ["CCC", same]]) }),
    "2026-11-25",
  );
  assert.deepEqual(a.clusters.map((c) => c.members), [["AAA", "CCC"]]);
});

test("makePacer: spaces calls", async () => {
  const slept: number[] = [];
  let now = 0;
  const pace = makePacer(60, async (ms) => {
    slept.push(ms);
    now += ms;
  }, () => now);
  await pace();
  await pace();
  await pace();
  assert.ok(slept.reduce((s, v) => s + v, 0) >= 2000, JSON.stringify(slept));
});
