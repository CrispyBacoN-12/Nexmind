import "dotenv/config"; // marketData.ts -> webull.ts needs the Webull credentials from .env
import { test } from "node:test";
import assert from "node:assert/strict";
import { coversDays, shouldTryAlpaca, shouldTryWebull } from "./marketData";

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

test("coversDays treats a truncated provider response as insufficient", () => {
  const day = 86400;
  const span = (days: number) => [{ t: 0 }, { t: days * day }];

  // The case that broke the blind-test gate: Webull caps every request at 1200
  // bars, so a 5y/1h request comes back as a valid, non-empty ~256-day series.
  // Nothing about the response says "truncated" — only its span does.
  assert.equal(coversDays(span(256), 400), false);
  assert.equal(coversDays(span(1826), 400), true);
  assert.equal(coversDays(span(400), 400), true, "exactly the requirement must pass");

  // minDays 0 is the default for every live scan caller: no depth requirement,
  // so any response (including an empty one) is the provider's answer and this
  // predicate must not start rejecting responses those callers accept today.
  assert.equal(coversDays([], 0), true);
  assert.equal(coversDays(span(1), 0), true);

  // An empty response can never cover a positive requirement.
  assert.equal(coversDays([], 400), false);
});
