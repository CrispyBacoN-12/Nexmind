// marketGate.ts is pure apart from readMarketGate, whose two dependencies are
// injected — so nothing here needs DATABASE_URL or the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { TREND_PERIOD, BENCHMARK } from "./regime";
import {
  gateSlots, readMarketGate, DEFAULT_MARKET_GATE, MARKET_GATE_SETTING,
  type MarketGateConfig,
} from "./marketGate";

const DAY = 86_400;
const T0 = Date.parse("2020-01-01T00:00:00Z") / 1000;

function bars(n: number, closeAt: (i: number) => number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = closeAt(i);
    return { t: T0 + i * DAY, o: c, h: c + 1, l: c - 1, c, v: 1000 };
  });
}

const uptrend = (n = 300) => bars(n, (i) => 100 + i);
const downtrend = (n = 300) => bars(n, (i) => 1000 - i);

test("above its own SMA200 the gate hands back every slot it was given", () => {
  const d = gateSlots(uptrend(), 5);
  assert.equal(d.slots, 5);
  assert.equal(d.benchAbove, true);
  assert.match(d.note, /risk-on/);
  assert.match(d.note, new RegExp(BENCHMARK));
});

test("below its own SMA200 the gate cuts the budget to slotsBelowTrend", () => {
  // The only leg that survived all five panel folds. Below-trend avgR was
  // negative in every one of them, which is what 0 encodes.
  const d = gateSlots(downtrend(), 5);
  assert.equal(d.slots, 0);
  assert.equal(d.benchAbove, false);
  assert.match(d.note, /risk-off/);

  const partial: MarketGateConfig = { enabled: true, slotsBelowTrend: 2 };
  assert.equal(gateSlots(downtrend(), 5, partial).slots, 2);
});

test("the gate only ever narrows the budget — it cannot invent a slot", () => {
  // Whatever slotsBelowTrend says, the position cap and the open-trade count
  // decided the free slots before the gate was consulted. A gate that could
  // raise them would be a second, unaudited position cap.
  const generous: MarketGateConfig = { enabled: true, slotsBelowTrend: 99 };
  assert.equal(gateSlots(downtrend(), 3, generous).slots, 3);
  assert.equal(gateSlots(uptrend(), 0).slots, 0);
  const negative: MarketGateConfig = { enabled: true, slotsBelowTrend: -4 };
  assert.equal(gateSlots(downtrend(), 3, negative).slots, 0, "never below zero");
});

test("disabled, the gate still reports its reading and changes nothing", () => {
  // A gate that goes quiet when switched off leaves nobody able to answer
  // \"what would it have done?\" from the logs alone.
  const off: MarketGateConfig = { ...DEFAULT_MARKET_GATE, enabled: false };
  const d = gateSlots(downtrend(), 5, off);
  assert.equal(d.slots, 5);
  assert.equal(d.benchAbove, false, "the reading is taken even when it is not applied");
  assert.match(d.note, /OFF/);
});

test("too little history fails OPEN, loudly, rather than halting the desk", () => {
  // Opposite of how the research gates fail, and on purpose: this one decides
  // whether the desk trades today. A data outage that silently stops it for a
  // week is a worse error than missing a filter worth ~0.02R.
  for (const short of [bars(0, () => 100), bars(TREND_PERIOD - 1, (i) => 1000 - i)]) {
    const d = gateSlots(short, 4);
    assert.equal(d.slots, 4, "ungated, not blocked");
    assert.equal(d.benchAbove, null, "null is not false");
    assert.match(d.note, /BLIND/);
  }
  // Exactly TREND_PERIOD bars is enough to read.
  assert.notEqual(gateSlots(bars(TREND_PERIOD, (i) => 1000 - i), 4).benchAbove, null);
});

// ---- readMarketGate ----

const okFetch = (candles: Candle[]) => async () => ({ candles });
const setting = (value: string) => async () => value;

test("readMarketGate honours the DB kill switch and defaults to on", async () => {
  const deps = { fetchCandles: okFetch(downtrend()), getSetting: setting("off") };
  assert.equal((await readMarketGate(5, deps)).slots, 5, `${MARKET_GATE_SETTING}="off" disables it`);

  const onByDefault = { fetchCandles: okFetch(downtrend()), getSetting: async (_k: string, fallback: string) => fallback };
  assert.equal((await readMarketGate(5, onByDefault)).slots, 0, "an absent setting leaves the gate on");
});

