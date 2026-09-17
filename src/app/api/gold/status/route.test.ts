import { test } from "node:test";
import assert from "node:assert/strict";
import { startFakeBridge, type FakeBridgeHandle } from "@/lib/gold/testing/fakeBridge";
import { GET } from "./route";

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

test("returns 200 with health and positions when the bridge is healthy", async () => {
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
    const res = await withEnv(bridge, () => GET());
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.health.connected, true);
    assert.equal(body.positions.length, 1);
  } finally {
    await bridge.close();
  }
});

test("returns 503 with an empty position list when the bridge is unreachable", async () => {
  const res = await withEnv(
    { url: "http://127.0.0.1:1", state: { secret: "x" } } as unknown as FakeBridgeHandle,
    () => GET(),
  );
  const body = await res.json();
  assert.equal(res.status, 503);
  assert.deepEqual(body.positions, []);
});
