import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRetcode } from "./retcodes";

test("10004 Requote and 10021 No quotes are RetriableWithNewQuote", () => {
  assert.equal(classifyRetcode(10004), "RetriableWithNewQuote");
  assert.equal(classifyRetcode(10021), "RetriableWithNewQuote");
});

test("10014/10015/10016/10019 are TerminalRejection", () => {
  for (const code of [10014, 10015, 10016, 10019]) {
    assert.equal(classifyRetcode(code), "TerminalRejection");
  }
});

test("10018 Market closed and 10027 Auto-trading disabled are MarketCondition", () => {
  assert.equal(classifyRetcode(10018), "MarketCondition");
  assert.equal(classifyRetcode(10027), "MarketCondition");
});

test("an unknown retcode is Unclassified", () => {
  assert.equal(classifyRetcode(99999), "Unclassified");
});
