import { test } from "node:test";
import assert from "node:assert/strict";
import { isFatalBackendReason } from "./anthropic";

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
