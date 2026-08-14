import "dotenv/config"; // symbols.ts imports prisma at module scope — needs DATABASE_URL to construct, same as other DB-touching scripts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTickerIdResponse } from "./symbols";

test("parseTickerIdResponse: matches the result whose symbol equals the query, case-insensitively", () => {
  const json = { data: [{ symbol: "AAPL", tickerId: 913256135 }, { symbol: "AAPLW", tickerId: 999 }] };
  assert.equal(parseTickerIdResponse(json, "aapl"), 913256135);
});

test("parseTickerIdResponse: falls back to the first result when no exact symbol match", () => {
  const json = { data: [{ symbol: "AAPL.US", tickerId: 913256135 }] };
  assert.equal(parseTickerIdResponse(json, "AAPL"), 913256135);
});

test("parseTickerIdResponse: throws when no results or no tickerId", () => {
  assert.throws(() => parseTickerIdResponse({ data: [] }, "AAPL"), /tickerId/);
  assert.throws(() => parseTickerIdResponse({}, "AAPL"), /tickerId/);
  assert.throws(() => parseTickerIdResponse({ data: [{ symbol: "AAPL" }] }, "AAPL"), /tickerId/);
});
