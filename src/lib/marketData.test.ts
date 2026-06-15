import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldTryAlpaca } from "./marketData";

test("shouldTryAlpaca is true only when both key and secret are present", () => {
  assert.equal(shouldTryAlpaca({ ALPACA_KEY: "k", ALPACA_SECRET: "s" }), true);
  assert.equal(shouldTryAlpaca({ ALPACA_KEY: "k" }), false);
  assert.equal(shouldTryAlpaca({ ALPACA_SECRET: "s" }), false);
  assert.equal(shouldTryAlpaca({}), false);
});
