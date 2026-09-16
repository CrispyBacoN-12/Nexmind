import { test } from "node:test";
import assert from "node:assert/strict";
import { startFakeBridge, type FakeBridgeHandle } from "./testing/fakeBridge";
import { assertDemoAccount, reconcilePositions, placeOrder, closePosition, GoldOrderUnresolvedError } from "./broker";

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

test("assertDemoAccount passes on a demo account", async () => {
  const bridge = await startFakeBridge();
  try {
    await withEnv(bridge, () => assertDemoAccount());
  } finally {
    await bridge.close();
  }
});

test("assertDemoAccount throws on a real account", async () => {
  const bridge = await startFakeBridge({ account: { ...(await startFakeBridge()).state.account, trade_mode: "real" } });
  try {
    await withEnv(bridge, async () => {
      await assert.rejects(assertDemoAccount(), /refusing to trade a non-demo account/);
    });
  } finally {
    await bridge.close();
  }
});

test("reconcilePositions returns open positions from the bridge", async () => {
  const bridge = await startFakeBridge({
    positions: [
      {
        ticket: 1, symbol: "XAUUSD", side: "buy", volume: 0.1,
        priceOpen: 2000, priceCurrent: 2001, sl: 0, tp: 0,
        profit: 1, swap: 0, magic: 1, comment: "", openedAt: 1700000000,
      },
    ],
  });
  try {
    const positions = await withEnv(bridge, () => reconcilePositions());
    assert.equal(positions.length, 1);
  } finally {
    await bridge.close();
  }
});

test("placeOrder returns sent on a genuine fill", async () => {
  const bridge = await startFakeBridge();
  try {
    const outcome = await withEnv(bridge, () =>
      placeOrder({ symbol: "XAUUSD", side: "buy", volume: 0.1, magic: 111 }),
    );
    assert.equal(outcome.status, "sent");
    if (outcome.status === "sent") assert.equal(outcome.result.duplicate, false);
  } finally {
    await bridge.close();
  }
});

test("placeOrder returns not-sent with the right bucket on a terminal rejection", async () => {
  const bridge = await startFakeBridge({ nextOrderRetcode: 10019, nextOrderComment: "No money" });
  try {
    const outcome = await withEnv(bridge, () =>
      placeOrder({ symbol: "XAUUSD", side: "buy", volume: 0.1, magic: 222 }),
    );
    assert.equal(outcome.status, "not-sent");
    if (outcome.status === "not-sent") assert.equal(outcome.bucket, "TerminalRejection");
  } finally {
    await bridge.close();
  }
});

test("placeOrder resolves an in-flight timeout via boot reconciliation once the position appears", async () => {
  const bridge = await startFakeBridge({ orderShouldHang: true });
  try {
    const resultPromise = withEnv(bridge, () =>
      placeOrder(
        { symbol: "XAUUSD", side: "buy", volume: 0.1, magic: 333 },
        { raceTimeoutMs: 50, maxResolutionAttempts: 3, resolutionDelayMs: 50 },
      ),
    );
    // Simulate the order landing on the broker's side shortly after the
    // client gives up waiting on the hung HTTP call.
    setTimeout(() => {
      bridge.state.positions.push({
        ticket: 9, symbol: "XAUUSD", side: "buy", volume: 0.1,
        priceOpen: 2000, priceCurrent: 2000, sl: 0, tp: 0,
        profit: 0, swap: 0, magic: 333, comment: "", openedAt: 1700000000,
      });
    }, 60);
    const outcome = await resultPromise;
    assert.equal(outcome.status, "sent");
    if (outcome.status === "sent") assert.equal(outcome.result.duplicate, true);
  } finally {
    await bridge.close();
  }
});

test("placeOrder throws GoldOrderUnresolvedError when resolution exhausts its attempts", async () => {
  const bridge = await startFakeBridge({ orderShouldHang: true });
  try {
    await withEnv(bridge, async () => {
      await assert.rejects(
        placeOrder(
          { symbol: "XAUUSD", side: "buy", volume: 0.1, magic: 444 },
          { raceTimeoutMs: 30, maxResolutionAttempts: 2, resolutionDelayMs: 30 },
        ),
        GoldOrderUnresolvedError,
      );
    });
  } finally {
    await bridge.close();
  }
});

test("closePosition delegates to closeMt5Position after the demo gate", async () => {
  const bridge = await startFakeBridge({
    positions: [
      {
        ticket: 5, symbol: "XAUUSD", side: "buy", volume: 0.1,
        priceOpen: 2000, priceCurrent: 2001, sl: 0, tp: 0,
        profit: 1, swap: 0, magic: 555, comment: "", openedAt: 1700000000,
      },
    ],
  });
  try {
    const result = await withEnv(bridge, () => closePosition({ magic: 555 }));
    assert.equal(result.closed, true);
  } finally {
    await bridge.close();
  }
});
