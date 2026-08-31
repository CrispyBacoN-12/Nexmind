import "dotenv/config"; // scanner.ts -> research/adapter.ts imports prisma at module scope
import { test } from "node:test";
import assert from "node:assert/strict";
import { historyShortfall, MIN_SCAN_BARS } from "./scanner";

// Why a scan needs a floor on bar count
// -------------------------------------
// 2026-08-30, portfolio #11's weekly sweep: EA's series came back from Yahoo
// with TWO bars. fetchCandles returns the last provider's answer even when
// short — deliberately, because a genuinely young listing has no deeper history
// anywhere — but nothing downstream checked. So EA was scanned, a Signal was
// written, and three analysts were paid to read a facts sheet whose SMA20,
// SMA50, RSI, ADX, ATR and Bollinger fields were all null.
//
// The trend analyst's lens says to weigh MA alignment "above all else". Below
// 50 bars SMA50 does not exist, so that vote is cast on nothing at all. The
// floor is where the deepest reading in the snapshot first becomes defined.

const bars = (n: number) => Array.from({ length: n }, (_, i) => ({ t: i * 604800, o: 1, h: 1, l: 1, c: 1, v: 1 }));

test("a two-bar series is refused, with the count in the reason", () => {
  // EA's actual series on the day this was found.
  const why = historyShortfall(bars(2));
  assert.ok(why, "2 bars must not be scannable");
  assert.match(why, /2/);
  assert.match(why, new RegExp(String(MIN_SCAN_BARS)));
});

test("the floor is the bar count at which SMA50 first exists", () => {
  // Not an arbitrary round number: one bar short and the trend analyst's
  // primary reading is still null.
  assert.equal(MIN_SCAN_BARS, 50);
  assert.ok(historyShortfall(bars(MIN_SCAN_BARS - 1)));
  assert.equal(historyShortfall(bars(MIN_SCAN_BARS)), null);
});

test("a full-depth series passes", () => {
  assert.equal(historyShortfall(bars(260)), null);
});

test("an empty series is refused rather than treated as deep enough", () => {
  assert.ok(historyShortfall([]));
});
