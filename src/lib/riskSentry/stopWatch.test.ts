import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { stopWatch } from "./stopWatch";

const T0 = Date.parse("2026-09-28T20:00:00Z") / 1000;
const DAY = 86_400;

function candle(i: number, low: number, close: number): Candle {
  return { t: T0 + i * DAY, o: close, h: close + 1, l: low, c: close, v: 1000 };
}

test("a last close at or below the stop is breached", () => {
  const hits = stopWatch([{ ticker: "KO", stop: 60 }], new Map([["KO", [candle(0, 61, 62), candle(1, 59, 60)]]]));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "breached");
  assert.equal(hits[0].close, 60);
  assert.equal(hits[0].date, "2026-09-29");
});

test("a low through the stop with a close above it is touched", () => {
  const hits = stopWatch([{ ticker: "KO", stop: 60 }], new Map([["KO", [candle(0, 59.5, 61)]]]));
  assert.equal(hits[0].kind, "touched");
  assert.equal(hits[0].low, 59.5);
});

test("only the last bar counts — an old breach that recovered is not reported", () => {
  const hits = stopWatch([{ ticker: "KO", stop: 60 }], new Map([["KO", [candle(0, 55, 56), candle(1, 61, 63)]]]));
  assert.deepEqual(hits, []);
});

test("missing or empty candles are skipped, not thrown", () => {
  const hits = stopWatch(
    [{ ticker: "AAA", stop: 10 }, { ticker: "BBB", stop: 10 }, { ticker: "CCC", stop: 10 }],
    new Map<string, Candle[] | null>([["AAA", null], ["BBB", []]]),
  );
  assert.deepEqual(hits, []);
});

test("every position is checked independently", () => {
  const hits = stopWatch(
    [{ ticker: "AAA", stop: 10 }, { ticker: "BBB", stop: 10 }, { ticker: "CCC", stop: 10 }],
    new Map([["AAA", [candle(0, 9, 9)]], ["BBB", [candle(0, 11, 12)]], ["CCC", [candle(0, 9.9, 10.5)]]]),
  );
  assert.deepEqual(hits.map((h) => `${h.ticker}:${h.kind}`), ["AAA:breached", "CCC:touched"]);
});
