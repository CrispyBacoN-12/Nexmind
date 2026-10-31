// Tests for the long sweep setup rule (spec §5): one test per numbered step,
// with stop/entry/R asserted from the same formulas the rule uses so no
// rounded literal can hide a drift in the numbers the owner sizes from.

import test from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import {
  CHART_LEVEL_MERGE_ATR,
  CHART_MIN_T1_R,
  CHART_STOP_BUFFER_ATR,
} from "./types";
import type { Levels, SessionSplit, Setup, SetupOutcome } from "./types";
import { findSetup } from "./setup";

const ATR = 1;
const T0 = 1_700_000_000;

function bar(i: number, h: number, l: number, c: number): Candle {
  return { t: T0 + i * 300, o: c, h, l, c, v: 1000 };
}

function levels(over: Partial<Levels> = {}): Levels {
  return {
    pPOC: null,
    pVAH: null,
    pVAL: null,
    PDH: null,
    PDL: null,
    PMH: null,
    PML: null,
    dPOC: null,
    ...over,
  };
}

function split(regular: Candle[]): SessionSplit {
  return { previousDate: "2026-10-30", previous: [], premarket: [], regular };
}

function asSetup(out: SetupOutcome): Setup {
  assert.equal(out.kind, "setup", JSON.stringify(out));
  if (out.kind !== "setup") throw new Error("unreachable");
  return out.setup;
}

function asNone(out: SetupOutcome): { ticker: string; reason: string } {
  assert.equal(out.kind, "none", JSON.stringify(out));
  if (out.kind !== "none") throw new Error("unreachable");
  return out;
}

// PDL = 100. Sweep bar wicks to 99.5 and closes 100.4; the last bar closes 101.
const PDL = 100;
const SWEEP = bar(1, 100.6, 99.5, 100.4);
const LAST = bar(2, 101.2, 100.3, 101);
const BASE_REGULAR = [bar(0, 101.5, 100.5, 101.2), SWEEP, LAST];

test("qualifying PDL sweep gives exact stop, entry and targets", () => {
  const lv = levels({ PDL, PDH: 104, pVAH: 107 });
  const s = asSetup(findSetup("AAPL", split(BASE_REGULAR), lv, ATR));
  const stop = SWEEP.l - CHART_STOP_BUFFER_ATR * ATR;
  const entry = LAST.c;
  assert.equal(s.ticker, "AAPL");
  assert.equal(s.entry, entry);
  assert.equal(s.stop, stop);
  assert.deepEqual(s.sweptLevels, ["PDL"]);
  assert.equal(s.sweepBar, SWEEP);
  assert.equal(s.t1.price, 104);
  assert.deepEqual(s.t1.names, ["PDH"]);
  assert.equal(s.t1.r, (104 - entry) / (entry - stop));
  assert.ok(s.t2);
  assert.equal(s.t2.price, 107);
  assert.deepEqual(s.t2.names, ["pVAH"]);
  assert.equal(s.t2.r, (107 - entry) / (entry - stop));
  assert.deepEqual(s.tags, []);
  assert.equal(s.levels, lv);
});

test("a wick below the level that also closes below is not a sweep", () => {
  const regular = [bar(0, 101.5, 100.5, 101.2), bar(1, 100.2, 99.5, 99.8), LAST];
  const out = asNone(
    findSetup("AAPL", split(regular), levels({ PDL, PDH: 104 }), ATR),
  );
  assert.equal(out.reason, "ยังไม่มี sweep");
  assert.equal(out.ticker, "AAPL");
});

test("a sweep whose latest close is back below the level is not a setup", () => {
  const regular = [bar(0, 101.5, 100.5, 101.2), SWEEP, bar(2, 100.3, 99.7, 99.9)];
  const out = asNone(
    findSetup("AAPL", split(regular), levels({ PDL, PDH: 104 }), ATR),
  );
  assert.equal(out.reason, "ยังไม่มี sweep");
});

test("a later close under the sweep low invalidates the setup", () => {
  const regular = [
    bar(0, 101.5, 100.5, 101.2),
    SWEEP,
    bar(2, 100.2, 99.3, 99.4), // closes under 99.5
    bar(3, 101.2, 100.2, 100.8),
  ];
  const out = asNone(
    findSetup("AAPL", split(regular), levels({ PDL, PDH: 104 }), ATR),
  );
  assert.equal(out.reason, "หลุด low ของแท่ง sweep แล้ว");
});

