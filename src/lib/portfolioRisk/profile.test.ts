// Finnhub profile2 answers an ETF with HTTP 200 and an empty object (verified
// on two real ETFs 2026-11-25); a failure must never be mistaken for an ETF.

import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchProfileKind } from "./profile";

const ENV = { FINNHUB_API_KEY: "secret-key" };
const fake = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

test("fetchProfileKind: empty object → etf", async () => {
  assert.deepEqual(await fetchProfileKind("AAA", { fetchImpl: fake({}), env: ENV }), { kind: "etf", industry: null, note: null });
});

test("fetchProfileKind: profile with industry → stock", async () => {
  assert.deepEqual(await fetchProfileKind("AAA", { fetchImpl: fake({ name: "x", finnhubIndustry: "Semiconductors" }), env: ENV }), {
    kind: "stock",
    industry: "Semiconductors",
    note: null,
  });
  assert.deepEqual(await fetchProfileKind("AAA", { fetchImpl: fake({ name: "x" }), env: ENV }), { kind: "stock", industry: null, note: null });
});

test("fetchProfileKind: failures are unknown, never etf, never leak the key", async () => {
  const r429 = await fetchProfileKind("AAA", { fetchImpl: fake({}, 429), env: ENV });
  assert.deepEqual(r429, { kind: null, industry: null, note: "Finnhub HTTP 429" });
  const noKey = await fetchProfileKind("AAA", { fetchImpl: fake({}), env: {} });
  assert.equal(noKey.kind, null);
  assert.ok(noKey.note);
  const boom = (async () => {
    throw new Error("network down secret-key");
  }) as typeof fetch;
  const thrown = await fetchProfileKind("AAA", { fetchImpl: boom, env: ENV });
  assert.equal(thrown.kind, null);
  for (const r of [r429, noKey, thrown]) assert.ok(!JSON.stringify(r).includes("secret-key"));
});
