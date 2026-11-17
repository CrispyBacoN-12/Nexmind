import "dotenv/config"; // nightly.ts -> control.ts reaches prisma via research/control.ts
import test from "node:test";
import assert from "node:assert/strict";
import { runScorecardNightly, type LiveSnapshot } from "@/lib/scorecard/nightly";
import { isLiveSnapshot } from "./guards";

async function snapshot(): Promise<LiveSnapshot> {
  return runScorecardNightly({
    now: () => Date.parse("2026-11-03T13:00:00Z"),
    loadRows: async () => [],
    fetchBars: async () => new Map(),
    saveOutcomes: async () => {},
    loadRuns: async () => [],
    loadVerdict: async () => null,
    saveLive: async () => {},
    saveVerdict: async () => {},
    send: async () => {},
  });
}

test("isLiveSnapshot: rulesVsHold is optional, checked when present", async () => {
  const base = await snapshot();
  const { rulesVsHold: _drop, ...older } = base;
  void _drop;
  assert.equal(isLiveSnapshot(older), true, "an older snapshot without the field");
  assert.equal(isLiveSnapshot({ ...base, rulesVsHold: [{ date: "2026-11-02", rules: 0.5, hold: 1, n: 1 }] }), true);
  assert.equal(isLiveSnapshot({ ...base, rulesVsHold: [{ date: "x" }] }), false);
  assert.equal(isLiveSnapshot({ ...base, rulesVsHold: "nope" }), false);
});
