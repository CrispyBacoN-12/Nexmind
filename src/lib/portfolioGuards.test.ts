import { test } from "node:test";
import assert from "node:assert/strict";
import { canPortfolioTrade, isInvestKind, isOptionsKind, isSwingKind } from "./portfolioGuards";

test("canPortfolioTrade: archived portfolios cannot trade", () => {
  assert.equal(canPortfolioTrade("active"), true);
  assert.equal(canPortfolioTrade("archived"), false);
});

test("isInvestKind: only the invest kind is an invest portfolio", () => {
  assert.equal(isInvestKind("invest"), true);
  assert.equal(isInvestKind("swing"), false);
});

test("isOptionsKind / isSwingKind: positive kind predicates", () => {
  assert.equal(isOptionsKind("options"), true);
  assert.equal(isOptionsKind("swing"), false);
  assert.equal(isSwingKind("swing"), true);
  assert.equal(isSwingKind("invest"), false);
  assert.equal(isSwingKind("options"), false);
});
