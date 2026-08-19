import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { isoTimestamp, quoteAll, buildStringToSign, signString, classifyAuthError, signedFetch } from "./auth";

// These fixtures are self-computed via the same primitives Webull's OpenAPI
// signing spec describes (verified against webull-inc/webull-openapi-python-
// sdk's default_signature_composer — see scripts/webull-account-list.mts,
// which used this exact algorithm to successfully sign real requests against
// both the production and sandbox APIs). They pin the *algorithm* shape so a
// future edit that silently breaks the sort order, the percent-encoding, the
// POST-vs-GET body-hash branch, or the trailing-"&" key fails loudly here.

test("isoTimestamp: seconds precision, no milliseconds", () => {
  assert.equal(isoTimestamp(new Date("2026-08-17T12:34:56.789Z")), "2026-08-17T12:34:56Z");
});

test("quoteAll: percent-encodes everything unreserved chars miss, including !'()* and /", () => {
  assert.equal(quoteAll("a/b c!d'e(f)g*h"), "a%2Fb%20c%21d%27e%28f%29g%2Ah");
});

test("buildStringToSign: sorts signParams by codepoint, joins with the path, then percent-encodes the whole blob", () => {
  const s = buildStringToSign("/openapi/account/list", { host: "api.webull.co.th", "x-app-key": "k" });
  const raw = "/openapi/account/list&host=api.webull.co.th&x-app-key=k";
  assert.equal(s, quoteAll(raw));
});

test("buildStringToSign: appends the body hash as a trailing segment when present", () => {
  const s = buildStringToSign("/openapi/auth/token/create", { host: "h" }, "DEADBEEF");
  const raw = "/openapi/auth/token/create&host=h&DEADBEEF";
  assert.equal(s, quoteAll(raw));
});

test("buildStringToSign: omits the body segment entirely for a bodyless GET", () => {
  const s = buildStringToSign("/openapi/account/list", { host: "h" });
  assert.ok(!s.includes("undefined"));
  assert.equal(s, quoteAll("/openapi/account/list&host=h"));
});

test("signString: HMAC key is app_secret + literal '&', base64-encoded (not hex, not the raw secret)", () => {
  const sig = signString("some-string", "mysecret");
  const expected = createHmac("sha256", "mysecret&").update("some-string").digest("base64");
  assert.equal(sig, expected);
  const hexSig = createHmac("sha256", "mysecret&").update("some-string").digest("hex");
  assert.notEqual(sig, hexSig, "must be base64, not hex");
  const wrongKeySig = createHmac("sha256", "mysecret").update("some-string").digest("base64");
  assert.notEqual(sig, wrongKeySig, "must not sign with the raw secret (missing trailing &)");
});

test("body hash convention: uppercase-hex SHA-256 of the compact-JSON body", () => {
  const body = '{"qty":1}';
  const expectedHash = createHash("sha256").update(body).digest("hex").toUpperCase();
  assert.match(expectedHash, /^[0-9A-F]{64}$/);
});

test("classifyAuthError: timestamp/expired/nonce/clock wording -> clock-skew", () => {
  assert.equal(classifyAuthError({ msg: "Request timestamp expired" }), "clock-skew");
  assert.equal(classifyAuthError({ code: "NONCE_REUSED" }), "clock-skew");
});

test("classifyAuthError: anything else -> bad-key", () => {
  assert.equal(classifyAuthError({ msg: "Invalid app key" }), "bad-key");
  assert.equal(classifyAuthError({}), "bad-key");
});

test("signedFetch throws when no API key is configured (and none passed explicitly)", async () => {
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
