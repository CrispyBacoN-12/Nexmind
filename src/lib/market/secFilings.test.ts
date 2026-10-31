import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEC_MIN_GAP_MS,
  createRequestLimiter,
  eightKRows,
  getJsonWith,
  parseRetryAfter,
  retryDelayMs,
  type SecHttpDeps,
} from "./secFilings";

test("keeps 8-K and 8-K/A, splits items, builds the filing URL", () => {
  const rows = eightKRows("0000320193", {
    form: ["10-Q", "8-K/A", "8-K", "4"],
    items: ["", "5.02", "2.02,9.01", ""],
    acceptanceDateTime: ["a", "2026-09-01T20:30:35.000Z", "2026-07-30T20:30:28.000Z", "b"],
    accessionNumber: ["x", "0001140361-26-035325", "0000320193-26-000018", "y"],
    primaryDocument: ["x", "ef20081427_8ka.htm", "aapl-20260730.htm", "y"],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].items, ["2.02", "9.01"]);
  assert.equal(rows[0].form, "8-K/A");
  assert.equal(rows[1].url, "https://www.sec.gov/Archives/edgar/data/320193/000032019326000018/aapl-20260730.htm");
});

test("a missing recent block is no rows, not a throw", () => {
  assert.deepEqual(eightKRows("1", undefined), []);
});

// ---------------------------------------------------------------------------
// Throttling: a shared limiter and a Retry-After-aware retry, with no real waiting.
// ---------------------------------------------------------------------------

function fakeClock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

function res(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function depsFor(responses: Response[], clock = fakeClock(), minGap = SEC_MIN_GAP_MS) {
  const starts: number[] = [];
  const queue = [...responses];
  const d: SecHttpDeps = {
    fetch: async () => {
      starts.push(clock.now());
      const r = queue.shift();
      if (!r) throw new Error("no more responses");
      return r;
    },
    sleep: clock.sleep,
    now: clock.now,
    limiter: createRequestLimiter(minGap, clock.now, clock.sleep),
  };
  return { d, starts, clock };
}

test("the limiter spaces request starts by at least the gap", async () => {
  const clock = fakeClock();
  const limiter = createRequestLimiter(125, clock.now, clock.sleep);
  const starts: number[] = [];
  for (let i = 0; i < 5; i++) {
    await limiter.wait();
    starts.push(clock.now());
  }
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 125, String(starts));
});

test("concurrent callers are queued, not released together", async () => {
  // A sleep that does not advance time models workers all asking at the same instant.
  let t = 0;
  const waits: number[] = [];
  const limiter = createRequestLimiter(
    125,
    () => t,
    async (ms) => {
      waits.push(ms);
    },
  );
  await Promise.all([limiter.wait(), limiter.wait(), limiter.wait(), limiter.wait()]);
  assert.deepEqual(waits, [125, 250, 375]);
  t = 10_000;
  waits.length = 0;
  await limiter.wait();
  assert.deepEqual(waits, [], "a long-idle limiter lets the next request straight through");
});

test("penalize pushes every later start back", async () => {
  const clock = fakeClock();
  const limiter = createRequestLimiter(125, clock.now, clock.sleep);
  limiter.penalize(2000);
  await limiter.wait();
  assert.equal(clock.sleeps[0], 2000);
});

test("parseRetryAfter reads seconds and HTTP dates, and rejects junk", () => {
  assert.equal(parseRetryAfter("7", 0), 7000);
  assert.equal(parseRetryAfter(" 0 ", 0), 0);
  assert.equal(parseRetryAfter("Thu, 01 Jan 1970 00:00:10 GMT", 4000), 6000);
  assert.equal(parseRetryAfter("Thu, 01 Jan 1970 00:00:01 GMT", 4000), 0);
  assert.equal(parseRetryAfter(null, 0), null);
  assert.equal(parseRetryAfter("", 0), null);
  assert.equal(parseRetryAfter("soon", 0), null);
});

test("retryDelayMs: 403/429 honour Retry-After, else wait at least 1.5 s", () => {
  assert.equal(retryDelayMs(429, "3", 0, 0), 3000);
  assert.equal(retryDelayMs(403, "3", 2, 0), 3000);
  assert.equal(retryDelayMs(429, null, 0, 0), 1500);
  assert.ok(retryDelayMs(403, null, 1, 0) >= 1500);
  assert.ok(retryDelayMs(429, "garbage", 0, 0) >= 1500);
  assert.equal(retryDelayMs(429, "99999", 0, 0), 30_000, "an absurd Retry-After is capped");
});

test("retryDelayMs: other failures keep the 0.4 / 0.8 / 1.6 s backoff", () => {
  assert.equal(retryDelayMs(500, null, 0, 0), 400);
  assert.equal(retryDelayMs(null, null, 1, 0), 800);
  assert.equal(retryDelayMs(503, "9", 2, 0), 1600, "Retry-After is only honoured on 403/429");
});

test("getJsonWith retries a 429 after its Retry-After, then succeeds", async () => {
  const { d, starts } = depsFor([res(429, {}, { "retry-after": "4" }), res(200, { ok: 1 })]);
  assert.deepEqual(await getJsonWith("u", d), { ok: 1 });
  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] >= 4000, String(starts));
});

test("getJsonWith waits at least 1.5 s after a 403 without Retry-After", async () => {
  const { d, starts } = depsFor([res(403), res(200, { ok: 2 })]);
  assert.deepEqual(await getJsonWith("u", d), { ok: 2 });
  assert.ok(starts[1] - starts[0] >= 1500, String(starts));
});

test("getJsonWith: a 404 is an answer, not retried", async () => {
  const { d, starts } = depsFor([res(404)]);
  assert.equal(await getJsonWith("u", d), null);
  assert.equal(starts.length, 1);
});

test("getJsonWith gives up after the attempt budget and says which status", async () => {
  const { d, starts } = depsFor([res(500), res(500), res(500)]);
  await assert.rejects(() => getJsonWith("u", d, 3), /sec HTTP 500/);
  assert.equal(starts.length, 3);
});

test("getJsonWith does not sleep after the last attempt", async () => {
  const { d, clock } = depsFor([res(500), res(500)]);
  await assert.rejects(() => getJsonWith("u", d, 2));
  // one backoff between the two attempts, none after the final one
  assert.deepEqual(
    clock.sleeps.filter((ms) => ms >= 400),
    [400],
  );
});

test("workers sharing one limiter are queued 125 ms apart", async () => {
  // Frozen clock: every worker asks at the same instant, so the queue shows in the sleeps.
  const waits: number[] = [];
  const frozen = () => 5_000;
  const noSleep = async (ms: number) => {
    waits.push(ms);
  };
  const d: SecHttpDeps = {
    fetch: async () => res(200, {}),
    sleep: noSleep,
    now: frozen,
    limiter: createRequestLimiter(SEC_MIN_GAP_MS, frozen, noSleep),
  };
  await Promise.all(Array.from({ length: 6 }, (_, i) => getJsonWith(`u${i}`, d)));
  assert.deepEqual(waits, [125, 250, 375, 500, 625]);
});
