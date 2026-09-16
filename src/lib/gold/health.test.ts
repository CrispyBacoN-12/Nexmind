import { test } from "node:test";
import assert from "node:assert/strict";
import { startFakeBridge, type FakeBridgeHandle } from "./testing/fakeBridge";
import { checkBridgeHealth } from "./health";

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) prev[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("reachable and connected when the bridge answers healthy", async () => {
  const bridge: FakeBridgeHandle = await startFakeBridge({ connected: true });
  try {
    const result = await withEnv(
      { MT5_BRIDGE_SECRET: bridge.state.secret, MT5_BRIDGE_URL: bridge.url },
      () => checkBridgeHealth(),
    );
    assert.equal(result.reachable, true);
    assert.equal(result.connected, true);
  } finally {
    await bridge.close();
  }
});

test("reachable but not connected when the bridge is up without a terminal", async () => {
  const bridge: FakeBridgeHandle = await startFakeBridge({ connected: false });
  try {
    const result = await withEnv(
      { MT5_BRIDGE_SECRET: bridge.state.secret, MT5_BRIDGE_URL: bridge.url },
      () => checkBridgeHealth(),
    );
    assert.equal(result.reachable, true);
    assert.equal(result.connected, false);
  } finally {
    await bridge.close();
  }
});

test("not reachable when the secret is missing", async () => {
  const result = await withEnv({ MT5_BRIDGE_SECRET: undefined }, () => checkBridgeHealth());
  assert.equal(result.reachable, false);
  assert.match(result.error ?? "", /MT5_BRIDGE_SECRET/);
});

test("not reachable when the secret is wrong", async () => {
  const bridge: FakeBridgeHandle = await startFakeBridge();
  try {
    const result = await withEnv(
      { MT5_BRIDGE_SECRET: "wrong-secret", MT5_BRIDGE_URL: bridge.url },
      () => checkBridgeHealth(),
    );
    assert.equal(result.reachable, false);
  } finally {
    await bridge.close();
  }
});

test("not reachable when nothing is listening at the URL", async () => {
  const result = await withEnv(
    { MT5_BRIDGE_SECRET: "any-secret", MT5_BRIDGE_URL: "http://127.0.0.1:1" },
    () => checkBridgeHealth(500),
  );
  assert.equal(result.reachable, false);
});
