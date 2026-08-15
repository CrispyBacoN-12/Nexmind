import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { buildSignatureString, signString, classifyAuthError, signedFetch } from "./auth";

// These fixtures are self-computed (via the same primitives Webull's OpenAPI
// signing spec describes: sorted host+nonce+params, POST body as
// toUpper(SHA256(body)), HMAC-SHA256 keyed by `secret + "&"`) — not literal
// values published by Webull, since none are available while authoring this
// offline. They pin the *algorithm* shape so a future edit that silently
// breaks the nonce/host inclusion, the POST-vs-GET body-hash branch, or the
// trailing-"&" key fails loudly here. Swap in a real Webull-published sample
// request/signature pair once available (see design doc §3a).

test("buildSignatureString: sorts host + nonce + params alphabetically", () => {
  const s = buildSignatureString({ host: "api.webull.com", params: { symbol: "AAPL", count: "50" }, nonce: "abc-123" });
  assert.equal(s, "count=50&host=api.webull.com&symbol=AAPL&x-signature-nonce=abc-123");
});

test("buildSignatureString: GET (no body) omits the body-hash segment entirely", () => {
  const s = buildSignatureString({ host: "h", params: {}, nonce: "n" });
  assert.equal(s, "host=h&x-signature-nonce=n");
  const emptyHash = createHash("sha256").update("").digest("hex").toUpperCase();
  assert.ok(!s.includes(emptyHash), "must not hash an empty body for a bodyless GET");
});

test("buildSignatureString: POST appends toUpper(SHA256(body)) as the last segment", () => {
  const body = '{"qty":1}';
  const s = buildSignatureString({ host: "h", params: {}, nonce: "n", body });
  const expectedHash = createHash("sha256").update(body).digest("hex").toUpperCase();
  assert.equal(s, `host=h&x-signature-nonce=n&${expectedHash}`);
});

test("signString: HMAC key is app_secret + literal '&', not the raw secret", () => {
  const sig = signString("some-string", "mysecret");
  const expected = createHmac("sha256", "mysecret&").update("some-string").digest("hex");
  assert.equal(sig, expected);
  const wrongKeySig = createHmac("sha256", "mysecret").update("some-string").digest("hex");
  assert.notEqual(sig, wrongKeySig, "must not sign with the raw secret (missing trailing &)");
});

test("classifyAuthError: timestamp/expired/nonce/clock wording -> clock-skew", () => {
  assert.equal(classifyAuthError({ msg: "Request timestamp expired" }), "clock-skew");
  assert.equal(classifyAuthError({ code: "NONCE_REUSED" }), "clock-skew");
});

test("classifyAuthError: anything else -> bad-key", () => {
  assert.equal(classifyAuthError({ msg: "Invalid app key" }), "bad-key");
  assert.equal(classifyAuthError({}), "bad-key");
});

test("signedFetch throws when no API key is configured", async () => {
  const prevKey = process.env.WEBULL_APP_KEY;
  const prevSecret = process.env.WEBULL_APP_SECRET;
  delete process.env.WEBULL_APP_KEY;
  delete process.env.WEBULL_APP_SECRET;
  try {
    await assert.rejects(() => signedFetch("/x", { baseUrl: "https://example.com" }), /WEBULL_APP_KEY/);
  } finally {
    if (prevKey !== undefined) process.env.WEBULL_APP_KEY = prevKey;
    if (prevSecret !== undefined) process.env.WEBULL_APP_SECRET = prevSecret;
  }
});
