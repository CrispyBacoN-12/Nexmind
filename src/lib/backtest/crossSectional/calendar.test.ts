import { test } from "node:test";
import assert from "node:assert/strict";
import { dayKey, alignUniverse } from "./calendar";
import type { Candle } from "@/lib/indicators";

const DAY = 86_400;
function bar(t: number, c: number): Candle {
  return { t, o: c, h: c, l: c, c, v: 1000 };
}

test("dayKey collapses different intraday timestamps on the same UTC day", () => {
  // Providers stamp daily bars differently: some at midnight UTC, some at the
  // 13:30 UTC US open. Both must land on the same calendar day.
  assert.equal(dayKey(10 * DAY), dayKey(10 * DAY + 13 * 3600 + 1800));
  assert.notEqual(dayKey(10 * DAY), dayKey(11 * DAY));
});

test("alignUniverse builds a sorted union of trading days", () => {
  const bars = new Map<string, Candle[]>([
    ["AAA", [bar(1 * DAY, 10), bar(3 * DAY, 12)]],
    ["BBB", [bar(2 * DAY, 20), bar(3 * DAY, 21)]],
  ]);
  const u = alignUniverse(bars);
  assert.deepEqual(u.days, [dayKey(1 * DAY), dayKey(2 * DAY), dayKey(3 * DAY)]);
});

test("alignUniverse indexes each symbol's bar position by day", () => {
  const bars = new Map<string, Candle[]>([
    ["AAA", [bar(1 * DAY, 10), bar(3 * DAY, 12)]],
    ["BBB", [bar(2 * DAY, 20), bar(3 * DAY, 21)]],
  ]);
  const u = alignUniverse(bars);
  assert.equal(u.index.get("AAA")?.get(dayKey(3 * DAY)), 1);
  assert.equal(u.index.get("BBB")?.get(dayKey(3 * DAY)), 1);
  // AAA has no bar on day 2 — a symbol that had not listed yet, or a halt.
  assert.equal(u.index.get("AAA")?.get(dayKey(2 * DAY)), undefined);
});

test("alignUniverse keeps the last bar when a symbol has two bars on one day", () => {
  const bars = new Map<string, Candle[]>([
    ["AAA", [bar(1 * DAY, 10), bar(1 * DAY + 3600, 11)]],
  ]);
  const u = alignUniverse(bars);
  assert.deepEqual(u.days, [dayKey(1 * DAY)]);
  assert.equal(u.index.get("AAA")?.get(dayKey(1 * DAY)), 1);
});
