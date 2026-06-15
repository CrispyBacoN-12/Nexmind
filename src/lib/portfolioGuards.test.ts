import { test } from "node:test";
import assert from "node:assert/strict";
import { canPortfolioTrade } from "./portfolioGuards";

test("canPortfolioTrade: archived portfolios cannot trade", () => {
  assert.equal(canPortfolioTrade("active"), true);
  assert.equal(canPortfolioTrade("archived"), false);
});
