import test from "node:test";
import assert from "node:assert/strict";
import { etClock } from "@/lib/scanAgent/session";
import { etClockMemo, makeEtClockMemo } from "./etClockMemo";

test("etClockMemo gives etClock's answer, first call and repeat, across both DST switches", () => {
  const starts = [Date.UTC(2026, 2, 7, 0, 0), Date.UTC(2026, 9, 31, 0, 0), Date.UTC(2026, 6, 1, 13, 0)];
  for (const startMs of starts) {
    for (let k = 0; k < 2 * 24 * 12; k++) {
      const sec = startMs / 1000 + k * 300;
      const want = etClock(sec);
      assert.deepEqual(etClockMemo(sec), want);
      assert.deepEqual(etClockMemo(sec), want);
    }
  }
});

test("a caller mutating the returned object does not poison the memo", () => {
  const sec = Date.UTC(2026, 10, 3, 15, 0) / 1000;
  const first = etClockMemo(sec);
  first.minutes = -1;
  first.date = "bad";
  assert.deepEqual(etClockMemo(sec), etClock(sec));
});

test("the memo is bounded: it clears once it would grow past max", () => {
  const m = makeEtClockMemo(3);
  const base = Date.UTC(2026, 10, 3, 15, 0) / 1000;
  for (let k = 0; k < 3; k++) m.clock(base + k * 300);
  assert.equal(m.size(), 3);
  m.clock(base); // a hit adds nothing
  assert.equal(m.size(), 3);
  assert.deepEqual(m.clock(base + 900), etClock(base + 900)); // the 4th clears, then stores
  assert.equal(m.size(), 1);
});
