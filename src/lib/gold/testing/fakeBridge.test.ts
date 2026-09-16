// src/lib/gold/testing/fakeBridge.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { startFakeBridge } from "./fakeBridge";

test("rejects a request with the wrong secret", async () => {
  const bridge = await startFakeBridge();
  try {
    const res = await fetch(`${bridge.url}/health`, { headers: { "X-Bridge-Secret": "wrong" } });
    assert.equal(res.status, 401);
  } finally {
    await bridge.close();
  }
});

test("answers /health with the configured connected flag", async () => {
  const bridge = await startFakeBridge({ connected: false });
  try {
    const res = await fetch(`${bridge.url}/health`, { headers: { "X-Bridge-Secret": bridge.state.secret } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.connected, false);
  } finally {
    await bridge.close();
  }
});

test("answers /account with the configured account", async () => {
  const bridge = await startFakeBridge();
  try {
    const res = await fetch(`${bridge.url}/account`, { headers: { "X-Bridge-Secret": bridge.state.secret } });
    const body = await res.json();
    assert.equal(body.trade_mode, "demo");
    assert.equal(body.balance, 10000);
  } finally {
    await bridge.close();
  }
});

test("recognises a duplicate order by magic without sending a new one", async () => {
  const bridge = await startFakeBridge({
    positions: [
      {
        ticket: 1, symbol: "XAUUSD", side: "buy", volume: 0.1,
        priceOpen: 2000, priceCurrent: 2001, sl: 0, tp: 0,
        profit: 0, swap: 0, magic: 99, comment: "", openedAt: 1700000000,
      },
    ],
  });
  try {
    const res = await fetch(`${bridge.url}/order`, {
      method: "POST",
      headers: { "X-Bridge-Secret": bridge.state.secret, "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: "XAUUSD", side: "buy", volume: 0.1, magic: 99 }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.duplicate, true);
    assert.equal(body.position.ticket, 1);
  } finally {
    await bridge.close();
  }
});

test("a fresh order fills and is added to open positions", async () => {
  const bridge = await startFakeBridge();
  try {
    const res = await fetch(`${bridge.url}/order`, {
      method: "POST",
      headers: { "X-Bridge-Secret": bridge.state.secret, "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: "XAUUSD", side: "buy", volume: 0.1, magic: 7 }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.duplicate, false);
    assert.equal(body.retcode, 10009);
    assert.equal(bridge.state.positions.length, 1);
  } finally {
    await bridge.close();
  }
});

test("nextOrderRetcode !== 10009 reports a rejection matching bridge.py's error format", async () => {
  const bridge = await startFakeBridge({ nextOrderRetcode: 10019, nextOrderComment: "No money" });
  try {
    const res = await fetch(`${bridge.url}/order`, {
      method: "POST",
      headers: { "X-Bridge-Secret": bridge.state.secret, "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: "XAUUSD", side: "buy", volume: 0.1, magic: 8 }),
    });
    const body = await res.json();
    assert.equal(res.status, 502);
    assert.equal(body.error, "order rejected: 10019 No money");
  } finally {
    await bridge.close();
  }
});

test("orderShouldHang never responds, letting the caller's own timeout fire", async () => {
  const bridge = await startFakeBridge({ orderShouldHang: true });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 200);
    await assert.rejects(
      fetch(`${bridge.url}/order`, {
        method: "POST",
        headers: { "X-Bridge-Secret": bridge.state.secret, "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: "XAUUSD", side: "buy", volume: 0.1, magic: 9 }),
        signal: controller.signal,
      }),
    );
    clearTimeout(timer);
  } finally {
    await bridge.close();
  }
});

test("close reports already-flat as a success, not an error", async () => {
  const bridge = await startFakeBridge();
  try {
    const res = await fetch(`${bridge.url}/close`, {
      method: "POST",
      headers: { "X-Bridge-Secret": bridge.state.secret, "Content-Type": "application/json" },
      body: JSON.stringify({ magic: 123 }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.closed, false);
  } finally {
    await bridge.close();
  }
});
