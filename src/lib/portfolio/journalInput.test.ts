import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCloseTrade, parseNavEntry, parseOpenTrade, realizedR, slotsFromJournal } from "./journalInput";

const open = { ticker: " nvda ", shares: "2", entryPrice: "180", entryDate: "2026-09-25", stop: "171" };

test("parseOpenTrade: normalises a valid entry", () => {
  const r = parseOpenTrade(open);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { ticker: "NVDA", shares: 2, entryPrice: 180, entryDate: "2026-09-25", stop: 171, note: "" });
});

test("parseOpenTrade: malformed fields are errors, not defaults", () => {
  assert.equal(parseOpenTrade({ ...open, shares: "1.5" }).ok, false); // whole shares only
  assert.equal(parseOpenTrade({ ...open, entryPrice: "18O" }).ok, false);
  assert.equal(parseOpenTrade({ ...open, stop: "185" }).ok, false); // stop above entry
  assert.equal(parseOpenTrade({ ...open, entryDate: "25/09/2026" }).ok, false);
  assert.equal(parseOpenTrade({ ...open, ticker: "not a ticker" }).ok, false);
});

test("parseCloseTrade: exit cannot precede entry", () => {
  assert.equal(parseCloseTrade({ exitPrice: "190", exitDate: "2026-09-24" }, "2026-09-25").ok, false);
  assert.ok(parseCloseTrade({ exitPrice: "190", exitDate: "2026-09-26" }, "2026-09-25").ok);
});

test("parseNavEntry: cash optional, never above NAV", () => {
  const r = parseNavEntry({ date: "2026-09-25", nav: "2500", cash: "" });
  assert.ok(r.ok);
  assert.equal(r.value.cash, null);
  assert.equal(parseNavEntry({ date: "2026-09-25", nav: "2500", cash: "3000" }).ok, false);
  assert.equal(parseNavEntry({ date: "2026-09-25", nav: "0" }).ok, false);
});

test("realizedR: exit at the stop is -1R", () => {
  assert.equal(realizedR({ entryPrice: 100, stop: 90, exitPrice: 90 }), -1);
  assert.equal(realizedR({ entryPrice: 100, stop: 90, exitPrice: 120 }), 2);
});

test("slotsFromJournal: only open rows; an unknown stored sector reads as Other", () => {
  const rows = [
    { ticker: "A", sector: "Energy", shares: 1, entryPrice: 10, stop: 9, worstLossR: 2, exitDate: null },
    { ticker: "B", sector: "Energy", shares: 1, entryPrice: 10, stop: 9, worstLossR: null, exitDate: "2026-09-20" },
    { ticker: "C", sector: "Tech-ish", shares: 1, entryPrice: 10, stop: 9, worstLossR: null, exitDate: null },
  ];
  assert.deepEqual(slotsFromJournal(rows).map((s) => [s.ticker, s.sector]), [["A", "Energy"], ["C", "Other"]]);
});
