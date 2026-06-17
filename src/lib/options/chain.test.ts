import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOptionChain } from "./chain";

const sample = {
  optionChain: {
    result: [{
      underlyingSymbol: "AAPL",
      expirationDates: [1700000000, 1702000000],
      quote: { regularMarketPrice: 190.5 },
      options: [{
        expirationDate: 1700000000,
        calls: [
          { strike: 185, lastPrice: 8.1, bid: 8.0, ask: 8.2, impliedVolatility: 0.28 },
          { strike: 190, lastPrice: 5.0, bid: 4.9, ask: 5.1, impliedVolatility: 0.27 },
        ],
        puts: [
          { strike: 190, lastPrice: 4.6, bid: 4.5, ask: 4.7, impliedVolatility: 0.29 },
        ],
      }],
    }],
  },
};

test("parseOptionChain: maps underlying price, expiries, calls and puts", () => {
  const c = parseOptionChain(sample);
  assert.equal(c.underlyingPrice, 190.5);
  assert.deepEqual(c.expiries, [1700000000, 1702000000]);
  assert.equal(c.calls.length, 2);
  assert.equal(c.puts.length, 1);
  assert.deepEqual(c.calls[0], { type: "call", strike: 185, expiry: 1700000000, bid: 8.0, ask: 8.2, lastPrice: 8.1, impliedVolatility: 0.28 });
  assert.equal(c.puts[0].type, "put");
});

test("parseOptionChain: throws on missing result", () => {
  assert.throws(() => parseOptionChain({ optionChain: { result: [] } }));
  assert.throws(() => parseOptionChain({}));
});