test("readMarketGate asks for enough calendar days to actually hold 200 sessions", async () => {
  // 200 sessions is ~290 calendar days. Asking for 200 DAYS would return a
  // series a third short and read as BLIND forever — the silent-truncation
  // failure that made every intraday blind test fail for weeks.
  let seen: { range: string; interval: string; minDays: number } | null = null;
  await readMarketGate(5, {
    fetchCandles: async (_s, range, interval, minDays) => { seen = { range, interval, minDays }; return { candles: uptrend() }; },
    getSetting: setting("on"),
  });
  assert.deepEqual(seen, { range: "2y", interval: "1d", minDays: 300 });
});

test("readMarketGate fails open when the benchmark fetch throws", async () => {
  const d = await readMarketGate(5, {
    fetchCandles: async () => { throw new Error("provider 503"); },
    getSetting: setting("on"),
  });
  assert.equal(d.slots, 5);
  assert.equal(d.benchAbove, null);
  assert.match(d.note, /BLIND/);
  assert.match(d.note, /provider 503/, "the reason belongs in the log, not swallowed");
});

test("a benchmark that cannot be its own series reads BLIND rather than risk-on", () => {
  // Measured 2026-08-30. fetchCandles("SPY","2y","1d",300) — readMarketGate's own
  // call — returned 731 bars whose closes ran $19.04 to $771.10: real SPY at both
  // ends with a different instrument spliced across the middle 84%. SMA200 came
  // out at 356.49 against a $769 close, so `benchAbove` was true unconditionally
  // and the one leg that survived the panel could never fire. The gate was not
  // wrong about the regime; it had become incapable of being wrong.
  const spliced = bars(TREND_PERIOD + 100, (i) => (i < TREND_PERIOD + 90 ? 30 : 769));
  const d = gateSlots(spliced, 5);
  assert.equal(d.benchAbove, null, "an impossible series is no reading at all");
  assert.equal(d.slots, 5, "the gate still fails OPEN — a data fault must not halt the desk");
  assert.match(d.note, /BLIND/);
  assert.match(d.note, /implausible|extension/i);
});

test("the sanity check leaves real trends alone", () => {
  // SPY's own extension from its SMA200 over 2016-2026 (2679 Alpaca bars) ran
  // -25.8% (2020-03-23) to +17.8% (2020-12-04). Both of these are further from
  // the mean than SPY has ever been, and both must still produce a reading.
  assert.equal(gateSlots(uptrend(), 5).benchAbove, true);
  assert.equal(gateSlots(downtrend(), 5).benchAbove, false);

  const crash = bars(TREND_PERIOD + 100, (i) => (i < TREND_PERIOD + 90 ? 100 : 70));
  const d = gateSlots(crash, 5);
  assert.equal(d.benchAbove, false, "-30% below trend is a crash, not a corrupt feed");
  assert.match(d.note, /risk-off/);
});

// Risk-on is long only
// --------------------
// The one side the gate removes, and the three cases where it must not.
// Approved 2026-09-08 as a COST cut: live, every short the desk has proposed
// reached HAWK consensus and was then vetoed by SAGE, 6 of 6 post-fix, for zero
// fills at four model calls each. It buys budget, not R.

test("risk-on allows the slots but not the short side", () => {
  const d = gateSlots(uptrend(), 5);
  assert.equal(d.slots, 5, "risk-on never costs a slot");
  assert.equal(d.shortsAllowed, false);
  assert.match(d.note, /long only/);
});

test("risk-off still allows shorts — it is the slot count that is cut, not the side", () => {
  const d = gateSlots(downtrend(), 5);
  assert.equal(d.shortsAllowed, true);
});

test("a blind gate allows shorts — the side filter fails open like the slot count", () => {
  const tooFew = bars(TREND_PERIOD - 1, (i) => 100 + i);
  assert.equal(gateSlots(tooFew, 4).benchAbove, null);
  assert.equal(gateSlots(tooFew, 4).shortsAllowed, true, "no reading is not a long-only reading");

  // The 2026-08-30 spliced series: above its mean by an impossible margin, and
  // therefore not a risk-on reading that may suppress anything.
  const spliced = bars(TREND_PERIOD + 5, (i) => (i < TREND_PERIOD ? 350 : 770));
  assert.equal(gateSlots(spliced, 5).benchAbove, null);
  assert.equal(gateSlots(spliced, 5).shortsAllowed, true);
});

test("the off switch turns off the side filter too", () => {
  const off = { ...DEFAULT_MARKET_GATE, enabled: false };
  const d = gateSlots(uptrend(), 5, off);
  assert.equal(d.benchAbove, true, "the reading is still taken");
  assert.equal(d.shortsAllowed, true, "but nothing is applied");
});
