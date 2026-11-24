// The fetcher is tested against a fake fetch: no network, and the one thing
// guarded above all is that an error result never carries the API keys.

import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchPutQuotes, type PutWindow } from "./alpacaPuts";

const W: PutWindow = { expGte: "2026-12-04", expLte: "2026-12-25", strikeGte: 380.5, strikeLte: 430.75 };
const ENV = { ALPACA_KEY: "k-secret", ALPACA_SECRET: "s-secret" };

function fakeFetch(pages: unknown[] | ((i: number) => unknown), status = 200) {
  const urls: string[] = [];
  const impl = (async (url: string | URL) => {
    urls.push(String(url));
    const i = urls.length - 1;
    const body = typeof pages === "function" ? pages(i) : pages[i];
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, urls };
}

test("fetchPutQuotes: maps snapshots", async () => {
  const f = fakeFetch([
    { snapshots: { AAPL261231P00240000: { latestQuote: { ap: 0.12, bp: 0.01, t: "2026-11-24T18:47:01Z" } } } },
  ]);
  const r = await fetchPutQuotes("aapl", W, { fetchImpl: f.impl, env: ENV });
  assert.deepEqual(r, {
    quotes: [{ symbol: "AAPL261231P00240000", expiry: "2026-12-31", strike: 240, bid: 0.01, ask: 0.12, quotedAt: "2026-11-24T18:47:01Z" }],
  });
  const u = f.urls[0];
  assert.ok(u.includes("/v1beta1/options/snapshots/AAPL?"));
  for (const part of ["feed=indicative", "type=put", "expiration_date_gte=2026-12-04", "expiration_date_lte=2026-12-25", "strike_price_gte=380.50", "strike_price_lte=430.75", "limit=1000"]) {
    assert.ok(u.includes(part), part);
  }
  assert.ok(!u.includes("opra"));
});

test("fetchPutQuotes: ap 0 or missing → ask null; bp 0 → bid 0", async () => {
  const f = fakeFetch([
    {
      snapshots: {
        AAPL261231P00240000: { latestQuote: { ap: 0, bp: 0, t: "2026-11-24T18:47:01Z" } },
        AAPL261231P00245000: {},
      },
    },
  ]);
  const r = await fetchPutQuotes("AAPL", W, { fetchImpl: f.impl, env: ENV });
  assert.ok("quotes" in r);
  const by = new Map(r.quotes.map((q) => [q.strike, q]));
  assert.equal(by.get(240)!.ask, null);
  assert.equal(by.get(240)!.bid, 0);
  assert.equal(by.get(245)!.ask, null);
  assert.equal(by.get(245)!.bid, null);
  assert.equal(by.get(245)!.quotedAt, null);
});

test("fetchPutQuotes: follows next_page_token up to maxPages", async () => {
  const f = fakeFetch((i) => ({
    snapshots: { [`AAPL261231P00${240 + i}000`]: { latestQuote: { ap: 1, bp: 0.9, t: "2026-11-24T18:47:01Z" } } },
    next_page_token: `tok${i}`,
  }));
  const r = await fetchPutQuotes("AAPL", W, { fetchImpl: f.impl, env: ENV, maxPages: 3 });
  assert.equal(f.urls.length, 3);
  assert.ok(f.urls[1].includes("page_token=tok0"));
  assert.ok("quotes" in r);
  assert.equal(r.quotes.length, 3);
});

test("fetchPutQuotes: HTTP 403 → error without secrets", async () => {
  const f = fakeFetch([{ message: "forbidden" }], 403);
  const r = await fetchPutQuotes("AAPL", W, { fetchImpl: f.impl, env: ENV });
  assert.deepEqual(r, { error: "Alpaca options HTTP 403" });
  const s = JSON.stringify(r);
  assert.ok(!s.includes("k-secret") && !s.includes("s-secret"));
});

test("fetchPutQuotes: missing keys → error, no fetch", async () => {
  const f = fakeFetch([]);
  const r = await fetchPutQuotes("AAPL", W, { fetchImpl: f.impl, env: {} });
  assert.deepEqual(r, { error: "ALPACA_KEY/ALPACA_SECRET not set" });
  assert.equal(f.urls.length, 0);
});

test("fetchPutQuotes: thrown fetch → error", async () => {
  const boom = (async () => {
    throw new Error("x".repeat(500));
  }) as typeof fetch;
  const r = await fetchPutQuotes("AAPL", W, { fetchImpl: boom, env: ENV });
  assert.ok("error" in r);
  assert.ok(r.error.startsWith("option quotes fetch failed"));
  assert.ok(r.error.length <= 120);
});

test("fetchPutQuotes: unparseable symbol skipped", async () => {
  const f = fakeFetch([
    {
      snapshots: {
        garbage: { latestQuote: { ap: 1, bp: 1, t: "2026-11-24T18:47:01Z" } },
        AAPL261231P00240000: { latestQuote: { ap: 1, bp: 0.9, t: "2026-11-24T18:47:01Z" } },
      },
    },
  ]);
  const r = await fetchPutQuotes("AAPL", W, { fetchImpl: f.impl, env: ENV });
  assert.ok("quotes" in r);
  assert.deepEqual(r.quotes.map((q) => q.symbol), ["AAPL261231P00240000"]);
});
