import { test } from "node:test";
import assert from "node:assert/strict";
import { eightKRows } from "./secFilings";

test("keeps 8-K and 8-K/A, splits items, builds the filing URL", () => {
  const rows = eightKRows("0000320193", {
    form: ["10-Q", "8-K/A", "8-K", "4"],
    items: ["", "5.02", "2.02,9.01", ""],
    acceptanceDateTime: ["a", "2026-09-01T20:30:35.000Z", "2026-07-30T20:30:28.000Z", "b"],
    accessionNumber: ["x", "0001140361-26-035325", "0000320193-26-000018", "y"],
    primaryDocument: ["x", "ef20081427_8ka.htm", "aapl-20260730.htm", "y"],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].items, ["2.02", "9.01"]);
  assert.equal(rows[0].form, "8-K/A");
  assert.equal(rows[1].url, "https://www.sec.gov/Archives/edgar/data/320193/000032019326000018/aapl-20260730.htm");
});

test("a missing recent block is no rows, not a throw", () => {
  assert.deepEqual(eightKRows("1", undefined), []);
});
