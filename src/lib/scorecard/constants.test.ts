import "dotenv/config"; // panelRun.ts reaches prisma via the backtest engine
import test from "node:test";
import assert from "node:assert/strict";
import { CONTROL_RUNS, PANEL_SEED } from "@/lib/research/panelRun";
import { SCORECARD_CONTROL_RUNS, SCORECARD_SEED } from "./types";

// types.ts keeps its own copies so it stays free of the prisma import chain.
test("SCORECARD_CONTROL_RUNS and SCORECARD_SEED equal the panel's", () => {
  assert.equal(SCORECARD_CONTROL_RUNS, CONTROL_RUNS);
  assert.equal(SCORECARD_SEED, PANEL_SEED);
});
