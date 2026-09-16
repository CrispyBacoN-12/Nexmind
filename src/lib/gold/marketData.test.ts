import { test } from "node:test";
import assert from "node:assert/strict";
import { startFakeBridge, type FakeBridgeHandle } from "./testing/fakeBridge";
import {
  toUtcBar,
  normalizeToUtc,
  detectGaps,
  backfillGaps,
  attachSpread,
  computeReadState,
  DEFAULT_EET_EEST_SCHEDULE,
  DEFAULT_WEEKLY_CLOSURE,
  type RawBar,
} from "./marketData";

async function withEnv<T>(bridge: FakeBridgeHandle, fn: () => Promise<T>): Promise<T> {
  const prevSecret = process.env.MT5_BRIDGE_SECRET;
  const prevUrl = process.env.MT5_BRIDGE_URL;
  process.env.MT5_BRIDGE_SECRET = bridge.state.secret;
  process.env.MT5_BRIDGE_URL = bridge.url;
  try {
    return await fn();
  } finally {
    if (prevSecret === undefined) delete process.env.MT5_BRIDGE_SECRET; else process.env.MT5_BRIDGE_SECRET = prevSecret;
    if (prevUrl === undefined) delete process.env.MT5_BRIDGE_URL; else process.env.MT5_BRIDGE_URL = prevUrl;
  }
}

test("toUtcBar applies the EET (+2h) offset outside the DST window", () => {
  // 2026-01-15 12:00 broker-local (naive epoch reading), well outside DST.
  const brokerTime = Date.UTC(2026, 0, 15, 12) / 1000;
  const bar: RawBar = { brokerTime, o: 1, h: 1, l: 1, c: 1, v: 1 };
  const utc = toUtcBar(bar, DEFAULT_EET_EEST_SCHEDULE);
  assert.equal(utc.utcTime, brokerTime - 2 * 3600);
});

test("toUtcBar applies the EEST (+3h) offset inside the DST window", () => {
  // 2026-07-15 12:00 broker-local, well inside DST.
  const brokerTime = Date.UTC(2026, 6, 15, 12) / 1000;
  const bar: RawBar = { brokerTime, o: 1, h: 1, l: 1, c: 1, v: 1 };
  const utc = toUtcBar(bar, DEFAULT_EET_EEST_SCHEDULE);
  assert.equal(utc.utcTime, brokerTime - 3 * 3600);
});

test("normalizeToUtc maps a whole series and preserves spread", () => {
  const bars: RawBar[] = [
    { brokerTime: Date.UTC(2026, 0, 15, 12) / 1000, o: 1, h: 2, l: 0.5, c: 1.5, v: 10, spreadAtClose: 0.3 },
  ];
  const [utc] = normalizeToUtc(bars);
  assert.equal(utc.spreadAtClose, 0.3);
});

test("detectGaps finds no gap in an unbroken hourly series", () => {
  const start = Date.UTC(2026, 5, 3, 0) / 1000; // Wednesday
  const bars: RawBar[] = Array.from({ length: 5 }, (_, i) => ({
    brokerTime: start + i * 3600, o: 1, h: 1, l: 1, c: 1, v: 1,
  }));
  assert.deepEqual(detectGaps(bars, 3600, start + 5 * 3600), []);
});

test("detectGaps flags a midweek gap as not-weekend", () => {
  const wedMorning = Date.UTC(2026, 5, 3, 8) / 1000; // Wednesday 08:00
  const bars: RawBar[] = [
    { brokerTime: wedMorning, o: 1, h: 1, l: 1, c: 1, v: 1 },
    { brokerTime: wedMorning + 3 * 3600, o: 1, h: 1, l: 1, c: 1, v: 1 }, // 3h hole
  ];
  const gaps = detectGaps(bars, 3600, wedMorning + 4 * 3600);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].isWeekend, false);
});

test("detectGaps flags a Friday-close-to-Sunday-open gap as weekend", () => {
  const fridayBeforeClose = Date.UTC(2026, 5, 5, 20) / 1000; // Friday 20:00 UTC, still open
  const sundayAfterOpen = Date.UTC(2026, 5, 7, 22) / 1000; // Sunday 22:00 UTC, open again
  const bars: RawBar[] = [
    { brokerTime: fridayBeforeClose, o: 1, h: 1, l: 1, c: 1, v: 1 },
    { brokerTime: sundayAfterOpen, o: 1, h: 1, l: 1, c: 1, v: 1 },
  ];
  const gaps = detectGaps(bars, 3600, sundayAfterOpen, DEFAULT_WEEKLY_CLOSURE);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].isWeekend, true);
});

test("backfillGaps calls fetchMt5CandleRange only for non-weekend gaps and filters to the window", async () => {
  const wedMorning = Date.UTC(2026, 5, 3, 8) / 1000;
  const bridge = await startFakeBridge({
    candles: [
      { t: wedMorning + 3600, o: 1, h: 1, l: 1, c: 1, v: 1 },
      { t: wedMorning + 7200, o: 1, h: 1, l: 1, c: 1, v: 1 },
      { t: wedMorning - 3600, o: 9, h: 9, l: 9, c: 9, v: 9 }, // outside the gap window
    ],
  });
  try {
    const filled = await withEnv(bridge, () =>
      backfillGaps("XAUUSD", "H1", [
        { fromExclusive: wedMorning, toExclusive: wedMorning + 3 * 3600, isWeekend: false },
        { fromExclusive: wedMorning, toExclusive: wedMorning + 3 * 3600, isWeekend: true },
      ]),
    );
    assert.equal(filled.length, 2);
    assert.ok(filled.every((b) => b.brokerTime > wedMorning && b.brokerTime < wedMorning + 3 * 3600));
  } finally {
    await bridge.close();
  }
});

test("attachSpread assigns the nearest tick at or after the bar", () => {
  const bars: RawBar[] = [{ brokerTime: 1000, o: 1, h: 1, l: 1, c: 1, v: 1 }];
  const ticks = [
    { t: 990, bid: 1, ask: 1.1 },
    { t: 1005, bid: 2, ask: 2.2 },
  ];
  const [withSpread] = attachSpread(bars, ticks);
  assert.ok(withSpread.spreadAtClose !== undefined);
  assert.equal(Math.round((withSpread.spreadAtClose as number) * 100) / 100, 0.2);
});

test("attachSpread leaves a bar unchanged when no tick follows it", () => {
  const bars: RawBar[] = [{ brokerTime: 5000, o: 1, h: 1, l: 1, c: 1, v: 1 }];
  const ticks = [{ t: 100, bid: 1, ask: 1.1 }];
  const [unchanged] = attachSpread(bars, ticks);
  assert.equal(unchanged.spreadAtClose, undefined);
});

test("computeReadState reports OK within the threshold and DEGRADED beyond it", () => {
  assert.equal(computeReadState(1000, 1005, 7), "OK");
  assert.equal(computeReadState(1000, 1008, 7), "DEGRADED");
});
