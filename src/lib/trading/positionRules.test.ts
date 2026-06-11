import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAction, type OpenPosition } from "./positionRules";

const long: OpenPosition = { side: "long", entry: 100, sl: 95, tp1: 110, tp2: 120 };
const short: OpenPosition = { side: "short", entry: 100, sl: 105, tp1: 90, tp2: 80 };

test("holds between SL and TP1", () => {
  assert.deepEqual(decideAction(long, {}, 105), { kind: "hold" });
  assert.deepEqual(decideAction(short, {}, 95), { kind: "hold" });
});

test("full loss at SL before TP1", () => {
  assert.deepEqual(decideAction(long, {}, 94), { kind: "close", outcome: "loss", exit: 95 });
  assert.deepEqual(decideAction(short, {}, 106), { kind: "close", outcome: "loss", exit: 105 });
});

test("TP1 with a TP2 → partial close", () => {
  assert.deepEqual(decideAction(long, {}, 111), { kind: "partial-tp1", exit: 110 });
  assert.deepEqual(decideAction(short, {}, 89), { kind: "partial-tp1", exit: 90 });
});

test("TP1 without TP2 → legacy full win", () => {
  assert.deepEqual(decideAction({ ...long, tp2: null }, {}, 111), { kind: "close", outcome: "win", exit: 110 });
});

test("after partial: TP2 closes the rest as win", () => {
  // After the partial, manage.ts has moved sl → entry (100 / 100).
  assert.deepEqual(decideAction({ ...long, sl: 100 }, { tp1Hit: true }, 121), { kind: "close", outcome: "win", exit: 120 });
  assert.deepEqual(decideAction({ ...short, sl: 100 }, { tp1Hit: true }, 79), { kind: "close", outcome: "win", exit: 80 });
});

test("after partial: breakeven SL closes the rest as breakeven", () => {
  assert.deepEqual(decideAction({ ...long, sl: 100 }, { tp1Hit: true }, 99), { kind: "close", outcome: "breakeven", exit: 100 });
  assert.deepEqual(decideAction({ ...short, sl: 100 }, { tp1Hit: true }, 101), { kind: "close", outcome: "breakeven", exit: 100 });
});

test("after partial: holds between breakeven and TP2", () => {
  assert.deepEqual(decideAction({ ...long, sl: 100 }, { tp1Hit: true }, 115), { kind: "hold" });
});
