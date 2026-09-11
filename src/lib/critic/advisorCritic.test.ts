// critiqueCard never throws. Every failure mode the AI layer has — no backend
// configured, a CLI timeout, malformed JSON, a response that does not match the
// shape — resolves to { degraded: true, objections: [] } with a note saying
// why, because the card above it is already complete and correct and must not
// be taken down by a decoration.
//
// No dotenv import: anthropic.ts imports db lazily, inside persistOutage() and
// aiOutageStatus(), so nothing here touches prisma at module scope (contrast
// src/lib/trading/hawk.test.ts, which needs it).
//
// No network: the mock-backend path is reached by clearing both credentials,
// and the shape/guard paths are tested through the exported pure helpers.

import { test } from "node:test";
import assert from "node:assert/strict";

import { aiBackend } from "@/lib/anthropic";
import { critiqueCard, normalizeCritique } from "@/lib/critic/advisorCritic";

test("with no backend configured, critiqueCard degrades instead of throwing", async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  const path = process.env.PATH;
  process.env.ANTHROPIC_API_KEY = "";
  process.env.PATH = "";
  assert.equal(aiBackend(), "mock", "test must not reach a live backend");
  try {
    const r = await critiqueCard("[head]\nticker: AAPL");
    assert.equal(r.degraded, true);
    assert.deepEqual(r.objections, []);
    assert.deepEqual(r.stripped, []);
    assert.ok(r.note.length > 0, "a degraded result must say why");
    assert.equal(r.costUsd, 0);
  } finally {
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = key;
    if (path === undefined) delete process.env.PATH;
    else process.env.PATH = path;
  }
});

test("an all-directional response comes back empty with a populated stripped list", () => {
  const r = normalizeCritique(
    {
      objections: [
        { claim: "You should buy this", evidence: "the trend is up", severity: "serious" },
        { claim: "Better to sell into strength", evidence: "resistance at 240", severity: "note" },
      ],
      blindSpots: ["earnings date is not on the card"],
    },
    { model: "claude-sonnet-5", costUsd: 0 },
  );
  assert.deepEqual(r.objections, []);
  assert.equal(r.stripped.length, 2);
  assert.equal(r.degraded, false);
  assert.deepEqual(r.blindSpots, ["earnings date is not on the card"]);
});

test("normalizeCritique caps objections at four", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({
    claim: `structural problem ${i}`,
    evidence: `number ${i}`,
    severity: "concern",
  }));
  const r = normalizeCritique({ objections: many }, { model: "m", costUsd: 0 });
  assert.equal(r.objections.length, 4);
});

test("normalizeCritique survives junk: wrong types, missing fields, bad severity", () => {
  const r = normalizeCritique(
    {
      objections: [
        null,
        "a bare string",
        { claim: "", evidence: "x", severity: "concern" },
        { claim: "the ladder top is above every high in the window", evidence: "238.76 vs 236.00", severity: "APOCALYPSE" },
        { claim: "ATR is 1.8% of entry", evidence: 4.12 },
      ],
      blindSpots: [null, "news", 7],
    },
    { model: "m", costUsd: 0 },
  );
  assert.equal(r.objections.length, 2);
  assert.equal(r.objections[0]!.severity, "note", "an unknown severity falls back to the mildest");
  assert.equal(r.objections[1]!.evidence, "", "a non-string evidence becomes an empty string, never 4.12");
  assert.deepEqual(r.blindSpots, ["news"]);
  assert.equal(r.degraded, false);
});

test("normalizeCritique treats a missing objections array as zero objections, not an error", () => {
  const r = normalizeCritique({}, { model: "m", costUsd: 0 });
  assert.deepEqual(r.objections, []);
  assert.deepEqual(r.blindSpots, []);
  assert.equal(r.degraded, false);
});
