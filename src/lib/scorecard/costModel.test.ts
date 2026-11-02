import "dotenv/config"; // runResearch.ts imports prisma at module scope
import test from "node:test";
import assert from "node:assert/strict";
import { RESEARCH_COST_MODEL } from "@/lib/research/runResearch";
import { SCORECARD_COST_MODEL } from "./types";

// score.ts stays free of the prisma import chain, so types.ts keeps its own copy of
// the research cost model. This test is what stops the two from drifting apart.
test("SCORECARD_COST_MODEL equals RESEARCH_COST_MODEL", () => {
  assert.deepEqual(SCORECARD_COST_MODEL, RESEARCH_COST_MODEL);
});
