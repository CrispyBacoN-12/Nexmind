import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rolloverNights,
  swapCost,
  swapInR,
  crossesWeekend,
  nextWeekClose,
  SWAP_MODE_DISABLED,
  SWAP_MODE_POINTS,
  SWAP_MODE_CURRENCY_DEPOSIT,
  SWAP_MODE_CURRENCY_SYMBOL,
  SWAP_MODE_INTEREST_CURRENT,
  type SwapTerms,
} from "./swap";

// A fixed week, with its weekdays asserted so the calendar is part of the test
// rather than an assumption inside it.
const MON = Date.UTC(2026, 8, 7); // 2026-09-07
const TUE = Date.UTC(2026, 8, 8);
const WED = Date.UTC(2026, 8, 9);
const THU = Date.UTC(2026, 8, 10);
const FRI = Date.UTC(2026, 8, 11);
const NEXT_MON = Date.UTC(2026, 8, 14);
const at = (day: number, hour: number) => day + hour * 3_600_000;

test("the fixture week has the weekdays the tests assume", () => {
  assert.deepEqual(
    [MON, TUE, WED, THU, FRI, NEXT_MON].map((d) => new Date(d).getUTCDay()),
    [1, 2, 3, 4, 5, 1],
  );
});

test("a position closed before the first rollover pays nothing", () => {
  assert.equal(rolloverNights(at(MON, 10), at(MON, 20)), 0);
});

test("one night is one charge", () => {
  assert.equal(rolloverNights(at(MON, 10), at(TUE, 10)), 1);
});

test("Wednesday's rollover is charged three times", () => {
  assert.equal(rolloverNights(at(WED, 10), at(THU, 10)), 3);
});

test("a full week pays seven nights, not nine", () => {
  // Mon+Tue+Thu+Fri = 4, Wed = 3. Saturday and Sunday are not charged at all —
  // that is what the triple day is covering. Charging all seven weekdays AND
  // tripling Wednesday would bill nine nights for a seven-night week.
  assert.equal(rolloverNights(at(MON, 10), at(NEXT_MON, 10)), 7);
});

test("a weekend held on its own costs nothing", () => {
  // Opened after Friday's rollover was struck, closed before Monday's. Surprising
  // but correct: the weekend was already paid for by Wednesday.
  assert.equal(rolloverNights(at(FRI, 22), at(NEXT_MON, 10)), 0);
});

test("a rollover at the open instant is not charged; one at the close instant is", () => {
  assert.equal(rolloverNights(at(MON, 21), at(TUE, 10)), 0);
  assert.equal(rolloverNights(at(MON, 10), at(MON, 21)), 1);
});

test("a non-positive or non-finite holding period is zero nights, not a throw", () => {
  assert.equal(rolloverNights(at(TUE, 10), at(MON, 10)), 0);
  assert.equal(rolloverNights(at(MON, 10), at(MON, 10)), 0);
  assert.equal(rolloverNights(NaN, at(MON, 10)), 0);
});

test("an absurd holding period is reported, not looped over", () => {
  assert.throws(
    () => rolloverNights(Date.UTC(1990, 0, 1), Date.UTC(2026, 0, 1)),
    /timestamps are wrong/,
  );
});

test("the rollover hour and triple day are configurable", () => {
  // A GMT+3 server rolls over at 21:00 UTC; a GMT+2 one at 22:00. A position
  // opened at 21:30 Monday is caught by one and missed by the other.
  assert.equal(rolloverNights(at(MON, 21.5), at(TUE, 10), { rolloverHourUtc: 21 }), 0);
  assert.equal(rolloverNights(at(MON, 21.5), at(TUE, 10), { rolloverHourUtc: 22 }), 1);
  assert.equal(rolloverNights(at(FRI, 10), at(NEXT_MON, 10), { tripleSwapDay: 5 }), 3);
});

// --- pricing ---------------------------------------------------------------

// XAUUSD as MT5 usually quotes it: swap in points, contract 100 × point 0.01, so
// one point is $1 per lot.
const goldPoints: SwapTerms = {
  swapLong: -4.5,
  swapShort: 1.2,
  swapMode: SWAP_MODE_POINTS,
  pointValuePerLot: 1,
};

test("points-mode swap prices to account currency", () => {
  const c = swapCost("long", 0.1, 3, goldPoints);
  assert.equal(c.priced, true);
  assert.ok(c.priced && Math.abs(c.usd - -1.35) < 1e-9);
});

