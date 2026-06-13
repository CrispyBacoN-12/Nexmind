import { test } from "node:test";
import assert from "node:assert/strict";
import { mockLesson } from "./memo";
import type { Trade } from "@/generated/prisma/client";

const trade = { symbol: "BTC-USD", side: "short" } as unknown as Trade;

test("mockLesson is deterministic and identifiable as a mock", () => {
  const result = mockLesson(trade, { outcome: "loss", exit: 64000, pnl: -120, rMultiple: -1.2 });
  assert.match(result.text, /BTC-USD/);
  assert.match(result.text, /short/);
  assert.match(result.text, /\(mock\)/);
  assert.equal(result.costUsd, 0);
});

test("mockLesson includes the R multiple when known", () => {
  const result = mockLesson(trade, { outcome: "loss", exit: 64000, pnl: -120, rMultiple: -1.2 });
  assert.match(result.text, /-1\.20/);
});

test("mockLesson omits R detail when unknown", () => {
  const result = mockLesson(trade, { outcome: "loss", exit: null, pnl: null, rMultiple: null });
  assert.doesNotMatch(result.text, /\(R /);
});
