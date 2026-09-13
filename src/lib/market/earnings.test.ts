// Every path here asserts the same property: the function resolves, and when it
// has no date it still has a reason. It is the caller's ONLY defence — the card
// renders whatever comes back, so a bare null would be printed as reassurance.

import { test } from "node:test";
import assert from "node:assert/strict";

import { EARNINGS_HORIZON_DAYS, fetchNextEarnings } from "./earnings";

const TODAY = new Date("2026-09-14T00:00:00Z");

async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const prevFetch = globalThis.fetch;
  const prevKey = process.env.FINNHUB_API_KEY;
  globalThis.fetch = impl;
  process.env.FINNHUB_API_KEY = "test-key";
  try {
    return await fn();
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey != null) process.env.FINNHUB_API_KEY = prevKey;
    else delete process.env.FINNHUB_API_KEY;
  }
}

const ok = (body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;

test("fetchNextEarnings: returns the EARLIEST dated row, not the first one returned", async () => {
  const got = await withFetch(
    ok({ earningsCalendar: [
      { symbol: "AAPL", date: "2026-12-01", hour: "bmo" },
      { symbol: "AAPL", date: "2026-10-28", hour: "amc" },
    ] }),
    () => fetchNextEarnings("AAPL", TODAY),
  );
  assert.equal(got.date, "2026-10-28");
  assert.equal(got.hour, "amc");
});

test("fetchNextEarnings: queries a window that starts today and spans the horizon", async () => {
  let url = "";
  await withFetch(
    (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ earningsCalendar: [] }), { status: 200 });
    }) as typeof fetch,
    () => fetchNextEarnings("AAPL", TODAY),
  );
  assert.match(url, /from=2026-09-14/);
  assert.match(url, /to=2027-01-12/); // 2026-09-14 + 120 days
  assert.match(url, /symbol=AAPL/);
  assert.equal(EARNINGS_HORIZON_DAYS, 120);
});

test("fetchNextEarnings: an empty calendar is 'none scheduled', never a bare null", async () => {
  const got = await withFetch(ok({ earningsCalendar: [] }), () => fetchNextEarnings("AAPL", TODAY));
  assert.equal(got.date, null);
  assert.match(got.note!, /no report scheduled/);
});

test("fetchNextEarnings: rows with no usable date do not become the answer", async () => {
  const got = await withFetch(
    ok({ earningsCalendar: [{ symbol: "AAPL", hour: "amc" }, { symbol: "AAPL", date: "" }] }),
    () => fetchNextEarnings("AAPL", TODAY),
  );
  assert.equal(got.date, null);
  assert.ok(got.note);
});

test("fetchNextEarnings: an HTTP failure reports the status rather than 'none scheduled'", async () => {
  const got = await withFetch(
    (async () => new Response("nope", { status: 429 })) as typeof fetch,
    () => fetchNextEarnings("AAPL", TODAY),
  );
  assert.equal(got.date, null);
  assert.match(got.note!, /429/);
});

test("fetchNextEarnings: a thrown fetch resolves with the reason instead of rejecting", async () => {
  const got = await withFetch(
    (async () => { throw new Error("network down"); }) as typeof fetch,
    () => fetchNextEarnings("AAPL", TODAY),
  );
  assert.equal(got.date, null);
  assert.match(got.note!, /network down/);
});

test("fetchNextEarnings: malformed JSON is a reason, not a crash", async () => {
  const got = await withFetch(
    (async () => new Response("<html>rate limited</html>", { status: 200 })) as typeof fetch,
    () => fetchNextEarnings("AAPL", TODAY),
  );
  assert.equal(got.date, null);
  assert.ok(got.note);
});

test("fetchNextEarnings: non-equities are refused before any network call", async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("must not be called"); }) as typeof fetch;
  try {
    for (const sym of ["BTC-USD", "^GSPC", "EURUSD=X"]) {
      const got = await fetchNextEarnings(sym, TODAY);
      assert.equal(got.date, null, sym);
      assert.match(got.note!, /no earnings calendar/, sym);
    }
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("fetchNextEarnings: a missing key says so, so it cannot read as an all-clear", async () => {
  const prevKey = process.env.FINNHUB_API_KEY;
  delete process.env.FINNHUB_API_KEY;
  try {
    const got = await fetchNextEarnings("AAPL", TODAY);
    assert.match(got.note!, /FINNHUB_API_KEY/);
  } finally {
    if (prevKey != null) process.env.FINNHUB_API_KEY = prevKey;
  }
});
