import { test } from "node:test";
import assert from "node:assert/strict";
import { cliResolvedModel, isFatalBackendReason } from "./anthropic";

test("a monthly spend limit is a fatal backend failure", () => {
  // The exact string the CLI printed on 2026-08-30, which killed the research
  // round. It matched none of the old patterns, so nothing latched: the desk
  // kept calling, every call failed, and War Room went on reporting AI online.
  assert.equal(
    isFatalBackendReason(
      "claude CLI: You've hit your monthly spend limit · raise it at claude.ai/settings/usage?from=cc_cli_limit_message",
    ),
    true,
  );
});

test("the other spend-side refusals are fatal too", () => {
  for (const reason of [
    "Credit balance is too low",
    "usage limit reached — your limit will reset at 3pm",
    "rate_limit_error: this organization has exceeded its quota",
    "Your subscription does not include this model",
  ]) {
    assert.equal(isFatalBackendReason(reason), true, `should latch: ${reason}`);
  }
});

test("auth failures stay fatal", () => {
  for (const reason of [
    "Invalid API key",
    "OAuth token expired",
    "You are not logged in. Run `claude login`",
    "authentication_error",
  ]) {
    assert.equal(isFatalBackendReason(reason), true, `should latch: ${reason}`);
  }
});

test("a blip is not fatal, so the desk retries instead of latching down", () => {
  // Latching one of these would take the desk off AI for 5 minutes over a
  // hiccup — the opposite failure to the one above, and just as wrong.
  for (const reason of [
    "socket hang up",
    "Request timed out after 120000ms",
    "500 Internal Server Error",
    "overloaded_error: Overloaded",
    "unknown claude CLI failure",
  ]) {
    assert.equal(isFatalBackendReason(reason), false, `should retry: ${reason}`);
  }
});

test("resolvedModel reads the first key of the CLI result's modelUsage", () => {
  assert.equal(
    cliResolvedModel({ result: "x", is_error: false, modelUsage: { "claude-sonnet-4-x": { inputTokens: 1 } } }),
    "claude-sonnet-4-x",
  );
  assert.equal(cliResolvedModel({ result: "x", is_error: false }), null);
  assert.equal(cliResolvedModel({ result: "x", modelUsage: {} }), null);
  assert.equal(cliResolvedModel(null), null);
});

test("resolvedModel picks the modelUsage key with the most output tokens, not the first", () => {
  // The CLI lists an auxiliary model (e.g. a haiku helper call) before the main one.
  assert.equal(
    cliResolvedModel({
      result: "x",
      modelUsage: {
        "claude-haiku-aux": { inputTokens: 900, outputTokens: 12, costUSD: 0.001 },
        "claude-sonnet-main": { inputTokens: 300, outputTokens: 640, costUSD: 0.02 },
      },
    }),
    "claude-sonnet-main",
  );
  // No output tokens anywhere: highest cost.
  assert.equal(
    cliResolvedModel({ modelUsage: { "aux": { costUSD: 0.001 }, "main": { costUSD: 0.02 } } }),
    "main",
  );
  // Neither field: the first key.
  assert.equal(cliResolvedModel({ modelUsage: { "first": {}, "second": {} } }), "first");
});
