import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAction, applySlippage, type OpenPosition } from "./positionRules";

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

// ---- applySlippage ----

test("applySlippage: zero bps returns the theoretical price exactly", () => {
  assert.equal(applySlippage("buy", 100, 0), 100);
  assert.equal(applySlippage("sell", 100, 0), 100);
});

test("applySlippage: buy fills higher, sell fills lower — always worse for the trader", () => {
  assert.ok(Math.abs(applySlippage("buy", 100, 10) - 100.1) < 1e-9);
  assert.ok(Math.abs(applySlippage("sell", 100, 10) - 99.9) < 1e-9);
});

// ---- trailing stop ----

const longTrail: OpenPosition = { ...long, trail: { activateDist: 5, offsetDist: 3 } };
const shortTrail: OpenPosition = { ...short, trail: { activateDist: 5, offsetDist: 3 } };

test("trail: favorable move before activation just records the new extreme, stop unchanged", () => {
  assert.deepEqual(decideAction(longTrail, {}, 103), { kind: "trail-update", sl: 95, extreme: 103 });
  assert.deepEqual(decideAction(shortTrail, {}, 97), { kind: "trail-update", sl: 105, extreme: 97 });
});

test("trail: arms once activateDist is cleared and ratchets to extreme - offsetDist", () => {
  assert.deepEqual(decideAction(longTrail, {}, 106), { kind: "trail-update", sl: 103, extreme: 106 });
  assert.deepEqual(decideAction(shortTrail, {}, 94), { kind: "trail-update", sl: 97, extreme: 94 });
});

test("trail: never loosens — a pullback that doesn't set a new extreme holds", () => {
  // Caller has already persisted sl=103 / extreme=106 from the prior tick.
  assert.deepEqual(decideAction({ ...longTrail, sl: 103 }, { trail: longTrail.trail, trailExtreme: 106 }, 104), { kind: "hold" });
  assert.deepEqual(decideAction({ ...shortTrail, sl: 97 }, { trail: shortTrail.trail, trailExtreme: 94 }, 96), { kind: "hold" });
});

test("trail: price hitting the ratcheted stop closes as a win (stop is past entry)", () => {
  assert.deepEqual(
    decideAction({ ...longTrail, sl: 103 }, { trail: longTrail.trail, trailExtreme: 106 }, 102),
    { kind: "close", outcome: "win", exit: 103 },
  );
  assert.deepEqual(
    decideAction({ ...shortTrail, sl: 97 }, { trail: shortTrail.trail, trailExtreme: 94 }, 98),
    { kind: "close", outcome: "win", exit: 97 },
  );
});

test("trail: price hitting the original hard SL before ever activating closes as a loss", () => {
  assert.deepEqual(decideAction(longTrail, {}, 94), { kind: "close", outcome: "loss", exit: 95 });
  assert.deepEqual(decideAction(shortTrail, {}, 106), { kind: "close", outcome: "loss", exit: 105 });
});
