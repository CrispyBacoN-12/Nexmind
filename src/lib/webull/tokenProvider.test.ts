import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTokenProvider,
  parseTokenResponse,
  WebullTokenUnavailableError,
} from "./tokenProvider";
import type { WebullTokenRecord } from "./token";

const DAY = 86_400_000;
const NOW = Date.parse("2026-08-30T12:00:00Z");
const rec = (token: string, daysLeft: number): WebullTokenRecord => ({
  token,
  expiresAt: NOW + daysLeft * DAY,
});

/** A provider wired to fakes, plus the log of what it did to them. */
function harness(opts: {
  stored?: WebullTokenRecord | null;
  refresh?: (r: WebullTokenRecord) => Promise<WebullTokenRecord>;
}) {
  const calls = { load: 0, refresh: 0 };
  const saved: WebullTokenRecord[] = [];
  const outages: (string | null)[] = [];
  const provider = createTokenProvider({
    now: () => NOW,
    load: async () => {
      calls.load++;
      return opts.stored ?? null;
    },
    store: async (r) => {
      saved.push(r);
    },
    refresh: async (r) => {
      calls.refresh++;
      if (!opts.refresh) throw new Error("refresh not configured for this test");
      return opts.refresh(r);
    },
    onOutage: (reason) => {
      outages.push(reason);
    },
  });
  return { provider, calls, saved, outages };
}

test("parseTokenResponse reads a NORMAL create/check/refresh body", () => {
  const r = parseTokenResponse({ token: "abc", expires: 1789401997043, status: "NORMAL", expires_at: 1789401997043 });
  assert.deepEqual(r, { token: "abc", expiresAt: 1789401997043 });
});

test("parseTokenResponse rejects a token that is not yet approved", () => {
  // PENDING is what create returns before the human taps in the app. Treating
  // it as usable would sign every market-data call with a dead token.
  assert.equal(parseTokenResponse({ token: "abc", status: "PENDING", expires_at: 1 }), null);
});

test("parseTokenResponse rejects malformed bodies instead of throwing", () => {
  for (const bad of [null, undefined, "nope", {}, { status: "NORMAL" }, { token: "a", status: "NORMAL" }, { token: "", status: "NORMAL", expires_at: 1 }, { token: "a", status: "NORMAL", expires_at: "soon" }]) {
    assert.equal(parseTokenResponse(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test("a token with plenty of runway is served as-is, with no refresh call", async () => {
  const h = harness({ stored: rec("fresh", 14) });
  assert.equal(await h.provider.get(), "fresh");
  assert.equal(h.calls.refresh, 0);
  assert.deepEqual(h.saved, []);
});

test("whatever token refresh returns is the one persisted and served", async () => {
  // Webull sometimes hands back the same string with a later expiry and
  // sometimes a different string. Keeping the stored value instead of the
  // returned one would leave the next refresh aimed at a retired token.
  const h = harness({ stored: rec("old", 3), refresh: async () => rec("rotated", 15) });
  assert.equal(await h.provider.get(), "rotated");
  assert.equal(h.calls.refresh, 1);
  assert.deepEqual(h.saved, [rec("rotated", 15)]);
});

test("a failed refresh keeps serving the still-valid token and raises an outage", async () => {
  // 3 days of life left is still 3 more daily scans to retry in. Dropping
  // Webull over one bad request would be a self-inflicted outage.
  const h = harness({ stored: rec("old", 3), refresh: async () => { throw new Error("upstream 503"); } });
  assert.equal(await h.provider.get(), "old");
  assert.equal(h.outages.length, 1);
  assert.match(String(h.outages[0]), /upstream 503/);
  assert.match(String(h.outages[0]), /3\.0 days/, "the banner must say how long is left before a human is needed");
});

test("an expired token whose refresh fails is fatal, and says what the human must do", async () => {
  const h = harness({ stored: rec("dead", -1), refresh: async () => { throw new Error("INVALID_TOKEN"); } });
  await assert.rejects(() => h.provider.get(), (e: unknown) => {
    assert.ok(e instanceof WebullTokenUnavailableError);
    assert.match(e.message, /seed/i, "the banner must name the recovery step, not just the failure");
    return true;
  });
  assert.match(String(h.outages.at(-1)), /seed/i);
});

test("no stored token at all is reported as needing a seed, not as a crash", async () => {
  const h = harness({ stored: null });
  await assert.rejects(() => h.provider.get(), WebullTokenUnavailableError);
  assert.equal(h.calls.refresh, 0);
});

test("a 200-symbol scan refreshes once, not 200 times", async () => {
  // The real failure this prevents: 200 concurrent auth calls, and — on the
  // refreshes that do hand back a new string — every caller but one left
  // holding a token Webull just retired.
  const h = harness({ stored: rec("old", 3), refresh: async () => rec("rotated", 15) });
  const results = await Promise.all(Array.from({ length: 200 }, () => h.provider.get()));
  assert.deepEqual(new Set(results), new Set(["rotated"]));
  assert.equal(h.calls.refresh, 1);
  assert.equal(h.calls.load, 1, "and one DB read, not 200");
});

test("a healthy token clears a previously raised outage banner", async () => {
  const h = harness({ stored: rec("fresh", 14) });
  await h.provider.get();
  assert.deepEqual(h.outages, [null]);
});
