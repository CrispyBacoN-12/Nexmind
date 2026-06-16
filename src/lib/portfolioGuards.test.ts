import { test } from "node:test";
import assert from "node:assert/strict";
import { canPortfolioTrade, isInvestKind } from "./portfolioGuards";

test("canPortfolioTrade: archived portfolios cannot trade", () => {
  assert.equal(canPortfolioTrade("active"), true);
  assert.equal(canPortfolioTrade("archived"), false);
});

test("isInvestKind: only the invest kind is an invest portfolio", () => {
  assert.equal(isInvestKind("invest"), true);
  assert.equal(isInvestKind("swing"), false);
});
