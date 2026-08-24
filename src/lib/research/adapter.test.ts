import "dotenv/config"; // adapter.ts imports prisma at module scope
import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapAsStrategy } from "./adapter";

test("wrapAsStrategy carries a persisted exitLadder forward as preferredExit", () => {
  const strat = wrapAsStrategy({
    id: 42,
    label: "Test Strategy",
    code: "return null;",
    exitLadder: JSON.stringify({ tp1Mult: 2.0, slMult: 1.5, singleTarget: true }),
  });
  assert.deepEqual(strat.preferredExit, { tp1Mult: 2.0, slMult: 1.5, singleTarget: true });
});

test("wrapAsStrategy leaves preferredExit undefined for a legacy row with no exitLadder field at all", () => {
  const strat = wrapAsStrategy({ id: 43, label: "Legacy", code: "return null;" });
  assert.equal(strat.preferredExit, undefined);
});

test("wrapAsStrategy leaves preferredExit undefined for a malformed exitLadder JSON string", () => {
  const strat = wrapAsStrategy({ id: 44, label: "Bad JSON", code: "return null;", exitLadder: "not json" });
  assert.equal(strat.preferredExit, undefined);
});

test("wrapAsStrategy leaves preferredExit undefined for the schema default empty-object ladder", () => {
  const strat = wrapAsStrategy({ id: 45, label: "Default", code: "return null;", exitLadder: "{}" });
  assert.equal(strat.preferredExit, undefined);
});

test("wrapAsStrategy carries a swept trailing ladder through to preferredExit", () => {
  // The whole point of sweeping trails: positionRules.decideAction short-
  // circuits to the trail and ignores tp1Mult, so dropping `trail` here would
  // quietly trade a validated trailing strategy as a fixed 2.5 ATR target.
  const strat = wrapAsStrategy({
    id: 46,
    label: "Trailer",
    code: "return null;",
    exitLadder: JSON.stringify({ tp1Mult: 2.5, slMult: 1.5, singleTarget: true, trail: { activateMult: 1.5, offsetMult: 1.5 } }),
  });
  assert.deepEqual(strat.preferredExit, {
    tp1Mult: 2.5,
    slMult: 1.5,
    singleTarget: true,
    trail: { activateMult: 1.5, offsetMult: 1.5 },
  });
});

test("wrapAsStrategy drops a half-specified trail rather than trading a broken one", () => {
  // A trail missing either multiple is not a trail. Falling back to the fixed
  // ladder is recoverable; handing positionRules an undefined offset is not.
  for (const trail of [{ activateMult: 1.5 }, { offsetMult: 1.5 }, { activateMult: "1.5", offsetMult: 1.5 }]) {
    const strat = wrapAsStrategy({
      id: 47,
      label: "Half trail",
      code: "return null;",
      exitLadder: JSON.stringify({ tp1Mult: 2.5, slMult: 1.5, singleTarget: true, trail }),
    });
    assert.deepEqual(strat.preferredExit, { tp1Mult: 2.5, slMult: 1.5, singleTarget: true });
  }
});
