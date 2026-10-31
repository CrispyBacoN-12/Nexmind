import test from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import type { SessionSplit } from "./types";
import { computeLevels } from "./levels";

function bar(t: number, l: number, h: number, v: number): Candle {
  return { t, o: l, h, l, c: h, v };
}

// Previous session spans 90..110. Heavy volume sits in the 99..101 band; the
// thin bars at the extremes set PDH = 110 and PDL = 90.
function previousSession(): Candle[] {
  const bars: Candle[] = [bar(0, 90, 91, 10), bar(300, 109, 110, 10)];
  for (let k = 0; k < 20; k++) bars.push(bar(600 + k * 300, 99, 101, 1000));
  return bars;
}

function split(over: Partial<SessionSplit>): SessionSplit {
  return {
    previousDate: "2026-10-30",
    previous: previousSession(),
    premarket: [],
    regular: [],
    ...over,
  };
}

test("computeLevels puts pPOC in the heavy band with pVAL <= pPOC <= pVAH", () => {
  const out = computeLevels(split({}));
  assert.ok("levels" in out);
  const { pPOC, pVAH, pVAL } = out.levels;
  assert.ok(pPOC !== null && pVAH !== null && pVAL !== null);
  assert.ok(pPOC >= 99 && pPOC <= 101, `pPOC ${pPOC} outside 99..101`);
  assert.ok(pVAL <= pPOC && pPOC <= pVAH);
});

test("computeLevels reports PDH and PDL exactly", () => {
  const out = computeLevels(split({}));
  assert.ok("levels" in out);
  assert.equal(out.levels.PDH, 110);
  assert.equal(out.levels.PDL, 90);
});

test("computeLevels takes PMH/PML from the pre-market bars", () => {
  const out = computeLevels(
    split({ premarket: [bar(1, 98, 103, 50), bar(2, 97, 104, 50)] }),
  );
  assert.ok("levels" in out);
  assert.equal(out.levels.PMH, 104);
  assert.equal(out.levels.PML, 97);
});

test("computeLevels leaves PMH/PML null when there is no pre-market", () => {
  const out = computeLevels(split({ premarket: [] }));
  assert.ok("levels" in out);
  assert.equal(out.levels.PMH, null);
  assert.equal(out.levels.PML, null);
});

test("computeLevels needs two regular bars for dPOC", () => {
  const none = computeLevels(split({ regular: [] }));
  const one = computeLevels(split({ regular: [bar(1, 100, 101, 100)] }));
  assert.ok("levels" in none && "levels" in one);
  assert.equal(none.levels.dPOC, null);
  assert.equal(one.levels.dPOC, null);

  const two = computeLevels(
    split({
      regular: [bar(1, 100, 101, 100), bar(2, 100.5, 102, 100)],
    }),
  );
  assert.ok("levels" in two);
  const dPOC = two.levels.dPOC;
  assert.ok(dPOC !== null && dPOC >= 100 && dPOC <= 102);
});

test("computeLevels leaves dPOC null when today's range is flat", () => {
  const out = computeLevels(
    split({ regular: [bar(1, 100, 100, 10), bar(2, 100, 100, 10)] }),
  );
  assert.ok("levels" in out);
  assert.equal(out.levels.dPOC, null);
});

test("computeLevels errors on a flat previous session", () => {
  const flat = [bar(0, 100, 100, 10), bar(300, 100, 100, 10)];
  assert.deepEqual(computeLevels(split({ previous: flat })), {
    error: "profile เมื่อวานคำนวณไม่ได้",
  });
});

test("computeLevels errors when there is no previous session", () => {
  assert.deepEqual(
    computeLevels(split({ previousDate: null, previous: [] })),
    { error: "ไม่มีวันทำการก่อนหน้า" },
  );
});
