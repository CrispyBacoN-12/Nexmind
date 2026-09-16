// src/lib/gold/types.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseGoldCandlesResponse,
  parseGoldTicksResponse,
  parseGoldPositionsResponse,
  parseGoldAccountResponse,
  parseGoldOrderResult,
  parseGoldHealthResponse,
} from "./types";

test("parses a valid candles response", () => {
  const parsed = parseGoldCandlesResponse({
    symbol: "XAUUSD",
    candles: [{ t: 1700000000, o: 1, h: 2, l: 0.5, c: 1.5, v: 100 }],
    truncated: false,
  });
  assert.equal(parsed.candles.length, 1);
});

test("rejects a candles response missing a required field", () => {
  assert.throws(() =>
    parseGoldCandlesResponse({ symbol: "XAUUSD", candles: [{ t: 1, o: 1 }], truncated: false }),
  );
});

test("parses a valid ticks response", () => {
  const parsed = parseGoldTicksResponse({
    symbol: "XAUUSD",
    ticks: [{ t: 1700000000.5, bid: 1.1, ask: 1.2, last: 1.15, volume: 3 }],
    truncated: true,
  });
  assert.equal(parsed.truncated, true);
});

test("parses a valid positions response", () => {
  const parsed = parseGoldPositionsResponse({
    positions: [
      {
        ticket: 1, symbol: "XAUUSD", side: "buy", volume: 0.1,
        priceOpen: 2000, priceCurrent: 2001, sl: 0, tp: 0,
        profit: 1, swap: 0, magic: 42, comment: "", openedAt: 1700000000,
      },
    ],
  });
  assert.equal(parsed.positions[0].side, "buy");
});

test("rejects a position with an invalid side", () => {
  assert.throws(() =>
    parseGoldPositionsResponse({
      positions: [
        {
          ticket: 1, symbol: "XAUUSD", side: "long", volume: 0.1,
          priceOpen: 2000, priceCurrent: 2001, sl: 0, tp: 0,
          profit: 1, swap: 0, magic: 42, comment: "", openedAt: 1700000000,
        },
      ],
    }),
  );
});

test("parses an account response, trade_mode optional", () => {
  const withMode = parseGoldAccountResponse({
    balance: 10000, equity: 10000, profit: 0, credit: 0, margin: 0,
    margin_free: 10000, margin_level: 0, leverage: 100, currency: "USD",
    trade_allowed: true, server: "Demo", trade_mode: "demo",
  });
  assert.equal(withMode.trade_mode, "demo");

  const withoutMode = parseGoldAccountResponse({
    balance: 10000, equity: 10000, profit: 0, credit: 0, margin: 0,
    margin_free: 10000, margin_level: 0, leverage: 100, currency: "USD",
    trade_allowed: true, server: "Demo",
  });
  assert.equal(withoutMode.trade_mode, undefined);
});

test("parses both branches of the order-result union", () => {
  const duplicate = parseGoldOrderResult({
    duplicate: true,
    position: {
      ticket: 1, symbol: "XAUUSD", side: "buy", volume: 0.1,
      priceOpen: 2000, priceCurrent: 2001, sl: 0, tp: 0,
      profit: 1, swap: 0, magic: 42, comment: "", openedAt: 1700000000,
    },
    note: "magic already open",
  });
  assert.equal(duplicate.duplicate, true);

  const filled = parseGoldOrderResult({
    duplicate: false, retcode: 10009, retcodeComment: "Request executed",
    order: 5, deal: 5, volume: 0.1, price: 2000, magic: 42,
  });
  assert.equal(filled.duplicate, false);
});

test("parses a health response", () => {
  assert.equal(parseGoldHealthResponse({ connected: true }).connected, true);
});
