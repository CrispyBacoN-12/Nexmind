// Portfolio risk math. Made-up tickers only: the owner's real holdings must
// never appear in a committed file (the repo is public).

import { test } from "node:test";
import assert from "node:assert/strict";

import type { Candle } from "@/lib/indicators";

import {
  betaVsBenchmark,
  computeWeights,
  correlationClusters,
  industryBuckets,
  portfolioBeta,
  type PricedHolding,
  type WeightRow,
} from "./risk";

const h = (ticker: string, shares: number, price: number | null, avgCost: number, kind: PricedHolding["kind"] = "stock", industry: string | null = null): PricedHolding => ({
  ticker,
  shares,
  avgCost,
  price,
  kind,
  industry,
});

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test("computeWeights: value, P&L, weight, top3", () => {
  const r = computeWeights([h("AAA", 5, 10, 8), h("BBB", 3, 10, 12), h("CCC", 2, 10, 10)]);
  assert.ok(close(r.total, 100));
  const by = new Map(r.rows.map((x) => [x.ticker, x]));
  assert.ok(close(by.get("AAA")!.value, 50));
  assert.ok(close(by.get("AAA")!.pnl, 10));
  assert.ok(close(by.get("AAA")!.pnlPct, 0.25));
  assert.ok(close(by.get("AAA")!.weight, 0.5));
  assert.equal(by.get("AAA")!.flagged, true);
  assert.ok(close(by.get("BBB")!.pnl, -6));
  assert.ok(close(by.get("CCC")!.weight, 0.2));
  assert.equal(by.get("CCC")!.flagged, true);
  assert.ok(close(r.top3Share, 1));
  const four = computeWeights([h("AAA", 5, 10, 8), h("BBB", 3, 10, 12), h("CCC", 2, 10, 10), h("DDD", 1, 1, 1)]);
  assert.ok(close(four.top3Share, 100 / 101));
});

test("computeWeights: unpriced rows are excluded and listed", () => {
  const r = computeWeights([h("AAA", 5, 10, 8), h("BBB", 3, null, 12)]);
  assert.deepEqual(r.unpriced, ["BBB"]);
  assert.deepEqual(r.rows.map((x) => x.ticker), ["AAA"]);
  assert.ok(Number.isFinite(r.total) && Number.isFinite(r.top3Share));
  const none = computeWeights([h("BBB", 3, null, 12)]);
  assert.equal(none.total, 0);
  assert.equal(none.top3Share, 0);
});

const wr = (ticker: string, weight: number, kind: WeightRow["kind"], industry: string | null): WeightRow => ({
  ticker,
  value: weight * 1000,
  cost: 0,
  pnl: 0,
  pnlPct: 0,
  weight,
  flagged: false,
  kind,
  industry,
});

test("industryBuckets: groups, labels, ETF never flagged", () => {
  const b = industryBuckets([
    wr("AAA", 0.5, "stock", "Semiconductors"),
    wr("BBB", 0.1, "stock", "Semiconductors"),
    wr("CCC", 0.35, "etf", null),
    wr("DDD", 0.05, null, null),
  ]);
  assert.deepEqual(
    b.map((x) => [x.label, x.kind, +x.weight.toFixed(6), x.flagged, x.tickers]),
    [
      ["Semiconductors", "industry", 0.6, true, ["AAA", "BBB"]],
      ["ETF / กองทุน", "etf", 0.35, false, ["CCC"]],
      ["ยังไม่ทราบกลุ่ม", "unknown", 0.05, false, ["DDD"]],
    ],
  );
});

function series(n: number, move: number): Candle[] {
  let c = 100;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) c *= 1 + (i % 2 === 0 ? move : -move);
    out.push({ t: 1_700_000_000 + i * 86400, o: c, h: c, l: c, c, v: 1 });
  }
  return out;
}

test("betaVsBenchmark: exact 2x mover", () => {
  const b = betaVsBenchmark(series(200, 0.02), series(200, 0.01));
  assert.ok(b != null && Math.abs(b - 2) < 1e-9, String(b));
  assert.equal(betaVsBenchmark(series(100, 0.02), series(100, 0.01)), null);
  assert.equal(betaVsBenchmark(null, series(200, 0.01)), null);
});

test("portfolioBeta: weighted, excluded listed", () => {
  const r = portfolioBeta([
    { ticker: "AAA", value: 100, beta: 2 },
    { ticker: "BBB", value: 100, beta: 0.5 },
    { ticker: "CCC", value: 50, beta: null },
  ]);
  assert.ok(close(r.beta!, 1.25));
  assert.ok(close(r.scenarioUsd, -25));
  // % of the MEASURED part only; coverage says how much of the book that is.
  assert.ok(close(r.scenarioPct!, -0.125));
  assert.ok(close(r.coverage!, 0.8));
  assert.deepEqual(r.excluded, ["CCC"]);
  assert.equal(r.excludedValue, 50);
});

test("portfolioBeta: nothing measurable", () => {
  const r = portfolioBeta([{ ticker: "AAA", value: 100, beta: null }]);
  assert.equal(r.beta, null);
  assert.equal(r.scenarioUsd, 0);
  assert.equal(r.scenarioPct, null);
  assert.equal(r.coverage, 0);
  const empty = portfolioBeta([]);
  assert.equal(empty.scenarioPct, null);
});

test("correlationClusters: connected components at 0.75", () => {
  const table: Record<string, number> = { "AAA|BBB": 0.9, "BBB|CCC": 0.8, "DDD|EEE": 0.76, "AAA|DDD": 0.1, "CCC|FFF": 0.74 };
  const corr = (a: string, b: string) => table[`${a}|${b}`] ?? table[`${b}|${a}`] ?? null;
  const w: Record<string, number> = { AAA: 0.3, BBB: 0.1, CCC: 0.05, DDD: 0.2, EEE: 0.15, FFF: 0.2 };
  const c = correlationClusters(["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"], corr, (t) => w[t]);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0].members, ["AAA", "BBB", "CCC"]);
  assert.ok(close(c[0].weight, 0.45));
  assert.equal(c[0].flagged, true);
  assert.deepEqual(c[0].strongest, { a: "AAA", b: "BBB", r: 0.9 });
  // the weakest measured pair inside a chained cluster is shown too
  assert.equal(c[0].weakest?.r, 0.8);
  assert.deepEqual(c[1].members, ["DDD", "EEE"]);
  assert.ok(close(c[1].weight, 0.35));
  assert.equal(c[1].flagged, true);
});
