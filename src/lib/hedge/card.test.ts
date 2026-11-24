// buildHedgeCard with fake data sources: every external source can fail on its
// own, and one failing source must never blank the rest of the card.

import { test } from "node:test";
import assert from "node:assert/strict";

import type { EarningsInfo, LiveQuote } from "@/lib/advisor/types";
import type { Candle } from "@/lib/indicators";

import type { PutQuotesResult, PutWindow } from "./alpacaPuts";
import { buildHedgeCard, type HedgeDeps } from "./card";

const POS = { id: 1, ticker: "MSFT", shares: 20, entryPrice: 410, stop: 395 };
const TODAY = "2026-11-25";
const NOW = Date.parse("2026-11-25T00:00:00Z");
const T = "2026-11-24T18:47:01Z";

const put = (expiry: string, strike: number, ask = 1.85, bid = 1.6) => {
  const [y, m, d] = expiry.split("-");
  const sym = `MSFT${y.slice(2)}${m}${d}P${String(Math.round(strike * 1000)).padStart(8, "0")}`;
  return { symbol: sym, expiry, strike, bid, ask, quotedAt: T };
};

function bars(n: number, close = 400): Candle[] {
  return Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000 + i * 86400, o: close, h: close + 1, l: close - 1, c: close, v: 1 }));
}

function deps(over: Partial<HedgeDeps> & { windows?: PutWindow[]; putCalls?: { n: number } } = {}): HedgeDeps {
  const windows = over.windows ?? [];
  const putCalls = over.putCalls ?? { n: 0 };
  return {
    liveQuote: over.liveQuote ?? (async (): Promise<LiveQuote> => ({ price: 418.2, at: 1_795_000_000 })),
    earnings: over.earnings ?? (async (): Promise<EarningsInfo> => ({ date: "2026-12-03", hour: "amc" })),
    putQuotes:
      over.putQuotes ??
      (async (_t: string, w: PutWindow): Promise<PutQuotesResult> => {
        windows.push(w);
        putCalls.n += 1;
        return { quotes: [put("2026-12-04", 395), put("2026-12-04", 397.5), put("2026-12-04", 417.5), put("2026-12-11", 395)] };
      }),
    candles: over.candles === undefined ? bars(70) : over.candles,
  };
}

test("buildHedgeCard: full card", async () => {
  const windows: PutWindow[] = [];
  const card = await buildHedgeCard(POS, deps({ windows }), TODAY, NOW);
  assert.equal(card.price, 418.2);
  assert.equal(card.priceSource, "live");
  assert.equal(card.expiry, "2026-12-04");
  assert.equal(card.expiryReason, "afterEarnings");
  assert.deepEqual(card.rows.map((r) => r.strike), [417.5, 397.5, 395]);
  assert.deepEqual(card.rows.map((r) => r.targets), [["atm"], ["minus5"], ["stop"]]);
  assert.equal(card.rows[2].premiumTotal, 185);
  assert.equal(card.rows[2].stale, false);
  assert.equal(card.contracts, 1);
  assert.equal(card.overHedge, 5);
  assert.equal(card.optionsError, null);
  assert.equal(card.stopOnly?.atStop, 300);
  assert.equal(windows[0].expGte, "2026-12-04");
  assert.equal(windows[0].expLte, "2026-12-25");
  assert.ok(windows[0].strikeGte <= 395 && windows[0].strikeLte >= 418.2);
});

test("buildHedgeCard: falls back to last close", async () => {
  const card = await buildHedgeCard(
    POS,
    deps({ liveQuote: async () => ({ price: null, at: null, note: "FINNHUB_API_KEY not set" }) }),
    TODAY,
    NOW,
  );
  assert.equal(card.price, 400);
  assert.equal(card.priceSource, "lastClose");
  assert.ok(card.priceNote?.includes("FINNHUB_API_KEY not set"));
});

test("buildHedgeCard: no price at all", async () => {
  const putCalls = { n: 0 };
  const card = await buildHedgeCard(
    POS,
    deps({ liveQuote: async () => ({ price: null, at: null, note: "down" }), candles: null, putCalls }),
    TODAY,
    NOW,
  );
  assert.equal(card.price, null);
  assert.deepEqual(card.rows, []);
  assert.equal(putCalls.n, 0);
});

test("buildHedgeCard: options error keeps the card", async () => {
  const card = await buildHedgeCard(POS, deps({ putQuotes: async () => ({ error: "Alpaca options HTTP 404" }) }), TODAY, NOW);
  assert.equal(card.optionsError, "Alpaca options HTTP 404");
  assert.deepEqual(card.rows, []);
  assert.equal(card.stopOnly?.atStop, 300);
  assert.equal(card.price, 418.2);
});

test("buildHedgeCard: no expiry in window", async () => {
  const card = await buildHedgeCard(POS, deps({ putQuotes: async () => ({ quotes: [] }) }), TODAY, NOW);
  assert.equal(card.expiry, null);
  assert.deepEqual(card.rows, []);
  assert.equal(card.optionsError, null);
  assert.equal(card.expiryReason, "afterEarnings");
});
