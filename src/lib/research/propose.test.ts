import { test } from "node:test";
import assert from "node:assert/strict";
import { candidatesPrompt } from "./propose";

// The prompt used to end with a hardcoded "one momentum, one mean-reversion,
// one breakout". That sentence outranks the brief: whatever RESEARCH_ROTATION
// asked for, QUANT was still told to return three entry mechanisms from those
// three families. Re-aiming the loop by editing the rotation's brief text alone
// would have been close to a no-op, which is why this is a code change and not
// a copy edit.

test("the brief reaches the prompt verbatim", () => {
  const p = candidatesPrompt({ brief: "Pullback-within-uptrend entry", symbol: "PANEL", interval: "1d" });
  assert.match(p, /Pullback-within-uptrend entry/);
});

test("the three angles come from the caller, not from a fixed list of entry families", () => {
  const p = candidatesPrompt({
    brief: "Entry timing on an established trend-pullback trigger",
    symbol: "PANEL",
    interval: "1d",
    angles: ["immediate entry on the trigger bar", "wait for a confirmation close", "enter on a retest of the trigger bar's low"],
  });
  assert.match(p, /wait for a confirmation close/);
  assert.match(p, /enter on a retest of the trigger bar's low/);
  assert.doesNotMatch(p, /mean-reversion/i, "the old hardcoded axis must not survive alongside the caller's");
  assert.doesNotMatch(p, /breakout/i);
});

test("with no angles given, it asks for diversity without naming entry mechanisms", () => {
  // A brief about exit timing should not be answered with a breakout rule just
  // because the prompt asked for one.
  const p = candidatesPrompt({ brief: "anything", symbol: "PANEL", interval: "1d" });
  assert.match(p, /different/i, "still asks for three genuinely different candidates");
  assert.doesNotMatch(p, /one momentum, one mean-reversion, one breakout/i);
});

test("the count stays at three, matching CANDIDATES_SCHEMA's minItems/maxItems", () => {
  const p = candidatesPrompt({ brief: "anything", symbol: "PANEL", interval: "1d", angles: ["a", "b", "c"] });
  assert.match(p, /exactly 3/);
});
