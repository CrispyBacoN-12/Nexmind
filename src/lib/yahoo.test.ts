import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYahooChart } from "./yahoo";

/**
 * A 20:1 split, the way Yahoo actually reports one: `quote` stays raw, so the
 * close falls from 2200 to 112 overnight, while `adjclose` divides every
 * pre-split bar by 20. This is the exact shape that voided the first
 * cross-sectional momentum run — a 12-month lookback spanning the split read as
 * roughly -95% for a stock that had gone up.
 */
function splitChart() {
  return {
    chart: {
      result: [
        {
          timestamp: [1000, 2000, 3000, 4000],
          meta: { currency: "USD", exchangeName: "NMS", regularMarketPrice: 115 },
          indicators: {
            quote: [
              {
                open: [1990, 2150, 111, 114],
                high: [2010, 2250, 113, 116],
                low: [1980, 2100, 110, 113],
                close: [2000, 2200, 112, 115],
                volume: [800_000, 1_000_000, 20_000_000, 21_000_000],
              },
            ],
            adjclose: [{ adjclose: [100, 110, 112, 115] }],
          },
        },
      ],
    },
  };
}

test("parseYahooChart back-adjusts pre-split bars so the split is not a -95% return", () => {
  const r = parseYahooChart(splitChart(), "GOOG", "max", "1d");
  const closes = r.candles.map((c) => c.c);
  assert.deepEqual(closes, [100, 110, 112, 115]);

  // The defect this test exists to prevent, stated as the number that broke:
  const splitDayReturn = closes[2] / closes[1] - 1;
  assert.ok(
    Math.abs(splitDayReturn - 0.0181818181818) < 1e-9,
    `split-day return should be +1.82%, got ${(splitDayReturn * 100).toFixed(2)}%`,
  );
});

test("parseYahooChart applies the adjustment factor to open/high/low, not just close", () => {
  const r = parseYahooChart(splitChart(), "GOOG", "max", "1d");
  // Bar 1 factor is 110/2200 = 0.05.
  assert.equal(r.candles[1].o, 107.5);
  assert.equal(r.candles[1].h, 112.5);
  assert.equal(r.candles[1].l, 105);
  // An unadjusted high beside an adjusted close would make bar 1 a 2045% intraday
  // range, so this assertion is what keeps OHLC internally consistent.
  assert.ok(r.candles[1].h >= r.candles[1].c && r.candles[1].c >= r.candles[1].l);
});

test("parseYahooChart scales volume so dollar volume survives the split", () => {
  const r = parseYahooChart(splitChart(), "GOOG", "max", "1d");
  // Raw bar 1: 2200 * 1_000_000 = 2.2e9. Adjusted must be the same dollar figure.
  assert.equal(r.candles[1].v, 20_000_000);
  assert.equal(r.candles[1].c * r.candles[1].v, 2_200_000_000);
  // Post-split bars have factor 1 and must be left exactly alone.
  assert.equal(r.candles[3].v, 21_000_000);
});

test("parseYahooChart leaves the newest bar and the live price untouched", () => {
  const r = parseYahooChart(splitChart(), "GOOG", "max", "1d");
  // adjclose equals close at the most recent bar (no later corporate events), so
  // the factor is 1 there. This is why fixing history does not move live signals.
  assert.deepEqual(r.candles.at(-1), { t: 4000, o: 114, h: 116, l: 113, c: 115, v: 21_000_000 });
  assert.equal(r.price, 115);
  assert.equal(r.currency, "USD");
  assert.equal(r.exchangeName, "NMS");
});

test("parseYahooChart passes bars through unchanged when adjclose is absent", () => {
  // Intraday intervals return no adjclose block; the factor falls back to 1.
  const json = splitChart();
  delete (json.chart.result[0].indicators as { adjclose?: unknown }).adjclose;
  const r = parseYahooChart(json, "GOOG", "1d", "5m");
  assert.deepEqual(
    r.candles.map((c) => c.c),
    [2000, 2200, 112, 115],
  );
  assert.deepEqual(
    r.candles.map((c) => c.v),
    [800_000, 1_000_000, 20_000_000, 21_000_000],
  );
});

test("parseYahooChart skips null closes and survives a zero close", () => {
  const json = {
    chart: {
      result: [
        {
          timestamp: [1000, 2000, 3000],
          meta: {},
          indicators: {
            quote: [{ close: [10, null, 0], volume: [1, 2, 3] }],
            adjclose: [{ adjclose: [5, null, 4] }],
          },
        },
      ],
    },
  };
  const r = parseYahooChart(json, "X", "max", "1d");
  assert.equal(r.candles.length, 2, "the null close is dropped");
  assert.equal(r.candles[0].c, 5);
  // A zero close would make the factor Infinity; it must fall back to 1 instead.
  assert.equal(r.candles[1].c, 0);
  assert.equal(r.candles[1].v, 3);
});

test("parseYahooChart throws when the payload carries no result", () => {
  assert.throws(() => parseYahooChart({ chart: { result: [] } }, "X", "max", "1d"), /no data/);
  assert.throws(() => parseYahooChart({}, "X", "max", "1d"), /no data/);
});
