import { test } from "node:test";
import assert from "node:assert/strict";
import { intervalToTimeframe, rangeToLookbackMs, parseAlpacaBars, parseAlpacaBatch, fetchAlpacaCandles, fetchAlpacaCandlesBatch, fetchAlpacaRange } from "./alpaca";

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
async function captureUrls(run: () => Promise<unknown>, feed?: string): Promise<string[]> {
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  const prevKey = process.env.ALPACA_KEY;
  const prevSecret = process.env.ALPACA_SECRET;
  const prevFeed = process.env.ALPACA_FEED;
  process.env.ALPACA_KEY = "k";
  process.env.ALPACA_SECRET = "s";
  if (feed === undefined) delete process.env.ALPACA_FEED;
  else process.env.ALPACA_FEED = feed;
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
    if (prevFeed === undefined) delete process.env.ALPACA_FEED;
    else process.env.ALPACA_FEED = prevFeed;
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

test("both fetchers default to the SIP consolidated tape, not IEX", async () => {
  // IEX carries only IEX-exchange trades, so its daily history has multi-month
  // holes (AAPL's IEX bars begin 2020-07-27). A gap-spanning return looks like a
  // one-day move and silently corrupts any lookback that crosses it.
  const batch = await captureUrls(() => fetchAlpacaCandlesBatch(["AAPL"], "max", "1d"));
  assert.equal(new URL(batch[0]).searchParams.get("feed"), "sip");

  const single = await captureUrls(() =>
    fetchAlpacaCandles("AAPL", "max", "1d").catch(() => undefined),
  );
  assert.equal(new URL(single[0]).searchParams.get("feed"), "sip");
});

test("ALPACA_FEED overrides the feed for keys without SIP entitlement", async () => {
  const urls = await captureUrls(() => fetchAlpacaCandlesBatch(["AAPL"], "max", "1d"), "iex");
  assert.equal(new URL(urls[0]).searchParams.get("feed"), "iex");
});

test("SIP requests hold `end` back past the delayed-data boundary", async () => {
  // Alpaca 403s the ENTIRE request when `end` reaches into the last ~15 minutes
  // of SIP data ("subscription does not permit querying recent SIP data"), so an
  // end of `now` returns no bars at all rather than a shorter series.
  const before = Date.now();
  const urls = await captureUrls(() => fetchAlpacaCandlesBatch(["AAPL"], "max", "1d"));
  const end = Date.parse(new URL(urls[0]).searchParams.get("end")!);
  assert.ok(end <= before - 15 * 60_000, `end must be at least 15 min old, was ${before - end}ms`);
  assert.ok(end > before - 60 * 60_000, "end must not be held back further than necessary");
});

test("IEX requests are not held back, since the delay is a SIP restriction", async () => {
  const before = Date.now();
  const urls = await captureUrls(() => fetchAlpacaCandlesBatch(["AAPL"], "max", "1d"), "iex");
  const end = Date.parse(new URL(urls[0]).searchParams.get("end")!);
  assert.ok(end >= before - 5_000, `IEX end should be ~now, was ${before - end}ms old`);
});

/** Stub fetch with a scripted list of responses; restores env and fetch afterwards. */
async function withScriptedFetch(
  responses: { status: number; body?: unknown }[],
  run: () => Promise<unknown>,
): Promise<{ urls: string[]; result: unknown }> {
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  const prev = { k: process.env.ALPACA_KEY, s: process.env.ALPACA_SECRET, f: process.env.ALPACA_FEED };
  process.env.ALPACA_KEY = "k";
  process.env.ALPACA_SECRET = "s";
  delete process.env.ALPACA_FEED;
  let i = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: new Headers(),
      json: async () => r.body,
      text: async () => "",
    } as Response;
  }) as typeof fetch;
  try {
    return { urls, result: await run() };
  } finally {
    globalThis.fetch = realFetch;
    for (const [name, v] of [["ALPACA_KEY", prev.k], ["ALPACA_SECRET", prev.s], ["ALPACA_FEED", prev.f]] as const) {
      if (v === undefined) delete process.env[name];
      else process.env[name] = v;
    }
  }
}

const noSleep = { sleep: async () => {} };

test("fetchAlpacaRange uses the explicit start/end, SIP, adjusted bars, and follows pages", async () => {
  const start = "2023-10-01T00:00:00.000Z";
  const end = "2026-10-30T20:00:00.000Z";
  const { urls, result } = await withScriptedFetch(
    [
      { status: 200, body: { bars: { AAPL: [{ t: "2024-01-02T14:30:00Z", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] }, next_page_token: "p2" } },
      { status: 200, body: { bars: { AAPL: [{ t: "2024-01-02T14:35:00Z", o: 1.5, h: 2, l: 1, c: 1.8, v: 20 }] }, next_page_token: null } },
    ],
    () => fetchAlpacaRange(["AAPL"], start, end, "5m", "all", noSleep),
  );
  assert.equal(urls.length, 2);
  const p = new URL(urls[0]).searchParams;
  assert.equal(p.get("start"), start);
  assert.equal(p.get("end"), end);
  assert.equal(p.get("feed"), "sip");
  assert.equal(p.get("adjustment"), "all");
  assert.equal(p.get("timeframe"), "5Min");
  assert.equal(new URL(urls[1]).searchParams.get("page_token"), "p2");
  const map = result as Map<string, { t: number; c: number }[]>;
  assert.deepEqual(map.get("AAPL")?.map((c) => c.c), [1.5, 1.8]);
});

test("fetchAlpacaRange retries a 429 instead of skipping the symbols", async () => {
  const ok = { status: 200, body: { bars: { AAPL: [{ t: "2024-01-02T14:30:00Z", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] }, next_page_token: null } };
  const { urls, result } = await withScriptedFetch(
    [{ status: 429 }, { status: 429 }, { status: 429 }, ok],
    () => fetchAlpacaRange(["AAPL"], "2024-01-01T00:00:00Z", "2024-01-03T00:00:00Z", "5m", "all", noSleep),
  );
  assert.equal(urls.length, 4);
  assert.equal((result as Map<string, unknown[]>).get("AAPL")?.length, 1);
});

test("fetchAlpacaRange can ask for raw (as-traded) bars; the default stays adjusted", async () => {
  const ok = { status: 200, body: { bars: {}, next_page_token: null } };
  const raw = await withScriptedFetch([ok], () =>
    fetchAlpacaRange(["AAPL"], "2024-01-01T00:00:00Z", "2024-01-03T00:00:00Z", "1d", "raw", noSleep),
  );
  assert.equal(new URL(raw.urls[0]).searchParams.get("adjustment"), "raw");
  const dflt = await withScriptedFetch([ok], () =>
    fetchAlpacaRange(["AAPL"], "2024-01-01T00:00:00Z", "2024-01-03T00:00:00Z", "1d"),
  );
  assert.equal(new URL(dflt.urls[0]).searchParams.get("adjustment"), "all");
});

test("fetchAlpacaRange still skips a chunk on a plain 4xx", async () => {
  const { urls, result } = await withScriptedFetch(
    [{ status: 422 }],
    () => fetchAlpacaRange(["BAD"], "2024-01-01T00:00:00Z", "2024-01-03T00:00:00Z", "1d", "all", noSleep),
  );
  assert.equal(urls.length, 1);
  assert.equal((result as Map<string, unknown[]>).size, 0);
});
