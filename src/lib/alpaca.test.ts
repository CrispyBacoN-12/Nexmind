import { test } from "node:test";
import assert from "node:assert/strict";
import { intervalToTimeframe, rangeToLookbackMs, parseAlpacaBars, parseAlpacaBatch, fetchAlpacaCandles, fetchAlpacaCandlesBatch } from "./alpaca";

test("intervalToTimeframe maps every supported interval", () => {
  assert.equal(intervalToTimeframe("5m"), "5Min");
  assert.equal(intervalToTimeframe("15m"), "15Min");
  assert.equal(intervalToTimeframe("30m"), "30Min");
  assert.equal(intervalToTimeframe("60m"), "1Hour");
  assert.equal(intervalToTimeframe("1h"), "1Hour");
  assert.equal(intervalToTimeframe("1d"), "1Day");
  assert.equal(intervalToTimeframe("1wk"), "1Week");
});

test("rangeToLookbackMs grows monotonically with range", () => {
  const day = 86_400_000;
  assert.equal(rangeToLookbackMs("1d"), 1 * day);
  assert.equal(rangeToLookbackMs("5d"), 5 * day);
  assert.ok(rangeToLookbackMs("3mo") > rangeToLookbackMs("1mo"));
  assert.ok(rangeToLookbackMs("5y") > rangeToLookbackMs("1y"));
  assert.ok(rangeToLookbackMs("max") >= rangeToLookbackMs("5y"));
});

test("parseAlpacaBars converts bars to Candle[] with unix-second timestamps", () => {
  const json = {
    symbol: "AAPL",
    bars: [
      { t: "2026-06-15T13:30:00Z", o: 1, h: 3, l: 0.5, c: 2, v: 100 },
      { t: "2026-06-15T13:35:00Z", o: 2, h: 4, l: 1.5, c: 3, v: 200 },
    ],
  };
  const resp = parseAlpacaBars(json, "AAPL", "1d", "5m");
  assert.equal(resp.symbol, "AAPL");
  assert.equal(resp.range, "1d");
  assert.equal(resp.interval, "5m");
  assert.equal(resp.candles.length, 2);
  assert.deepEqual(resp.candles[0], { t: Math.floor(Date.parse("2026-06-15T13:30:00Z") / 1000), o: 1, h: 3, l: 0.5, c: 2, v: 100 });
  assert.equal(resp.price, 3);
});

test("parseAlpacaBars throws on empty or missing bars (so the router can fall back)", () => {
  assert.throws(() => parseAlpacaBars({ symbol: "AAPL", bars: [] }, "AAPL", "1d", "5m"));
  assert.throws(() => parseAlpacaBars({ symbol: "AAPL" }, "AAPL", "1d", "5m"));
});

test("parseAlpacaBatch maps each symbol to a CandleResponse, skipping empties", () => {
  const json = {
    bars: {
      AAPL: [{ t: "2026-06-15T13:30:00Z", o: 1, h: 3, l: 0.5, c: 2, v: 100 }],
      MSFT: [
        { t: "2026-06-15T13:30:00Z", o: 10, h: 12, l: 9, c: 11, v: 50 },
        { t: "2026-06-16T13:30:00Z", o: 11, h: 13, l: 10, c: 12, v: 60 },
      ],
      EMPTY: [],
    },
  };
  const map = parseAlpacaBatch(json, "1mo", "1d");
  assert.equal(map.size, 2, "EMPTY (no bars) is omitted");
  assert.equal(map.get("AAPL")!.candles.length, 1);
  assert.equal(map.get("MSFT")!.candles.length, 2);
  assert.equal(map.get("MSFT")!.price, 12);
  assert.equal(map.has("EMPTY"), false);
});

test("fetchAlpacaCandles throws when no API key is configured", async () => {
  const prevKey = process.env.ALPACA_KEY;
  const prevSecret = process.env.ALPACA_SECRET;
  delete process.env.ALPACA_KEY;
  delete process.env.ALPACA_SECRET;
  try {
    await assert.rejects(() => fetchAlpacaCandles("AAPL", "1d", "5m"), /key/i);
  } finally {
    if (prevKey !== undefined) process.env.ALPACA_KEY = prevKey;
    if (prevSecret !== undefined) process.env.ALPACA_SECRET = prevSecret;
  }
});

/**
 * Capture the URLs a fetcher requests without touching the network. The
 * adjustment parameter is not visible in the parsed output at all -- if it is
 * dropped, Alpaca silently returns raw prices and every long-horizon return is
 * wrong -- so the request itself is the only place it can be asserted.
 */
async function captureUrls(run: () => Promise<unknown>): Promise<string[]> {
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  const prevKey = process.env.ALPACA_KEY;
  const prevSecret = process.env.ALPACA_SECRET;
  process.env.ALPACA_KEY = "k";
  process.env.ALPACA_SECRET = "s";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return {
      ok: true,
      json: async () => ({
        bars: { AAPL: [{ t: "2026-06-15T13:30:00Z", o: 1, h: 3, l: 0.5, c: 2, v: 100 }] },
        next_page_token: null,
      }),
    } as Response;
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
    if (prevKey === undefined) delete process.env.ALPACA_KEY;
    else process.env.ALPACA_KEY = prevKey;
    if (prevSecret === undefined) delete process.env.ALPACA_SECRET;
    else process.env.ALPACA_SECRET = prevSecret;
  }
  return urls;
}

test("fetchAlpacaCandlesBatch requests split- and dividend-adjusted bars", async () => {
  const urls = await captureUrls(() => fetchAlpacaCandlesBatch(["AAPL"], "max", "1d"));
  assert.equal(urls.length, 1);
  const p = new URL(urls[0]).searchParams;
  // Alpaca's default is adjustment=raw, which puts unadjusted splits in the bars.
  assert.equal(p.get("adjustment"), "all");
});

test("fetchAlpacaCandles requests split- and dividend-adjusted bars", async () => {
  const urls = await captureUrls(() =>
    fetchAlpacaCandles("AAPL", "max", "1d").catch(() => undefined),
  );
  assert.ok(urls.length >= 1, "expected at least one request");
  assert.equal(new URL(urls[0]).searchParams.get("adjustment"), "all");
});
