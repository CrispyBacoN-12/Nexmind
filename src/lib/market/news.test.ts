import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchRecentNews } from "./news";

/** Runs `fn` with FINNHUB_API_KEY and global fetch replaced, restoring both afterwards. */
async function withFinnhub<T>(
  key: string | undefined,
  impl: (url: string) => Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const realFetch = globalThis.fetch;
  const realKey = process.env.FINNHUB_API_KEY;
  if (key === undefined) delete process.env.FINNHUB_API_KEY;
  else process.env.FINNHUB_API_KEY = key;
  globalThis.fetch = ((url: string) => impl(String(url))) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.FINNHUB_API_KEY;
    else process.env.FINNHUB_API_KEY = realKey;
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("a quiet stock is empty with a note and NOT failed", async () => {
  const r = await withFinnhub("k", async () => json([]), () => fetchRecentNews("KO", 2, 3));
  assert.deepEqual(r.items, []);
  assert.match(r.note ?? "", /no company news/);
  assert.notEqual(r.failed, true);
});

test("headlines come back newest first and unfailed", async () => {
  const body = [
    { headline: "old", url: "https://x/1", datetime: 1_700_000_000, source: "A" },
    { headline: "new", url: "https://x/2", datetime: 1_700_100_000, source: "B" },
  ];
  const r = await withFinnhub("k", async () => json(body), () => fetchRecentNews("KO", 2, 3));
  assert.deepEqual(
    r.items.map((i) => i.headline),
    ["new", "old"],
  );
  assert.equal(r.failed, undefined);
});

test("a missing key is a failure", async () => {
  const r = await withFinnhub(undefined, async () => json([]), () => fetchRecentNews("KO"));
  assert.equal(r.failed, true);
  assert.deepEqual(r.items, []);
  assert.ok(r.note);
});

test("an HTTP error is a failure", async () => {
  const r = await withFinnhub("k", async () => json({}, 429), () => fetchRecentNews("KO"));
  assert.equal(r.failed, true);
  assert.match(r.note ?? "", /429/);
});

test("an unexpected body shape is a failure", async () => {
  const r = await withFinnhub("k", async () => json({ error: "x" }), () => fetchRecentNews("KO"));
  assert.equal(r.failed, true);
});

test("a network error is a failure and never throws", async () => {
  const r = await withFinnhub(
    "k",
    async () => {
      throw new Error("socket hang up");
    },
    () => fetchRecentNews("KO"),
  );
  assert.equal(r.failed, true);
  assert.match(r.note ?? "", /socket hang up/);
});

test("a non-equity symbol is not a failure", async () => {
  const r = await withFinnhub("k", async () => json([]), () => fetchRecentNews("GC=F"));
  assert.deepEqual(r.items, []);
  assert.ok(r.note);
  assert.notEqual(r.failed, true);
});
