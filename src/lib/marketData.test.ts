import "dotenv/config"; // marketData.ts -> webull.ts -> webull/symbols.ts imports prisma at module scope — needs DATABASE_URL to construct, same as other DB-touching scripts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldTryAlpaca, shouldTryWebull } from "./marketData";

test("shouldTryAlpaca is true only when both key and secret are present", () => {
  assert.equal(shouldTryAlpaca({ ALPACA_KEY: "k", ALPACA_SECRET: "s" }), true);
  assert.equal(shouldTryAlpaca({ ALPACA_KEY: "k" }), false);
  assert.equal(shouldTryAlpaca({ ALPACA_SECRET: "s" }), false);
  assert.equal(shouldTryAlpaca({}), false);
});

test("shouldTryWebull is true only when both key and secret are present", () => {
  assert.equal(shouldTryWebull({ WEBULL_PAPER_APP_KEY: "k", WEBULL_PAPER_APP_SECRET: "s" }), true);
  assert.equal(shouldTryWebull({ WEBULL_PAPER_APP_KEY: "k" }), false);
  assert.equal(shouldTryWebull({ WEBULL_PAPER_APP_SECRET: "s" }), false);
  assert.equal(shouldTryWebull({}), false);
});
