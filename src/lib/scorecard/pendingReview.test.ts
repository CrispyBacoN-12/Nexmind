// Tests for the local review of pending captured rows. All I/O is stubbed.

import test from "node:test";
import assert from "node:assert/strict";
import type { ReviewItem, Review, reviewSetups } from "@/lib/chartAgent/review";
import type { Setup } from "@/lib/chartAgent/types";
import { applyPendingReviews, type PendingReviewDeps, type PendingRow, type ReviewUpdate } from "./pendingReview";

const NOW = 1_800_000_000_000;

function item(ticker: string): ReviewItem {
  const bar = { t: 1_000_000, o: 99.5, h: 100.2, l: 98.5, c: 99.5, v: 1000 };
  const setup: Setup = {
    ticker, entry: 100, stop: 98.4,
    t1: { price: 105, names: ["PDH"], r: 3.1 }, t2: null,
    sweptLevels: ["PDL"], sweepBar: bar, tags: [],
    levels: { pPOC: 100, pVAH: 101, pVAL: 99.5, PDH: 105, PDL: 99, PMH: null, PML: null, dPOC: 100.1 },
    dataAsOf: "2026-11-02T15:15:00.000Z",
  };
  return { setup, recent: [bar] };
}

const row = (id: number, runId: string, ticker: string, order: number): PendingRow => ({
  id, runId, reviewInput: JSON.parse(JSON.stringify({ order, item: item(ticker) })),
});

const keep: Review = { status: "kept", reading: "อ่านแล้ว", reason: null };

interface Rec { updates: ReviewUpdate[]; counts: { runId: string; c: Parameters<PendingReviewDeps["saveRunCounts"]>[1] }[]; calls: string[][] }

function make(rows: PendingRow[], answer: (items: ReviewItem[]) => Awaited<ReturnType<typeof reviewSetups>>) {
  const rec: Rec = { updates: [], counts: [], calls: [] };
  const deps: PendingReviewDeps = {
    now: () => NOW,
    loadPending: async () => rows,
    review: async (items) => { rec.calls.push(items.map((i) => i.setup.ticker)); return answer(items); },
    saveRow: async (u) => { rec.updates.push(u); },
    saveRunCounts: async (runId, c) => { rec.counts.push({ runId, c }); },
  };
  return { deps, rec };
}

const answerAll = (items: ReviewItem[]) => ({
  reviews: new Map(items.map((i) => [i.setup.ticker, keep])),
  backend: "claude-cli", note: null, model: "m1",
});

test("reviews a run once and writes decided statuses", async () => {
  const rows = [row(1, "A", "AAA", 0), row(2, "A", "BBB", 1), row(3, "A", "CCC", 2), row(4, "B", "DDD", 0)];
  const { deps, rec } = make(rows, (items) => ({
    reviews: new Map<string, Review>(items.map((i) => [i.setup.ticker, i.setup.ticker === "BBB"
      ? { status: "rejected" as const, reading: null, reason: "เพราะ" } : keep])),
    backend: "claude-cli", note: null, model: "m1",
  }));
  const out = await applyPendingReviews(deps);
  assert.equal(rec.calls.length, 2);
  assert.deepEqual(rec.calls[0], ["AAA", "BBB", "CCC"]);
  assert.deepEqual(out, { runs: 2, reviewed: 4, skipped: 0, invalid: 0, note: null });
  const by = new Map(rec.updates.map((u) => [u.id, u]));
  assert.equal(by.get(1)?.status, "shown");
  assert.equal(by.get(1)?.aiReading, "อ่านแล้ว");
  assert.equal(by.get(1)?.aiRejectReason, null);
  assert.equal(by.get(2)?.status, "ai_rejected");
  assert.equal(by.get(2)?.aiRejectReason, "เพราะ");
  assert.equal(by.get(2)?.aiReading, null);
  assert.equal(by.get(1)?.aiBackend, "claude-cli");
  assert.equal(by.get(1)?.aiModel, "m1");
  assert.equal(by.get(1)?.reviewedAt.getTime(), NOW);
});

test("AI unavailable leaves rows pending", async () => {
  for (const ans of [
    { reviews: new Map(), backend: "mock", note: null, model: null },
    { reviews: new Map(), backend: "claude-cli", note: "failed", model: null },
  ]) {
    const { deps, rec } = make([row(1, "A", "AAA", 0)], () => ans);
    const out = await applyPendingReviews(deps);
    assert.equal(rec.updates.length, 0);
    assert.equal(rec.counts.length, 0);
    assert.equal(out.skipped, 1);
    assert.equal(out.reviewed, 0);
  }
});

test("invalid reviewInput is finalized as unread, not left pending", async () => {
  const bad: PendingRow = { id: 9, runId: "A", reviewInput: { nope: true } };
  const { deps, rec } = make([row(1, "A", "AAA", 0), bad], answerAll);
  const out = await applyPendingReviews(deps);
  assert.equal(out.invalid, 1);
  const u = rec.updates.find((x) => x.id === 9);
  assert.equal(u?.aiBackend, "review_input_invalid");
  assert.equal(u?.aiReading, null);
  assert.equal(u?.aiModel, null);
  assert.equal(u?.status, undefined);
  assert.equal(u?.reviewedAt.getTime(), NOW);
  assert.ok(rec.updates.some((x) => x.id === 1 && x.aiBackend === "claude-cli"));
  assert.deepEqual(rec.calls[0], ["AAA"]);
});

test("a ticker missing from the AI answer is finalized as unread", async () => {
  const { deps, rec } = make([row(1, "A", "AAA", 0), row(2, "A", "BBB", 1)], (items) => ({
    reviews: new Map([["AAA", keep]]), backend: "claude-cli", note: null, model: "m1",
  }));
  const out = await applyPendingReviews(deps);
  assert.equal(out.reviewed, 2);
  const u = rec.updates.find((x) => x.id === 2);
  assert.equal(u?.status, "shown");
  assert.equal(u?.aiReading, null);
  assert.equal(u?.aiBackend, "claude-cli");
  assert.equal(rec.counts[0].c.unread, 1);
  assert.equal(rec.counts[0].c.kept, 1);
});

test("rows are reviewed in stored input order, not id order", async () => {
  const rows = ["T0", "T1", "T2", "T3", "T4", "T5"].map((t, i) => row(10 - i, "A", t, i));
  const { deps, rec } = make(rows.reverse(), answerAll);
  await applyPendingReviews(deps);
  assert.deepEqual(rec.calls[0], ["T0", "T1", "T2", "T3", "T4", "T5"]);
  const by = new Map(rec.updates.map((u) => [u.id, u.status]));
  assert.equal(by.get(5), "capped"); // T5, order 5, id 5
  assert.equal(by.get(10), "shown");
});

test("run counts come from groupOf", async () => {
  const rows = [row(1, "A", "AAA", 0), row(2, "A", "BBB", 1), row(3, "A", "CCC", 2), row(4, "A", "DDD", 3)];
  const { deps, rec } = make(rows, () => ({
    reviews: new Map<string, Review>([
      ["AAA", keep],
      ["BBB", { status: "rejected", reading: null, reason: "x" }],
      ["CCC", { status: "stripped", reading: null, reason: "y" }],
    ]),
    backend: "claude-cli", note: null, model: "m1",
  }));
  await applyPendingReviews(deps);
  assert.deepEqual(rec.counts, [{ runId: "A", c: { kept: 1, vetoed: 1, stripped: 1, unread: 1, aiBackend: "claude-cli", aiModel: "m1" } }]);
});
