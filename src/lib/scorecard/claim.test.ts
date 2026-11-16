// The session claim keeps the cloud capture and the local fallback from both logging one session.

import test from "node:test";
import assert from "node:assert/strict";
import { claimKey, claimSession, makeAlreadyRan, type ClaimDeps, type SessionGuardDeps } from "./claim";
import { SCORECARD_CLAIM_STALE_MINUTES } from "./types";

const T0 = Date.parse("2026-11-16T15:31:00Z");
const MIN = 60_000;

/** An in-memory Setting table whose create fails on an existing key, like the @id constraint. */
function store(nowMs: () => number, seed: Record<string, string> = {}) {
  const rows = new Map(Object.entries(seed));
  const deps: ClaimDeps = {
    create: async (key, value) => {
      await Promise.resolve(); // let a racing claimer interleave
      if (rows.has(key)) throw new Error("Unique constraint failed on the fields: (`key`)");
      rows.set(key, value);
    },
    read: async (key) => (rows.has(key) ? { value: rows.get(key)! } : null),
    overwrite: async (key, value) => {
      rows.set(key, value);
    },
    now: nowMs,
  };
  return { deps, rows };
}

const claimAt = (owner: string, ms: number) => JSON.stringify({ owner, at: new Date(ms).toISOString() });

test("constant: a claim goes stale after 20 minutes", () => {
  assert.equal(SCORECARD_CLAIM_STALE_MINUTES, 20);
});

test("two claimers for one session: exactly one gets it", async () => {
  const { deps, rows } = store(() => T0);
  const results = await Promise.all([claimSession(deps, "2026-11-16", "cloud"), claimSession(deps, "2026-11-16", "local")]);
  assert.deepEqual([...results].sort(), ["claimed", "taken"]);
  const stored = JSON.parse(rows.get(claimKey("2026-11-16"))!);
  assert.equal(stored.owner, results[0] === "claimed" ? "cloud" : "local");
  assert.equal(stored.at, new Date(T0).toISOString());
});

test("the key is per session date", async () => {
  const { deps } = store(() => T0);
  assert.equal(claimKey("2026-11-16"), "scorecard:claim:2026-11-16");
  assert.equal(await claimSession(deps, "2026-11-16", "cloud"), "claimed");
  assert.equal(await claimSession(deps, "2026-11-17", "local"), "claimed");
});

test("a stale claim (21 minutes) is taken over", async () => {
  const { deps, rows } = store(() => T0, { [claimKey("2026-11-16")]: claimAt("cloud", T0 - 21 * MIN) });
  assert.equal(await claimSession(deps, "2026-11-16", "local"), "claimed");
  assert.deepEqual(JSON.parse(rows.get(claimKey("2026-11-16"))!), { owner: "local", at: new Date(T0).toISOString() });
});

test("a fresh claim (5 minutes) is not taken over", async () => {
  const before = claimAt("cloud", T0 - 5 * MIN);
  const { deps, rows } = store(() => T0, { [claimKey("2026-11-16")]: before });
  assert.equal(await claimSession(deps, "2026-11-16", "local"), "taken");
  assert.equal(rows.get(claimKey("2026-11-16")), before);
});

test("an unreadable stored claim is taken over", async () => {
  const { deps } = store(() => T0, { [claimKey("2026-11-16")]: "not json" });
  assert.equal(await claimSession(deps, "2026-11-16", "local"), "claimed");
});

test("a create error that is not a duplicate propagates", async () => {
  const boom = new Error("connection reset");
  const deps: ClaimDeps = {
    create: async () => {
      throw boom;
    },
    read: async () => null,
    overwrite: async () => assert.fail("must not overwrite"),
    now: () => T0,
  };
  await assert.rejects(claimSession(deps, "2026-11-16", "cloud"), (e) => e === boom);
});

// --- makeAlreadyRan: the shared alreadyRan dep of both capture scripts --------------

function guard(over: Partial<SessionGuardDeps> = {}) {
  const calls = { claims: [] as string[], logs: [] as string[], rowsRange: [] as [number, number][] };
  const deps: SessionGuardDeps = {
    countDoneRuns: async () => 0,
    countScheduledRows: async (s, e) => {
      calls.rowsRange.push([s, e]);
      return 0;
    },
    claim: async (d) => {
      calls.claims.push(d);
      return "claimed";
    },
    log: (m) => void calls.logs.push(m),
    ...over,
  };
  return { alreadyRan: makeAlreadyRan(deps), calls };
}

test("alreadyRan: a ran / no_session row means done, and nothing is claimed", async () => {
  const { alreadyRan, calls } = guard({ countDoneRuns: async () => 1 });
  assert.equal(await alreadyRan("2026-11-16"), true);
  assert.deepEqual(calls.claims, []);
});

test("alreadyRan: scheduled rows with no run row mean done, and nothing is claimed", async () => {
  const { alreadyRan, calls } = guard({ countScheduledRows: async () => 3 });
  assert.equal(await alreadyRan("2026-11-16"), true);
  assert.deepEqual(calls.claims, []);
  assert.equal(calls.logs.length, 1);
  assert.match(calls.logs[0], /2026-11-16 already has 3 scheduled ChartSetup rows/);
});

test("alreadyRan: the orphan check reads that ET day", async () => {
  const { alreadyRan, calls } = guard();
  await alreadyRan("2026-11-16");
  // 2026-11-16 is in EST (UTC-5).
  assert.deepEqual(calls.rowsRange, [[Date.parse("2026-11-16T05:00:00Z"), Date.parse("2026-11-17T05:00:00Z")]]);
});

test("alreadyRan: claims the session when nothing ran; false only when claimed", async () => {
  const { alreadyRan, calls } = guard();
  assert.equal(await alreadyRan("2026-11-16"), false);
  assert.deepEqual(calls.claims, ["2026-11-16"]);
  assert.deepEqual(calls.logs, []);
});

test("alreadyRan: a claim held by another runner reads as already ran", async () => {
  const { alreadyRan, calls } = guard({ claim: async () => "taken" });
  assert.equal(await alreadyRan("2026-11-16"), true);
  assert.equal(calls.logs.length, 1);
  assert.match(calls.logs[0], /claimed by another runner/);
});

test("alreadyRan: two machines racing on one session, through the real claim: one runs", async () => {
  const { deps } = store(() => T0);
  const side = (owner: string) =>
    makeAlreadyRan({
      countDoneRuns: async () => 0,
      countScheduledRows: async () => 0,
      claim: (d) => claimSession(deps, d, owner),
      log: () => {},
    });
  const ran = await Promise.all([side("cloud")("2026-11-16"), side("local")("2026-11-16")]);
  assert.deepEqual([...ran].sort(), [false, true]);
});