test("a later low under the sweep low with a close above it does not invalidate", () => {
  const regular = [
    bar(0, 101.5, 100.5, 101.2),
    SWEEP,
    bar(2, 100.2, 99.2, 99.6), // wick under 99.5, close above
    bar(3, 101.2, 100.2, 100.8),
  ];
  const s = asSetup(
    findSetup("AAPL", split(regular), levels({ PDL, PDH: 104 }), ATR),
  );
  assert.equal(s.stop, SWEEP.l - CHART_STOP_BUFFER_ATR * ATR);
});

test("targets within the merge distance form one group with both names", () => {
  const lv = levels({ PDL, pPOC: 103, PDH: 103.05, pVAH: 107 });
  const s = asSetup(findSetup("AAPL", split(BASE_REGULAR), lv, ATR));
  assert.equal(s.t1.price, 103);
  assert.deepEqual(s.t1.names, ["pPOC", "PDH"]);
  assert.ok(s.t2);
  assert.deepEqual(s.t2.names, ["pVAH"]);
});

test("merging compares against the group's lower price, not the previous candidate", () => {
  // 103.16 is within 0.1 of 103.08 but not of the group price 103.
  const lv = levels({ PDL, pPOC: 103, pVAH: 103.08, PDH: 103.16 });
  const s = asSetup(findSetup("AAPL", split(BASE_REGULAR), lv, ATR));
  assert.equal(s.t1.price, 103);
  assert.deepEqual(s.t1.names, ["pPOC", "pVAH"]);
  assert.ok(s.t2);
  assert.equal(s.t2.price, 103.16);
  assert.deepEqual(s.t2.names, ["PDH"]);
  assert.ok(0.08 <= CHART_LEVEL_MERGE_ATR * ATR);
});

test("only the first two groups become targets", () => {
  const lv = levels({ PDL, pPOC: 103, pVAH: 105, PDH: 108 });
  const s = asSetup(findSetup("AAPL", split(BASE_REGULAR), lv, ATR));
  assert.equal(s.t1.price, 103);
  assert.ok(s.t2);
  assert.equal(s.t2.price, 105);
});

test("a single target leaves t2 null", () => {
  const s = asSetup(
    findSetup("AAPL", split(BASE_REGULAR), levels({ PDL, PDH: 104 }), ATR),
  );
  assert.equal(s.t2, null);
});

test("no target level above the price gives the Thai reason", () => {
  // PDH and pPOC are at or below entry; sweep-only levels are not targets.
  const lv = levels({ PDL, PDH: 101, pPOC: 100.5, pVAL: 90 });
  const out = asNone(findSetup("AAPL", split(BASE_REGULAR), lv, ATR));
  assert.equal(out.reason, "ไม่มีระดับเหนือราคา");
});

test("a level exactly at entry is not above the price", () => {
  const out = asNone(
    findSetup("AAPL", split(BASE_REGULAR), levels({ PDL, PDH: LAST.c }), ATR),
  );
  assert.equal(out.reason, "ไม่มีระดับเหนือราคา");
});

test("a later high at or above T1 means the first target is already hit", () => {
  const regular = [
    bar(0, 101.5, 100.5, 101.2),
    SWEEP,
    bar(2, 104.5, 100.3, 101), // high pierces 104
    bar(3, 101.2, 100.3, 101),
  ];
  const out = asNone(
    findSetup("AAPL", split(regular), levels({ PDL, PDH: 104 }), ATR),
  );
  assert.equal(out.reason, "ถึงเป้าแรกไปแล้ว");
});

test("a later high exactly equal to T1 counts as reached", () => {
  const regular = [
    bar(0, 101.5, 100.5, 101.2),
    SWEEP,
    bar(2, 104, 100.3, 101),
    bar(3, 101.2, 100.3, 101),
  ];
  const out = asNone(
    findSetup("AAPL", split(regular), levels({ PDL, PDH: 104 }), ATR),
  );
  assert.equal(out.reason, "ถึงเป้าแรกไปแล้ว");
});

test("a high before the sweep bar does not count as reaching T1", () => {
  const regular = [bar(0, 105, 100.5, 101.2), SWEEP, LAST];
  const s = asSetup(
    findSetup("AAPL", split(regular), levels({ PDL, PDH: 104 }), ATR),
  );
  assert.equal(s.t1.price, 104);
});

test("a first target near 1.0R carries the tag", () => {
  const entry = LAST.c;
  const stop = SWEEP.l - CHART_STOP_BUFFER_ATR * ATR;
  const pdh = entry + (entry - stop) * 1.0;
  const s = asSetup(
    findSetup("AAPL", split(BASE_REGULAR), levels({ PDL, PDH: pdh }), ATR),
  );
  assert.ok(s.t1.r < CHART_MIN_T1_R);
  assert.deepEqual(s.tags, ["เป้าแรกไม่ถึง 1.5R"]);
});