test("a positive swap rate is a credit, and the short side has its own rate", () => {
  const c = swapCost("short", 0.1, 3, goldPoints);
  assert.ok(c.priced && c.usd > 0);
});

test("points mode without a point value refuses instead of returning zero", () => {
  const c = swapCost("long", 0.1, 3, { ...goldPoints, pointValuePerLot: undefined });
  assert.equal(c.priced, false);
  assert.ok(!c.priced && /pointValuePerLot/.test(c.reason));
});

test("deposit-currency mode needs no conversion", () => {
  const c = swapCost("long", 0.2, 2, { swapLong: -0.8, swapShort: 0.3, swapMode: SWAP_MODE_CURRENCY_DEPOSIT });
  assert.ok(c.priced && Math.abs(c.usd - -0.32) < 1e-9);
});

test("an annual-interest mode prices off notional on a 360-day year", () => {
  const c = swapCost("long", 1, 36, {
    swapLong: -2.5,
    swapShort: 0,
    swapMode: SWAP_MODE_INTEREST_CURRENT,
    notionalPerLot: 100_000,
  });
  assert.ok(c.priced && Math.abs(c.usd - -250) < 1e-9); // -2.5% × 100k × 36/360
});

test("a mode that would need an unknown FX rate refuses", () => {
  const c = swapCost("long", 0.1, 3, { swapLong: -4.5, swapShort: 1.2, swapMode: SWAP_MODE_CURRENCY_SYMBOL });
  assert.equal(c.priced, false);
  assert.ok(!c.priced && /conversion/.test(c.reason));
});

test("disabled swap and zero nights are both a priced zero", () => {
  const off = swapCost("long", 0.1, 3, { ...goldPoints, swapMode: SWAP_MODE_DISABLED });
  assert.ok(off.priced && off.usd === 0);
  const none = swapCost("long", 0.1, 0, goldPoints);
  assert.ok(none.priced && none.usd === 0);
});

test("swapInR converts against the trade's own risk", () => {
  const c = swapCost("long", 0.1, 3, goldPoints); // -1.35
  assert.ok(Math.abs(swapInR(c, 100)! - -0.0135) < 1e-9);
});

test("swapInR is null when the charge is unpriced or the risk is unmeasurable", () => {
  const unpriced = swapCost("long", 0.1, 3, { ...goldPoints, pointValuePerLot: undefined });
  assert.equal(swapInR(unpriced, 100), null);
  assert.equal(swapInR(swapCost("long", 0.1, 3, goldPoints), 0), null);
});

test("financing is the size of the effect being hunted, which is why it is not a footnote", () => {
  // 0.1 lot of gold (10 oz) at -4.5 points/night, against the 2026 median
  // 1.5×ATR stop of $29/oz — so $290 of risk. Seven nights costs $3.15, or
  // 0.011R, against effects this project measures at ~0.04R. A quarter of the
  // edge, per week held, from a line that is easy to leave in a footnote.
  const week = swapCost("long", 0.1, rolloverNights(at(MON, 10), at(NEXT_MON, 10)), goldPoints);
  const r = swapInR(week, 0.1 * 100 * 29)!;
  assert.ok(r < -0.010 && r > -0.012, `expected ~-0.0109R, got ${r}`);
});

// --- the weekend gap -------------------------------------------------------

test("nextWeekClose finds Friday's close, and rolls to the next week once past it", () => {
  assert.equal(nextWeekClose(at(WED, 10)), at(FRI, 21));
  assert.equal(nextWeekClose(at(FRI, 20)), at(FRI, 21));
  assert.equal(nextWeekClose(at(FRI, 22)), at(FRI, 21) + 7 * 86_400_000);
  assert.equal(nextWeekClose(at(FRI, 21)), at(FRI, 21)); // exactly at the close
});

test("crossesWeekend separates a held-through trade from one closed in time", () => {
  assert.equal(crossesWeekend(at(THU, 10), at(FRI, 20)), false);
  assert.equal(crossesWeekend(at(THU, 10), at(NEXT_MON, 10)), true);
  assert.equal(crossesWeekend(at(FRI, 20), at(FRI, 21)), true); // closed exactly at the gap
  assert.equal(crossesWeekend(at(MON, 10), at(MON, 10)), false);
});
