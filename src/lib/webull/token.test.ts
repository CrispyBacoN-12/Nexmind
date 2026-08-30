import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTokenRecord, needsRefresh, isExpired, REFRESH_WHEN_UNDER_MS, TOKEN_SETTING_KEY,
} from "./token";

const DAY = 86_400_000;
const NOW = Date.parse("2026-08-30T12:00:00Z");
const rec = (daysLeft: number) => ({ token: "t".repeat(32), expiresAt: NOW + daysLeft * DAY });

test("TOKEN_SETTING_KEY is namespaced so it cannot collide with another Setting", () => {
  assert.match(TOKEN_SETTING_KEY, /^webull:/);
});

test("parseTokenRecord accepts what storeWebullToken writes", () => {
  const r = parseTokenRecord(JSON.stringify({ token: "abc", expiresAt: 1789401997043 }));
  assert.deepEqual(r, { token: "abc", expiresAt: 1789401997043 });
});

test("parseTokenRecord returns null rather than throwing on anything malformed", () => {
  // A corrupt row must degrade to "no token" (→ fall through to Yahoo), never
  // crash a scan tick that had a perfectly good Alpaca answer waiting.
  for (const bad of [null, undefined, "", "not json", "{}", '{"token":"a"}', '{"expiresAt":1}',
                     '{"token":"","expiresAt":1}', '{"token":"a","expiresAt":"soon"}', "[]"]) {
    assert.equal(parseTokenRecord(bad as string), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test("isExpired is true only once the 15-day life has actually run out", () => {
  assert.equal(isExpired(rec(1), NOW), false);
  assert.equal(isExpired(rec(0.001), NOW), false);
  assert.equal(isExpired(rec(-0.001), NOW), true);
  assert.equal(isExpired(rec(-30), NOW), true);
});

test("needsRefresh fires with days of runway left, not at the cliff", () => {
  // The whole point: a failed refresh must have many daily scan ticks left to
  // retry in before the token dies and a human is needed again.
  assert.equal(REFRESH_WHEN_UNDER_MS >= 5 * DAY, true, "runway must be several days, not hours");
  assert.equal(needsRefresh(rec(15), NOW), false, "a freshly issued token is left alone");
  assert.equal(needsRefresh(rec(REFRESH_WHEN_UNDER_MS / DAY + 1), NOW), false);
  assert.equal(needsRefresh(rec(REFRESH_WHEN_UNDER_MS / DAY - 1), NOW), true);
  assert.equal(needsRefresh(rec(0.5), NOW), true);
});

test("needsRefresh is true for an already-expired token so the call is still attempted", () => {
  // Webull may or may not refresh a lapsed token. Trying costs one request and
  // the alternative is guaranteed failure, so try — and let the caller alert
  // when it comes back refused.
  assert.equal(needsRefresh(rec(-1), NOW), true);
});