test("a first target at 2.0R carries no tag", () => {
  const entry = LAST.c;
  const stop = SWEEP.l - CHART_STOP_BUFFER_ATR * ATR;
  const pdh = entry + (entry - stop) * 2.0;
  const s = asSetup(
    findSetup("AAPL", split(BASE_REGULAR), levels({ PDL, PDH: pdh }), ATR),
  );
  assert.ok(s.t1.r >= CHART_MIN_T1_R);
  assert.deepEqual(s.tags, []);
});

test("null PMH/PML and a sweep on the first regular bar still form a setup from PDL", () => {
  const first = bar(0, 100.6, 99.5, 100.4);
  const last = bar(1, 101.2, 100.3, 101);
  const lv = levels({ PDL, PMH: null, PML: null, PDH: 104 });
  const s = asSetup(findSetup("AAPL", split([first, last]), lv, ATR));
  assert.equal(s.sweepBar, first);
  assert.deepEqual(s.sweptLevels, ["PDL"]);
  assert.equal(s.stop, first.l - CHART_STOP_BUFFER_ATR * ATR);
  assert.equal(s.entry, last.c);
});

test("the last bar can itself be the sweep bar", () => {
  const regular = [bar(0, 101.5, 100.5, 101.2), SWEEP];
  const s = asSetup(
    findSetup("AAPL", split(regular), levels({ PDL, PDH: 104 }), ATR),
  );
  assert.equal(s.sweepBar, SWEEP);
  assert.equal(s.entry, SWEEP.c);
});

test("one bar sweeping both PDL and pVAL lists both levels", () => {
  const lv = levels({ PDL, pVAL: 100.2, PDH: 104 });
  const s = asSetup(findSetup("AAPL", split(BASE_REGULAR), lv, ATR));
  assert.deepEqual(s.sweptLevels, ["PDL", "pVAL"]);
});

test("a level the last close has not reclaimed is left out of sweptLevels", () => {
  // The sweep bar (low 99.5, close 100.4) pierced and reclaimed both PDL 100
  // and pVAL 100.3, but the last close 100.2 is back under pVAL.
  const last = bar(2, 100.6, 100.1, 100.2);
  const lv = levels({ PDL, pVAL: 100.3, PDH: 104 });
  const s = asSetup(
    findSetup("AAPL", split([bar(0, 101.5, 100.5, 101.2), SWEEP, last]), lv, ATR),
  );
  assert.deepEqual(s.sweptLevels, ["PDL"]);
});

test("PML is a sweep level and a null PDL is skipped", () => {
  const lv = levels({ PDL: null, PML: 100, PDH: 104 });
  const s = asSetup(findSetup("AAPL", split(BASE_REGULAR), lv, ATR));
  assert.deepEqual(s.sweptLevels, ["PML"]);
});

test("the most recent qualifying bar is the sweep bar", () => {
  const earlier = bar(1, 100.6, 99.0, 100.4);
  const later = bar(2, 100.8, 99.6, 100.5);
  const last = bar(3, 101.2, 100.3, 101);
  const regular = [bar(0, 101.5, 100.5, 101.2), earlier, later, last];
  const s = asSetup(
    findSetup("AAPL", split(regular), levels({ PDL, PDH: 104 }), ATR),
  );
  assert.equal(s.sweepBar, later);
  assert.equal(s.stop, later.l - CHART_STOP_BUFFER_ATR * ATR);
});

test("dataAsOf is the end of the last bar", () => {
  const s = asSetup(
    findSetup("AAPL", split(BASE_REGULAR), levels({ PDL, PDH: 104 }), ATR),
  );
  assert.equal(s.dataAsOf, new Date((LAST.t + 300) * 1000).toISOString());
});

test("no regular bars gives the Thai reason", () => {
  const out = asNone(findSetup("AAPL", split([]), levels({ PDL }), ATR));
  assert.equal(out.reason, "ยังไม่มีแท่งในเวลาทำการ");
});

test("an unusable ATR gives the Thai reason", () => {
  const lv = levels({ PDL, PDH: 104 });
  for (const atr of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const out = asNone(findSetup("AAPL", split(BASE_REGULAR), lv, atr));
    assert.equal(out.reason, "ATR คำนวณไม่ได้");
  }
});

test("empty regular is reported before a bad ATR", () => {
  const out = asNone(findSetup("AAPL", split([]), levels({ PDL }), 0));
  assert.equal(out.reason, "ยังไม่มีแท่งในเวลาทำการ");
});
