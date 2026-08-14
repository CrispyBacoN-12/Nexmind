import "dotenv/config"; // paperTrade.ts -> webull/symbols.ts imports prisma at module scope — needs DATABASE_URL to construct, same as other DB-touching scripts
import { test } from "node:test";
import assert from "node:assert/strict";
import { floorQty, isRegularTradingHours, buildBracketOrderPayload, deriveExitFromChildOrder, placeWebullBracketOrder } from "./paperTrade";

test("floorQty floors to a whole share, and returns null (skip) when < 1", () => {
  assert.equal(floorQty(7.027), 7);
  assert.equal(floorQty(1.99), 1);
  assert.equal(floorQty(0.9), null);
  assert.equal(floorQty(0), null);
});

test("isRegularTradingHours: true for a Tuesday 10:00 ET instant, false for 8:00 ET and weekends", () => {
  // 2026-06-16 is a Tuesday. 14:00 UTC = 10:00 ET (June, EDT = UTC-4).
  assert.equal(isRegularTradingHours(new Date("2026-06-16T14:00:00Z")), true);
  // 12:00 UTC = 08:00 ET — before the 09:30 open.
  assert.equal(isRegularTradingHours(new Date("2026-06-16T12:00:00Z")), false);
  // 2026-06-20 is a Saturday, same 14:00 UTC / 10:00 ET wall-clock time.
  assert.equal(isRegularTradingHours(new Date("2026-06-20T14:00:00Z")), false);
});

test("buildBracketOrderPayload: parent is always MARKET, TIF is always GTC, qty is floored", () => {
  const payload = buildBracketOrderPayload({
    symbol: "AAPL", side: "long", qty: 7.9, entry: 150, sl: 145, tp: 160,
    accountId: "acct-1", tickerId: 913256135,
  });
  assert.equal(payload.orderType, "MARKET");
  assert.equal(payload.timeInForce, "GTC");
  assert.equal(payload.quantity, 7);
  assert.equal(payload.action, "BUY");
  assert.equal(payload.bracket.stopLoss.stopPrice, 145);
  assert.equal(payload.bracket.takeProfit.limitPrice, 160);
});

test("buildBracketOrderPayload: short side maps to SELL", () => {
  const payload = buildBracketOrderPayload({ symbol: "AAPL", side: "short", qty: 2, entry: 150, sl: 155, tp: 140, accountId: "a", tickerId: 1 });
  assert.equal(payload.action, "SELL");
});

test("buildBracketOrderPayload: throws when the floored quantity is < 1 (caller must check floorQty first)", () => {
  assert.throws(() => buildBracketOrderPayload({ symbol: "AAPL", side: "long", qty: 0.5, entry: 1, sl: 1, tp: 1, accountId: "a", tickerId: 1 }), /qty < 1/);
});

test("deriveExitFromChildOrder: null/no-executions child -> not closed, no exit data", () => {
  const d = deriveExitFromChildOrder(null, 10);
  assert.deepEqual(d, { exitPrice: null, exitFilledQty: 0, exitReason: null, isClosed: false });
});

test("deriveExitFromChildOrder: partial fill (qty < entryFilledQty, non-terminal status) stays open, VWAP over executions so far", () => {
  const child = { status: "PARTIALLY_FILLED", executions: [{ qty: 4, price: 150 }], kind: "TAKE_PROFIT" as const };
  const d = deriveExitFromChildOrder(child, 10);
  assert.equal(d.exitPrice, 150);
  assert.equal(d.exitFilledQty, 4);
  assert.equal(d.isClosed, false, "must stay non-closed while exitFilledQty < entryFilledQty");
});

test("deriveExitFromChildOrder: multiple partial executions produce the volume-weighted average price", () => {
  const child = { status: "PARTIALLY_FILLED", executions: [{ qty: 4, price: 150 }, { qty: 6, price: 152 }], kind: "STOP_LOSS" as const };
  const d = deriveExitFromChildOrder(child, 10);
  // VWAP = (4*150 + 6*152) / 10 = 151.2
  assert.ok(Math.abs(d.exitPrice! - 151.2) < 1e-9);
  assert.equal(d.exitFilledQty, 10);
  assert.equal(d.isClosed, true, "exitFilledQty === entryFilledQty -> closed");
  assert.equal(d.exitReason, "STOP_LOSS");
});

test("deriveExitFromChildOrder: closed once the child order itself reports FILLED, even before qty check", () => {
  const child = { status: "FILLED", executions: [{ qty: 10, price: 150 }], kind: "TAKE_PROFIT" as const };
  const d = deriveExitFromChildOrder(child, 10);
  assert.equal(d.isClosed, true);
});

test("placeWebullBracketOrder: skips (does not call the network) outside RTH", async () => {
  const result = await placeWebullBracketOrder(
    { symbol: "AAPL", side: "long", qty: 5, entry: 150, sl: 145, tp: 160, accountId: "a" },
    { now: new Date("2026-06-16T12:00:00Z") }, // 08:00 ET, before open
  );
  assert.deepEqual(result, { kind: "skipped", reason: "outside-rth" });
});

test("placeWebullBracketOrder: skips (does not call the network) when qty floors under 1 share", async () => {
  const result = await placeWebullBracketOrder(
    { symbol: "AAPL", side: "long", qty: 0.4, entry: 150, sl: 145, tp: 160, accountId: "a" },
    { now: new Date("2026-06-16T14:00:00Z") }, // 10:00 ET, within RTH
  );
  assert.deepEqual(result, { kind: "skipped", reason: "qty-under-1" });
});
