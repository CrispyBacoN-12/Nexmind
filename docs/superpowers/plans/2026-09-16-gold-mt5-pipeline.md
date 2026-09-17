# Gold MT5 Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a demo-gated gold/XAUUSD data-ingestion and order-execution pipeline (`src/lib/gold/`) on top of the existing, unmodified MT5 bridge (`mt5-bridge/bridge.py`) and client (`src/lib/mt5.ts`), with a boot-checked entrypoint script and a manual test harness — no mechanism/strategy logic included.

**Architecture:** Two independent CQRS-style flows on top of the existing bridge/client, both demo-gated. The read path wraps `fetchMt5CandleRange`/`fetchMt5Ticks`/`fetchMt5Positions` with UTC normalization, gap detection + backfill, spread capture, and a staleness heartbeat. The write path wraps `sendMt5Order`/`closeMt5Position` with a second demo assertion (`isDemoAccount()`), boot-time reconciliation via `fetchMt5Positions()`, and an `IN_FLIGHT_UNKNOWN` resolver for the order-timeout case. A shared Zod contract (`gold/types.ts`) validates the raw bridge JSON shapes and backs an in-process fake HTTP bridge (`gold/testing/fakeBridge.ts`) that lets every gold module be unit-tested without a real MT5 terminal.

**Tech Stack:** TypeScript on Node (Next.js 16.2.7, `moduleResolution: "bundler"`, `@/*` → `./src/*`). Zod `^4.4.3` for schema validation. Node's built-in test runner via `tsx --test "src/**/*.test.ts"` (existing `npm test` convention — no new test framework). Node's built-in `http` module for the fake bridge test double (no mocking library). Existing `src/lib/mt5.ts` HTTP client and `mt5-bridge/bridge.py`, both reused unmodified.

**Spec:** `docs/superpowers/specs/2026-09-16-gold-mt5-pipeline-design.md`

## Global Constraints

- Demo/paper only. No `ALLOW_LIVE` or `GOLD_MT5_*` flag exists anywhere in this module — the only config guard is: `MT5_BRIDGE_SECRET` must be set, and `MT5_BRIDGE_ALLOW_REAL` must not be `"1"`, checked before the boot healthcheck.
- MT5-only. No OANDA/PAXG code in this phase.
- `mt5-bridge/bridge.py` and `src/lib/mt5.ts` are reused exactly as they exist today — **never edit either file** in any task below.
- The gold desk runs as its own process (`npm run gold`). Never fold it into `scripts/dev.mts` or `scripts/session.mts` — see `docs/STATE.md` §5 for the incident this guards against (starting the wrong dev script triggered a real desk session).
- No mechanism/signal/strategy logic in this phase. `placeOrder`/`closePosition` in `gold/broker.ts` may only ever be called by the manual CLI harness (Task 8), never by an automated loop.
- Two independent demo gates, not one: `bridge.py`'s own `_trading_refusal()` (server-side, gated by how the bridge process was launched) PLUS `broker.ts`'s `assertDemoAccount()` (client-side, checked immediately before every order call). Do not collapse these into one check.
- Fail closed on connection loss: `marketData.ts` and `health.ts` report explicit `DEGRADED`/unreachable state, never stale-as-fresh.
- Nothing that talks to a real MT5 terminal (i.e. anything exercising `bridge.py` itself) can run in CI. All automated tests for this module talk to the in-process fake bridge (Task 2) over real HTTP, never to `bridge.py`.
- Retcode buckets are exactly: `RetriableWithNewQuote` = {10004, 10021}; `TerminalRejection` = {10014, 10015, 10016, 10019}; `MarketCondition` = {10018, 10027}.

---

## File Structure

```
src/lib/gold/
  types.ts             # Zod schemas for raw bridge.py JSON + parse helpers
  types.test.ts
  retcodes.ts           # pure retcode -> bucket classifier
  retcodes.test.ts
  health.ts             # standalone bridge /health check (not added to mt5.ts)
  health.test.ts
  broker.ts             # demo assertion, boot reconciliation, placeOrder/closePosition, IN_FLIGHT_UNKNOWN resolver
  broker.test.ts
  marketData.ts          # UTC normalization, gap detect+backfill, spread capture, staleness heartbeat
  marketData.test.ts
  testing/
    fakeBridge.ts        # real http.createServer test double for bridge.py's HTTP surface
    fakeBridge.test.ts
  README.md             # manual verification runbook (hard-kill test, terminal-lag test, etc.)
scripts/
  gold-desk.mts          # entrypoint: config guard -> healthcheck -> boot reconciliation -> ready
  gold-manual-order-test.mts  # CLI: positions | place <buy|sell> <volume> <label> | close <magic>
src/app/api/gold/status/
  route.ts               # optional: GET health+positions as JSON
  route.test.ts
package.json             # Modify: add "gold" script
```

- `types.ts` validates the RAW bridge.py wire shapes gold cares about — it does not re-derive `mt5.ts`'s already-typed outputs. This keeps the fake bridge honest against `bridge.py`'s actual JSON without duplicating `mt5.ts`'s own parsing.
- `broker.ts` and `marketData.ts` both import their I/O functions directly from `@/lib/mt5` (`fetchMt5Positions`, `sendMt5Order`, `closeMt5Position`, `fetchMt5Account`, `isDemoAccount`, `fetchMt5CandleRange`), never re-implementing HTTP calls.
- Every `*.test.ts` in `src/lib/gold/` talks to `testing/fakeBridge.ts` over real HTTP by pointing `process.env.MT5_BRIDGE_URL` at it — `mt5.ts` reads `MT5_BRIDGE_URL`/`MT5_BRIDGE_SECRET` fresh on every call (not cached at import time), which is exactly what makes this possible without mocking `mt5.ts` itself.

---

### Task 1: Gold wire-format types and Zod schemas

**Files:**
- Create: `src/lib/gold/types.ts`
- Test: `src/lib/gold/types.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `GoldCandle`, `GoldCandlesResponse`, `GoldTick`, `GoldTicksResponse`, `GoldPosition`, `GoldPositionsResponse`, `GoldAccountResponse`, `GoldOrderResult`, `GoldHealthResponse` types, and `parseGoldCandlesResponse`, `parseGoldTicksResponse`, `parseGoldPositionsResponse`, `parseGoldAccountResponse`, `parseGoldOrderResult`, `parseGoldHealthResponse` functions — all consumed by Task 2 (`fakeBridge.ts`, to validate its own canned responses) and indirectly by every later task's tests.

Field names below are copied verbatim from `mt5-bridge/bridge.py`'s handlers: `position_payload()` (lines 109-116, already camelCase), `/account` (lines 373-380, snake_case except `trade_mode`/`server`), `/order` success and rejection payloads (lines 558-568), `/health` (line 266).

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/gold/types.test.ts`
Expected: FAIL with a module-not-found error for `./types`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/gold/types.ts
import { z } from "zod";

export const GoldCandleSchema = z.object({
  t: z.number(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
});
export type GoldCandle = z.infer<typeof GoldCandleSchema>;

export const GoldCandlesResponseSchema = z.object({
  symbol: z.string(),
  candles: z.array(GoldCandleSchema),
  truncated: z.boolean(),
});
export type GoldCandlesResponse = z.infer<typeof GoldCandlesResponseSchema>;

export const GoldTickSchema = z.object({
  t: z.number(),
  bid: z.number(),
  ask: z.number(),
  last: z.number(),
  volume: z.number(),
});
export type GoldTick = z.infer<typeof GoldTickSchema>;

export const GoldTicksResponseSchema = z.object({
  symbol: z.string(),
  ticks: z.array(GoldTickSchema),
  truncated: z.boolean(),
});
export type GoldTicksResponse = z.infer<typeof GoldTicksResponseSchema>;

export const GoldPositionSchema = z.object({
  ticket: z.number(),
  symbol: z.string(),
  side: z.enum(["buy", "sell"]),
  volume: z.number(),
  priceOpen: z.number(),
  priceCurrent: z.number(),
  sl: z.number(),
  tp: z.number(),
  profit: z.number(),
  swap: z.number(),
  magic: z.number(),
  comment: z.string(),
  openedAt: z.number(),
});
export type GoldPosition = z.infer<typeof GoldPositionSchema>;

export const GoldPositionsResponseSchema = z.object({
  positions: z.array(GoldPositionSchema),
});
export type GoldPositionsResponse = z.infer<typeof GoldPositionsResponseSchema>;

// trade_mode is optional here even though bridge.py always sends it today —
// mt5.ts's own Mt5AccountInfo treats it as optional-with-fallback ("unknown"),
// and tests need to simulate that fail-closed path via the fake bridge.
export const GoldAccountResponseSchema = z.object({
  balance: z.number(),
  equity: z.number(),
  profit: z.number(),
  credit: z.number(),
  margin: z.number(),
  margin_free: z.number(),
  margin_level: z.number(),
  leverage: z.number(),
  currency: z.string(),
  trade_allowed: z.boolean(),
  server: z.string(),
  trade_mode: z.string().optional(),
});
export type GoldAccountResponse = z.infer<typeof GoldAccountResponseSchema>;

export const GoldOrderResultSchema = z.union([
  z.object({
    duplicate: z.literal(true),
    position: GoldPositionSchema,
    note: z.string(),
  }),
  z.object({
    duplicate: z.literal(false),
    retcode: z.number(),
    retcodeComment: z.string(),
    order: z.number(),
    deal: z.number(),
    volume: z.number(),
    price: z.number(),
    magic: z.number(),
  }),
]);
export type GoldOrderResult = z.infer<typeof GoldOrderResultSchema>;

export const GoldHealthResponseSchema = z.object({
  connected: z.boolean(),
});
export type GoldHealthResponse = z.infer<typeof GoldHealthResponseSchema>;

export function parseGoldCandlesResponse(data: unknown): GoldCandlesResponse {
  return GoldCandlesResponseSchema.parse(data);
}
export function parseGoldTicksResponse(data: unknown): GoldTicksResponse {
  return GoldTicksResponseSchema.parse(data);
}
export function parseGoldPositionsResponse(data: unknown): GoldPositionsResponse {
  return GoldPositionsResponseSchema.parse(data);
}
export function parseGoldAccountResponse(data: unknown): GoldAccountResponse {
  return GoldAccountResponseSchema.parse(data);
}
export function parseGoldOrderResult(data: unknown): GoldOrderResult {
  return GoldOrderResultSchema.parse(data);
}
export function parseGoldHealthResponse(data: unknown): GoldHealthResponse {
  return GoldHealthResponseSchema.parse(data);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/gold/types.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gold/types.ts src/lib/gold/types.test.ts
git commit -m "feat(gold): add Zod schemas for the bridge's raw JSON shapes"
```

---

### Task 2: In-process fake MT5 bridge (test double)

**Files:**
- Create: `src/lib/gold/testing/fakeBridge.ts`
- Test: `src/lib/gold/testing/fakeBridge.test.ts`

**Interfaces:**
- Consumes: `GoldPosition` type from Task 1 (`src/lib/gold/types.ts`).
- Produces: `FakeBridgeState`, `FakeBridgeHandle`, `startFakeBridge(overrides?: Partial<FakeBridgeState>): Promise<FakeBridgeHandle>` — consumed by every later task's test file to point `process.env.MT5_BRIDGE_URL` at a real, disposable HTTP server implementing the same wire format as `bridge.py`.

This is a real `http.createServer`, not a `fetch` mock — `mt5.ts`'s `bridgeFetch`/`bridgePost` read `MT5_BRIDGE_URL`/`MT5_BRIDGE_SECRET` from `process.env` on every call, so pointing that env var at this server exercises the real, unmodified `mt5.ts` code end-to-end.

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/gold/testing/fakeBridge.test.ts`
Expected: FAIL with a module-not-found error for `./fakeBridge`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/gold/testing/fakeBridge.ts
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { GoldCandle, GoldPosition, GoldTick } from "../types";

export interface FakeBridgeAccount {
  balance: number;
  equity: number;
  profit: number;
  credit: number;
  margin: number;
  margin_free: number;
  margin_level: number;
  leverage: number;
  currency: string;
  trade_allowed: boolean;
  server: string;
  trade_mode?: string;
}

export interface FakeBridgeState {
  secret: string;
  connected: boolean;
  account: FakeBridgeAccount;
  candles: GoldCandle[];
  ticks: GoldTick[];
  positions: GoldPosition[];
  nextOrderRetcode: number;
  nextOrderComment: string;
  orderDelayMs: number;
  orderShouldHang: boolean;
}

export interface FakeBridgeHandle {
  url: string;
  state: FakeBridgeState;
  close: () => Promise<void>;
}

function defaultState(overrides?: Partial<FakeBridgeState>): FakeBridgeState {
  return {
    secret: "test-secret",
    connected: true,
    account: {
      balance: 10000,
      equity: 10000,
      profit: 0,
      credit: 0,
      margin: 0,
      margin_free: 10000,
      margin_level: 0,
      leverage: 100,
      currency: "USD",
      trade_allowed: true,
      server: "FakeBroker-Demo",
      trade_mode: "demo",
    },
    candles: [],
    ticks: [],
    positions: [],
    nextOrderRetcode: 10009,
    nextOrderComment: "Request executed",
    orderDelayMs: 0,
    orderShouldHang: false,
    ...overrides,
  };
}

export async function startFakeBridge(overrides?: Partial<FakeBridgeState>): Promise<FakeBridgeHandle> {
  const state = defaultState(overrides);
  const server = http.createServer((req, res) => {
    void handleRequest(req, res, state);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    state,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  state: FakeBridgeState,
): Promise<void> {
  if (req.headers["x-bridge-secret"] !== state.secret) {
    send(res, 401, { error: "bad or missing X-Bridge-Secret" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, { connected: state.connected });
    return;
  }
  if (req.method === "GET" && url.pathname === "/candles") {
    send(res, 200, { symbol: url.searchParams.get("symbol") ?? "", candles: state.candles, truncated: false });
    return;
  }
  if (req.method === "GET" && url.pathname === "/ticks") {
    send(res, 200, { symbol: url.searchParams.get("symbol") ?? "", ticks: state.ticks, truncated: false });
    return;
  }
  if (req.method === "GET" && url.pathname === "/positions") {
    const symbol = url.searchParams.get("symbol");
    const positions = symbol ? state.positions.filter((p) => p.symbol === symbol) : state.positions;
    send(res, 200, { positions });
    return;
  }
  if (req.method === "GET" && url.pathname === "/account") {
    send(res, 200, state.account);
    return;
  }
  if (req.method === "POST" && url.pathname === "/order") {
    await handleOrder(req, res, state);
    return;
  }
  if (req.method === "POST" && url.pathname === "/close") {
    await handleClose(req, res, state);
    return;
  }
  send(res, 404, { error: "unknown path" });
}

async function handleOrder(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  state: FakeBridgeState,
): Promise<void> {
  const body = (await readJsonBody(req)) as { symbol: string; side: "buy" | "sell"; volume: number; magic: number };

  if (state.orderShouldHang) return; // never respond — caller's own timeout fires

  if (state.orderDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, state.orderDelayMs));
  }

  const existing = state.positions.find((p) => p.magic === body.magic);
  if (existing) {
    send(res, 200, {
      duplicate: true,
      position: existing,
      note: "magic already open — retry recognised, nothing sent",
    });
    return;
  }

  if (state.nextOrderRetcode !== 10009) {
    send(res, 502, {
      retcode: state.nextOrderRetcode,
      retcodeComment: state.nextOrderComment,
      order: 0,
      deal: 0,
      volume: body.volume,
      price: 0,
      magic: body.magic,
      error: `order rejected: ${state.nextOrderRetcode} ${state.nextOrderComment}`,
    });
    return;
  }

  const position: GoldPosition = {
    ticket: Math.floor(Math.random() * 1_000_000) + 1,
    symbol: body.symbol,
    side: body.side,
    volume: body.volume,
    priceOpen: 2000,
    priceCurrent: 2000,
    sl: 0,
    tp: 0,
    profit: 0,
    swap: 0,
    magic: body.magic,
    comment: "",
    openedAt: Math.floor(Date.now() / 1000),
  };
  state.positions.push(position);

  send(res, 200, {
    duplicate: false,
    retcode: 10009,
    retcodeComment: state.nextOrderComment,
    order: position.ticket,
    deal: position.ticket,
    volume: body.volume,
    price: position.priceOpen,
    magic: body.magic,
  });
}

async function handleClose(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  state: FakeBridgeState,
): Promise<void> {
  const body = (await readJsonBody(req)) as { ticket?: number; magic?: number; volume?: number };
  const idx = state.positions.findIndex((p) =>
    body.ticket !== undefined ? p.ticket === body.ticket : p.magic === body.magic,
  );
  if (idx === -1) {
    send(res, 200, { closed: false, note: "no such open position — already flat" });
    return;
  }
  const [position] = state.positions.splice(idx, 1);
  send(res, 200, {
    closed: true,
    ticket: position.ticket,
    retcode: 10009,
    price: position.priceOpen,
    volume: body.volume ?? position.volume,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/gold/testing/fakeBridge.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gold/testing/fakeBridge.ts src/lib/gold/testing/fakeBridge.test.ts
git commit -m "test(gold): add in-process fake MT5 bridge test double"
```

---

### Task 3: Retcode bucket classifier

**Files:**
- Create: `src/lib/gold/retcodes.ts`
- Test: `src/lib/gold/retcodes.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no I/O).
- Produces: `RetcodeBucket` type, `classifyRetcode(retcode: number): RetcodeBucket` — consumed by Task 5 (`broker.ts`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/gold/retcodes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRetcode } from "./retcodes";

test("10004 Requote and 10021 No quotes are RetriableWithNewQuote", () => {
  assert.equal(classifyRetcode(10004), "RetriableWithNewQuote");
  assert.equal(classifyRetcode(10021), "RetriableWithNewQuote");
});

test("10014/10015/10016/10019 are TerminalRejection", () => {
  for (const code of [10014, 10015, 10016, 10019]) {
    assert.equal(classifyRetcode(code), "TerminalRejection");
  }
});

test("10018 Market closed and 10027 Auto-trading disabled are MarketCondition", () => {
  assert.equal(classifyRetcode(10018), "MarketCondition");
  assert.equal(classifyRetcode(10027), "MarketCondition");
});

test("an unknown retcode is Unclassified", () => {
  assert.equal(classifyRetcode(99999), "Unclassified");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/gold/retcodes.test.ts`
Expected: FAIL with a module-not-found error for `./retcodes`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/gold/retcodes.ts
export type RetcodeBucket = "RetriableWithNewQuote" | "TerminalRejection" | "MarketCondition" | "Unclassified";

const RETRIABLE_WITH_NEW_QUOTE = new Set([10004, 10021]);
const TERMINAL_REJECTION = new Set([10014, 10015, 10016, 10019]);
const MARKET_CONDITION = new Set([10018, 10027]);

export function classifyRetcode(retcode: number): RetcodeBucket {
  if (RETRIABLE_WITH_NEW_QUOTE.has(retcode)) return "RetriableWithNewQuote";
  if (TERMINAL_REJECTION.has(retcode)) return "TerminalRejection";
  if (MARKET_CONDITION.has(retcode)) return "MarketCondition";
  return "Unclassified";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/gold/retcodes.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gold/retcodes.ts src/lib/gold/retcodes.test.ts
git commit -m "feat(gold): add retcode bucket classifier"
```

---

### Task 4: Bridge health check

**Files:**
- Create: `src/lib/gold/health.ts`
- Test: `src/lib/gold/health.test.ts`

**Interfaces:**
- Consumes: `parseGoldHealthResponse` from Task 1 (`src/lib/gold/types.ts`); `startFakeBridge` from Task 2 (test only).
- Produces: `BridgeHealth` type, `checkBridgeHealth(timeoutMs?: number): Promise<BridgeHealth>` — consumed by Task 7 (`gold-desk.mts`) and Task 9 (`api/gold/status/route.ts`).

This is a standalone new file, deliberately not added to `src/lib/mt5.ts`, so that file stays untouched per the Global Constraints.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/gold/health.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/gold/health.test.ts`
Expected: FAIL with a module-not-found error for `./health`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/gold/health.ts
import { parseGoldHealthResponse } from "./types";

export interface BridgeHealth {
  reachable: boolean;
  connected?: boolean;
  error?: string;
}

export async function checkBridgeHealth(timeoutMs = 2000): Promise<BridgeHealth> {
  const secret = process.env.MT5_BRIDGE_SECRET;
  const baseUrl = process.env.MT5_BRIDGE_URL ?? "http://127.0.0.1:8787";
  if (!secret) {
    return { reachable: false, error: "mt5: missing MT5_BRIDGE_SECRET" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { "X-Bridge-Secret": secret },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { reachable: false, error: `bridge health check: upstream ${res.status}` };
    }
    const body = parseGoldHealthResponse(await res.json());
    return { reachable: true, connected: body.connected };
  } catch (err) {
    return { reachable: false, error: `bridge unreachable: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/gold/health.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gold/health.ts src/lib/gold/health.test.ts
git commit -m "feat(gold): add standalone bridge health check"
```

---

### Task 5: Broker — demo gate, boot reconciliation, order placement with IN_FLIGHT_UNKNOWN resolution

**Files:**
- Create: `src/lib/gold/broker.ts`
- Test: `src/lib/gold/broker.test.ts`

**Interfaces:**
- Consumes: `fetchMt5Account`, `fetchMt5Positions`, `sendMt5Order`, `closeMt5Position`, `isDemoAccount`, and the types `Mt5OrderRequest`, `Mt5OrderResult`, `Mt5Position`, `Mt5CloseResult` from `@/lib/mt5` (existing, unmodified — see `src/lib/mt5.ts:1-483` for exact signatures); `classifyRetcode`, `RetcodeBucket` from Task 3 (`src/lib/gold/retcodes.ts`); `startFakeBridge` from Task 2 (test only).
- Produces: `GoldOrderUnresolvedError`, `assertDemoAccount(): Promise<void>`, `reconcilePositions(symbol?: string): Promise<Mt5Position[]>`, `PlaceOrderOutcome`, `PlaceOrderOptions`, `placeOrder(req: Mt5OrderRequest, options?: PlaceOrderOptions): Promise<PlaceOrderOutcome>`, `closePosition(target: {ticket: number} | {magic: number}, volume?: number): Promise<Mt5CloseResult>` — consumed by Task 7 (`gold-desk.mts`), Task 8 (`gold-manual-order-test.mts`), and Task 9 (`api/gold/status/route.ts`).

`placeOrder` races `sendMt5Order` against an injectable `raceTimeoutMs` (default 15000, matching `mt5.ts`'s own `ORDER_TIMEOUT_MS`) rather than waiting on `mt5.ts`'s real internal timeout — tests pass a small value together with the fake bridge's `orderShouldHang: true` so the race resolves in milliseconds, deterministically, well before `mt5.ts`'s own 15s AbortController would ever fire.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/gold/broker.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/gold/broker.test.ts`
Expected: FAIL with a module-not-found error for `./broker`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/gold/broker.ts
import {
  fetchMt5Account,
  fetchMt5Positions,
  sendMt5Order,
  closeMt5Position,
  isDemoAccount,
  type Mt5OrderRequest,
  type Mt5OrderResult,
  type Mt5Position,
  type Mt5CloseResult,
} from "@/lib/mt5";
import { classifyRetcode, type RetcodeBucket } from "./retcodes";

export class GoldOrderUnresolvedError extends Error {
  constructor(public readonly magic: number) {
    super(`gold: order with magic ${magic} timed out and could not be resolved against open positions`);
    this.name = "GoldOrderUnresolvedError";
  }
}

export async function assertDemoAccount(): Promise<void> {
  const account = await fetchMt5Account();
  if (!isDemoAccount(account)) {
    throw new Error(`gold: refusing to trade a non-demo account (tradeMode=${account.tradeMode})`);
  }
}

export async function reconcilePositions(symbol?: string): Promise<Mt5Position[]> {
  return fetchMt5Positions(symbol);
}

export type PlaceOrderOutcome =
  | { status: "sent"; result: Mt5OrderResult }
  | { status: "not-sent"; reason: string; bucket?: RetcodeBucket };

export interface PlaceOrderOptions {
  raceTimeoutMs?: number;
  maxResolutionAttempts?: number;
  resolutionDelayMs?: number;
}

const ORDER_REJECTED_RE = /order rejected: (\d+) /;

export async function placeOrder(
  req: Mt5OrderRequest,
  options: PlaceOrderOptions = {},
): Promise<PlaceOrderOutcome> {
  await assertDemoAccount();

  const { raceTimeoutMs = 15_000, maxResolutionAttempts = 5, resolutionDelayMs = 1000 } = options;

  const timeoutPromise = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), raceTimeoutMs);
  });
  const orderPromise = sendMt5Order(req).then(
    (result): { outcome: "result"; result: Mt5OrderResult } => ({ outcome: "result", result }),
    (error: unknown): { outcome: "error"; error: unknown } => ({ outcome: "error", error }),
  );

  const race = await Promise.race([orderPromise, timeoutPromise]);

  if (race === "timeout") {
    return resolveInFlight(req.magic, maxResolutionAttempts, resolutionDelayMs);
  }

  if (race.outcome === "result") {
    return { status: "sent", result: race.result };
  }

  const message = race.error instanceof Error ? race.error.message : String(race.error);
  const match = ORDER_REJECTED_RE.exec(message);
  if (match) {
    return { status: "not-sent", reason: message, bucket: classifyRetcode(Number(match[1])) };
  }
  return { status: "not-sent", reason: message };
}

async function resolveInFlight(
  magic: number,
  maxAttempts: number,
  delayMs: number,
): Promise<PlaceOrderOutcome> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      const positions = await fetchMt5Positions();
      const match = positions.find((p) => p.magic === magic);
      if (match) {
        return {
          status: "sent",
          result: { duplicate: true, position: match, note: "resolved via boot reconciliation after timeout" },
        };
      }
    } catch {
      // fetchMt5Positions itself failed this attempt — retry rather than
      // collapsing to a guess about whether the order went through.
    }
  }
  throw new GoldOrderUnresolvedError(magic);
}

export async function closePosition(
  target: { ticket: number } | { magic: number },
  volume?: number,
): Promise<Mt5CloseResult> {
  await assertDemoAccount();
  return closeMt5Position(target, volume);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/gold/broker.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gold/broker.ts src/lib/gold/broker.test.ts
git commit -m "feat(gold): add broker with demo gate, reconciliation, and IN_FLIGHT_UNKNOWN resolver"
```

---

### Task 6: Market data — UTC normalization, gap detection/backfill, spread capture, staleness heartbeat

**Files:**
- Create: `src/lib/gold/marketData.ts`
- Test: `src/lib/gold/marketData.test.ts`

**Interfaces:**
- Consumes: `fetchMt5CandleRange` from `@/lib/mt5` (existing, unmodified); `startFakeBridge` from Task 2 (test only).
- Produces: `RawBar`, `GoldBar`, `BrokerOffsetSchedule`, `MarketClosureWindow`, `Gap`, `DEFAULT_EET_EEST_SCHEDULE`, `DEFAULT_WEEKLY_CLOSURE`, `toUtcBar(bar: RawBar, schedule?: BrokerOffsetSchedule): GoldBar`, `normalizeToUtc(bars: RawBar[], schedule?: BrokerOffsetSchedule): GoldBar[]`, `detectGaps(bars: RawBar[], expectedIntervalSeconds: number, nowBrokerTime: number, closure?: MarketClosureWindow): Gap[]`, `backfillGaps(symbol: string, timeframe: string, gaps: Gap[]): Promise<RawBar[]>`, `attachSpread(bars: RawBar[], ticks: {t: number; bid: number; ask: number}[]): RawBar[]`, `ReadState`, `computeReadState(lastTickBrokerTime: number, nowBrokerTime: number, thresholdSeconds?: number): ReadState`.

Gap detection and backfill operate entirely on `RawBar` (broker-local `brokerTime`, matching what `fetchMt5CandleRange`'s `from`/`to` expect directly) — UTC normalization via `toUtcBar`/`normalizeToUtc` is applied only as a final, separate step, so no UTC gap boundary is ever converted back into broker-local time to make a bridge call.

The DST schedule (`DEFAULT_EET_EEST_SCHEDULE`) and weekly closure window (`DEFAULT_WEEKLY_CLOSURE`) are best-effort defaults per the spec — both are flagged here and in the README (Task 8) as needing confirmation against the real broker's actual EET/EEST and session-close behavior during the manual runbook.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/gold/marketData.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/gold/marketData.test.ts`
Expected: FAIL with a module-not-found error for `./marketData`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/gold/marketData.ts
import { fetchMt5CandleRange } from "@/lib/mt5";

export interface RawBar {
  brokerTime: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  spreadAtClose?: number;
}

export interface GoldBar {
  utcTime: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  spreadAtClose?: number;
}

export interface BrokerOffsetSchedule {
  offsetMinutesAt(brokerTimeSec: number): number;
}

export interface MarketClosureWindow {
  isClosed(brokerTimeSec: number): boolean;
}

export interface Gap {
  fromExclusive: number;
  toExclusive: number;
  isWeekend: boolean;
}

// `brokerTimeSec` is read as a naive local timestamp throughout this file:
// the numeric value is interpreted with Date's UTC accessors as if it WERE
// UTC, matching how MT5 hands back broker-local wall-clock reads as epoch
// seconds. Both the DST schedule below and the weekly closure window use the
// same interpretation, so they stay internally consistent even though
// neither one is truly UTC. NEEDS CONFIRMATION against the real broker
// (see src/lib/gold/README.md).
function lastSundayOfMonthUtc(year: number, month0: number): number {
  const lastDayOfMonth = 0; // day 0 of month0+1 = last day of month0
  const dow = new Date(Date.UTC(year, month0 + 1, lastDayOfMonth)).getUTCDay();
  return Date.UTC(year, month0 + 1, lastDayOfMonth - dow) / 1000;
}

export const DEFAULT_EET_EEST_SCHEDULE: BrokerOffsetSchedule = {
  offsetMinutesAt(brokerTimeSec: number): number {
    const year = new Date(brokerTimeSec * 1000).getUTCFullYear();
    const dstStart = lastSundayOfMonthUtc(year, 2) + 3600; // last Sunday of March, 01:00
    const dstEnd = lastSundayOfMonthUtc(year, 9) + 3600; // last Sunday of October, 01:00
    const isDst = brokerTimeSec >= dstStart && brokerTimeSec < dstEnd;
    return isDst ? 180 : 120;
  },
};

export const DEFAULT_WEEKLY_CLOSURE: MarketClosureWindow = {
  isClosed(brokerTimeSec: number): boolean {
    const d = new Date(brokerTimeSec * 1000);
    const dow = d.getUTCDay();
    const hour = d.getUTCHours();
    if (dow === 6) return true;
    if (dow === 0 && hour < 21) return true;
    if (dow === 5 && hour >= 21) return true;
    return false;
  },
};

export function toUtcBar(bar: RawBar, schedule: BrokerOffsetSchedule = DEFAULT_EET_EEST_SCHEDULE): GoldBar {
  const offsetMinutes = schedule.offsetMinutesAt(bar.brokerTime);
  return {
    utcTime: bar.brokerTime - offsetMinutes * 60,
    o: bar.o,
    h: bar.h,
    l: bar.l,
    c: bar.c,
    v: bar.v,
    spreadAtClose: bar.spreadAtClose,
  };
}

export function normalizeToUtc(bars: RawBar[], schedule?: BrokerOffsetSchedule): GoldBar[] {
  return bars.map((bar) => toUtcBar(bar, schedule));
}

export function detectGaps(
  bars: RawBar[],
  expectedIntervalSeconds: number,
  nowBrokerTime: number,
  closure: MarketClosureWindow = DEFAULT_WEEKLY_CLOSURE,
): Gap[] {
  const sorted = [...bars].sort((a, b) => a.brokerTime - b.brokerTime);
  const gaps: Gap[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].brokerTime;
    const next = sorted[i].brokerTime;
    if (next - prev > expectedIntervalSeconds) {
      gaps.push({ fromExclusive: prev, toExclusive: next, isWeekend: isWeekendGap(prev, next, expectedIntervalSeconds, closure) });
    }
  }
  void nowBrokerTime; // reserved for a future trailing-gap check once storage exists; unused for now
  return gaps;
}

function isWeekendGap(
  fromExclusive: number,
  toExclusive: number,
  stepSeconds: number,
  closure: MarketClosureWindow,
): boolean {
  for (let t = fromExclusive + stepSeconds; t < toExclusive; t += stepSeconds) {
    if (!closure.isClosed(t)) return false;
  }
  return true;
}

export async function backfillGaps(symbol: string, timeframe: string, gaps: Gap[]): Promise<RawBar[]> {
  const filled: RawBar[] = [];
  for (const gap of gaps) {
    if (gap.isWeekend) continue;
    const { candles } = await fetchMt5CandleRange(symbol, timeframe, gap.fromExclusive, gap.toExclusive);
    for (const candle of candles) {
      if (candle.t > gap.fromExclusive && candle.t < gap.toExclusive) {
        filled.push({ brokerTime: candle.t, o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v });
      }
    }
  }
  return filled;
}

export function attachSpread(bars: RawBar[], ticks: { t: number; bid: number; ask: number }[]): RawBar[] {
  const sortedTicks = [...ticks].sort((a, b) => a.t - b.t);
  return bars.map((bar) => {
    const match = sortedTicks.find((tick) => tick.t >= bar.brokerTime);
    if (!match) return bar;
    return { ...bar, spreadAtClose: match.ask - match.bid };
  });
}

export type ReadState = "OK" | "DEGRADED";

export function computeReadState(lastTickBrokerTime: number, nowBrokerTime: number, thresholdSeconds = 7): ReadState {
  return nowBrokerTime - lastTickBrokerTime > thresholdSeconds ? "DEGRADED" : "OK";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/gold/marketData.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gold/marketData.ts src/lib/gold/marketData.test.ts
git commit -m "feat(gold): add UTC-normalized market data with gap backfill, spread capture, staleness heartbeat"
```

---

### Task 7: `npm run gold` entrypoint — config guard, healthcheck, boot reconciliation

**Files:**
- Create: `scripts/gold-desk.mts`
- Modify: `package.json` (add the `gold` script)
- Test: none — this file is a thin orchestration script over `health.ts` (Task 4) and `broker.ts` (Task 5), both already unit-tested; per spec §4 nothing that runs the real boot sequence against `bridge.py` can run in CI. It is exercised by the manual runbook in Task 8's README.

**Interfaces:**
- Consumes: `checkBridgeHealth` from Task 4 (`src/lib/gold/health.ts`); `reconcilePositions` from Task 5 (`src/lib/gold/broker.ts`).
- Produces: nothing importable — a CLI entrypoint invoked via `npm run gold`.

Scoped to exactly the spec's three steps — config guard, preflight healthcheck, boot reconciliation — then it logs ready and exits. No polling loop or bar-storage logic: no storage schema exists yet in scope, and inventing one here would violate "No Placeholders."

- [ ] **Step 1: Write the script**

```typescript
// scripts/gold-desk.mts
import "dotenv/config";
import { checkBridgeHealth } from "../src/lib/gold/health";
import { reconcilePositions } from "../src/lib/gold/broker";

async function main(): Promise<void> {
  const secret = process.env.MT5_BRIDGE_SECRET;
  if (!secret) {
    console.error("gold-desk: MT5_BRIDGE_SECRET is not set — refusing to start");
    process.exit(1);
  }
  if (process.env.MT5_BRIDGE_ALLOW_REAL === "1") {
    console.error(
      "gold-desk: MT5_BRIDGE_ALLOW_REAL=1 — this desk only runs against demo/contest accounts, refusing to start",
    );
    process.exit(1);
  }

  console.log("gold-desk: checking bridge health...");
  const health = await checkBridgeHealth();
  if (!health.reachable) {
    console.error(`gold-desk: bridge unreachable — ${health.error}`);
    process.exit(1);
  }
  if (!health.connected) {
    console.error("gold-desk: bridge is up but not connected to a terminal");
    process.exit(1);
  }
  console.log("gold-desk: bridge healthy and connected.");

  console.log("gold-desk: reconciling open positions...");
  const positions = await reconcilePositions();
  console.log(`gold-desk: ${positions.length} open position(s) on boot.`);
  for (const p of positions) {
    console.log(`  ${p.symbol} ${p.side} ${p.volume} @ ${p.priceOpen} (magic ${p.magic})`);
  }

  console.log("gold-desk: ready. No mechanism is wired to this desk yet — read-only pipeline only.");
}

main().catch((err) => {
  console.error("gold-desk: fatal error", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the `gold` script to package.json**

In `package.json`, in `"scripts"`, alongside the existing `"desk"` entry (`package.json:18`), add:

```json
"gold": "node --env-file=.env --import tsx scripts/gold-desk.mts"
```

- [ ] **Step 3: Verify it fails closed without a terminal**

Run: `npm run gold`
Expected: exits 1 with either "MT5_BRIDGE_SECRET is not set" (no `.env` configured yet) or "bridge unreachable" (no bridge process running) — never a silent success. This is the manual verification for this task; there is no automated test (see Files note above).

- [ ] **Step 4: Commit**

```bash
git add scripts/gold-desk.mts package.json
git commit -m "feat(gold): add npm run gold entrypoint with config guard and boot reconciliation"
```

---

### Task 8: Manual order-test CLI and verification runbook

**Files:**
- Create: `scripts/gold-manual-order-test.mts`
- Create: `src/lib/gold/README.md`
- Test: none — thin CLI orchestration over `broker.ts` (Task 5), already unit-tested. The manual runbook in the README is the verification for this task and for Task 7, per spec §4's hard constraint that nothing touching a real MT5 terminal can run in CI.

**Interfaces:**
- Consumes: `reconcilePositions`, `placeOrder`, `closePosition` from Task 5 (`src/lib/gold/broker.ts`); `magicForTrade` from `@/lib/mt5` (existing, unmodified).
- Produces: nothing importable — a CLI entrypoint. Per the Global Constraints, this is the ONLY caller of `broker.ts`'s order-placement function allowed in this phase.

- [ ] **Step 1: Write the script**

```typescript
// scripts/gold-manual-order-test.mts
import "dotenv/config";
import { reconcilePositions, placeOrder, closePosition } from "../src/lib/gold/broker";
import { magicForTrade } from "../src/lib/mt5";

const SYMBOL = process.env.GOLD_SYMBOL ?? "XAUUSD";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  if (command === "positions") {
    const positions = await reconcilePositions(SYMBOL);
    if (positions.length === 0) {
      console.log("no open positions");
      return;
    }
    for (const p of positions) {
      console.log(`${p.ticket} ${p.symbol} ${p.side} ${p.volume} @ ${p.priceOpen} magic=${p.magic} profit=${p.profit}`);
    }
    return;
  }

  if (command === "place") {
    const [side, volumeRaw, label] = args;
    if (side !== "buy" && side !== "sell") {
      console.error("usage: place <buy|sell> <volume> <label>");
      process.exit(1);
    }
    const volume = Number(volumeRaw);
    if (!Number.isFinite(volume) || volume <= 0) {
      console.error("volume must be a positive number");
      process.exit(1);
    }
    if (!label) {
      console.error("a label is required — it derives the idempotency magic");
      process.exit(1);
    }
    const magic = magicForTrade(label);
    const outcome = await placeOrder({ symbol: SYMBOL, side, volume, magic });
    console.log(JSON.stringify(outcome, null, 2));
    return;
  }

  if (command === "close") {
    const [magicRaw] = args;
    const magic = Number(magicRaw);
    if (!Number.isFinite(magic)) {
      console.error("usage: close <magic>");
      process.exit(1);
    }
    const result = await closePosition({ magic });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.error("usage: gold-manual-order-test.mts <positions|place|close> [args]");
  process.exit(1);
}

main().catch((err) => {
  console.error("gold-manual-order-test: fatal error", err);
  process.exit(1);
});
```

- [ ] **Step 2: Write the manual verification runbook**

```markdown
# src/lib/gold/README.md

# Gold MT5 pipeline — manual verification runbook

Everything in this module that talks to a real MT5 terminal (i.e. exercises
`mt5-bridge/bridge.py` itself) cannot run in CI — see spec
`docs/superpowers/specs/2026-09-16-gold-mt5-pipeline-design.md` §4. This
runbook is the verification for `scripts/gold-desk.mts` and
`scripts/gold-manual-order-test.mts`, both of which have no automated test.

Run all of the below against a **demo account only**. Do not set
`MT5_BRIDGE_ALLOW_REAL=1`.

## Prerequisites

1. Start the bridge: `python mt5-bridge/bridge.py` (needs
   `MT5_BRIDGE_SECRET` and, to allow the write path,
   `MT5_BRIDGE_ALLOW_TRADING=1`).
2. In NEXMIND's `.env`, set `MT5_BRIDGE_SECRET` to match.
3. `npm run gold` should report "ready" with the correct open-position count.

## Place-order + boot reconciliation

1. `npx tsx scripts/gold-manual-order-test.mts place buy 0.01 smoke-test-1`
2. Confirm the fill appears in the MT5 terminal's Trade tab.
3. `npx tsx scripts/gold-manual-order-test.mts positions` — confirm it lists
   the new position.
4. Restart the bridge process, then `npm run gold` again — confirm boot
   reconciliation still reports the position (proves reconciliation reads
   real state, not anything cached client-side).
5. `npx tsx scripts/gold-manual-order-test.mts close <magic>` — confirm the
   position closes in the terminal.

## Hard kill test (IN_FLIGHT_UNKNOWN resolver)

1. `npx tsx scripts/gold-manual-order-test.mts place buy 0.01 smoke-kill-1`
2. Immediately `kill -9` the bridge.py process, before the CLI prints a
   result.
3. Restart the bridge.
4. Confirm the CLI eventually prints either `{"status":"sent",...}` (if the
   order reached the broker before the kill) or throws
   `GoldOrderUnresolvedError` (if it did not) — never a silent hang, and
   never two positions opened for the same label.

## Terminal lag / desync test (DEGRADED staleness)

1. With the bridge running, disconnect the MT5 terminal's network or log it
   out of the account.
2. Call `checkBridgeHealth()` (e.g. via `npm run gold` or the optional
   `/api/gold/status` route) — confirm it reports `connected: false` rather
   than silently reusing the last-known state.
3. Reconnect and confirm it reports `connected: true` again.

## Known unconfirmed assumptions (see `src/lib/gold/marketData.ts`)

- `DEFAULT_EET_EEST_SCHEDULE`'s DST transition dates (last Sunday of
  March/October, 01:00) and offsets (+2h / +3h) are the textbook EET/EEST
  rule, not yet confirmed against this broker's actual server-time
  behavior.
- `DEFAULT_WEEKLY_CLOSURE`'s Friday-21:00-UTC / Sunday-21:00-UTC session
  boundary is a first approximation, not yet confirmed against this
  broker's actual weekend gap.

Confirm both against a real demo session before relying on gap
classification for anything beyond this pipeline's own tests.
```

- [ ] **Step 3: Commit**

```bash
git add scripts/gold-manual-order-test.mts src/lib/gold/README.md
git commit -m "feat(gold): add manual order-test CLI and verification runbook"
```

---

### Task 9 (optional): `GET /api/gold/status` — health + positions as JSON

**Files:**
- Create: `src/app/api/gold/status/route.ts`
- Test: `src/app/api/gold/status/route.test.ts`

**Interfaces:**
- Consumes: `checkBridgeHealth` from Task 4 (`src/lib/gold/health.ts`); `reconcilePositions` from Task 5 (`src/lib/gold/broker.ts`); `startFakeBridge` from Task 2 (test only).
- Produces: a Next.js route handler `GET` — no other module imports this file.

Per spec §5, `/gold/...` route/page scope is explicitly an implementation-plan decision, not fixed by the spec — this task builds only the minimal read-only status endpoint, no UI page, both to stay in scope and because `AGENTS.md` flags Next.js 16 as having breaking changes from training-data conventions.

- [ ] **Step 1: Verify the route-handler convention against the installed Next.js docs**

Before writing the handler, check `node_modules/next/dist/docs/` (per `AGENTS.md`) for the current App Router route-handler signature and any deprecation notices affecting `NextResponse.json`. The implementation below uses the standard App Router convention (`export async function GET()` returning `NextResponse.json(...)`), which this check should confirm is still current for 16.2.7.

- [ ] **Step 2: Write the failing test**

```typescript
// src/app/api/gold/status/route.test.ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --test src/app/api/gold/status/route.test.ts`
Expected: FAIL with a module-not-found error for `./route`.

- [ ] **Step 4: Write minimal implementation**

```typescript
// src/app/api/gold/status/route.ts
import { NextResponse } from "next/server";
import { checkBridgeHealth } from "@/lib/gold/health";
import { reconcilePositions } from "@/lib/gold/broker";

export async function GET() {
  const health = await checkBridgeHealth();
  if (!health.reachable || !health.connected) {
    return NextResponse.json({ health, positions: [] }, { status: 503 });
  }
  const positions = await reconcilePositions();
  return NextResponse.json({ health, positions });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test src/app/api/gold/status/route.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/gold/status/route.ts src/app/api/gold/status/route.test.ts
git commit -m "feat(gold): add optional GET /api/gold/status route"
```

---

## Self-Review

**Spec coverage:**
- §1 file tree — every file listed (`gold/types.ts`, `gold/retcodes.ts`, `gold/marketData.ts`, `gold/broker.ts`, `scripts/gold-desk.mts`) has a task; `gold/testing/fakeBridge.ts` and `gold/health.ts` and the optional status route were named explicitly in the spec's own reasoning and are covered by Tasks 2, 4, 9.
- §1a boundary decisions — no shared runtime state with the stocks desk (Task 7 is its own script, never touches `dev.mts`/`session.mts`); config guard scoped to `MT5_BRIDGE_SECRET` + `MT5_BRIDGE_ALLOW_REAL` only (Task 7 Step 1); shared Zod contract (Task 1); explicit `/health` dependency check at boot (Task 7 consumes Task 4).
- §2 read path — UTC normalization, gap detection (weekend vs. midweek), spread capture, staleness heartbeat all in Task 6.
- §2 write path — boot reconciliation (Task 5 `reconcilePositions`, wired into Task 7); manual-harness-only order placement (Task 8); `IN_FLIGHT_UNKNOWN` resolution (Task 5 `resolveInFlight`).
- §3 error handling — two independent demo gates (bridge.py's own, unmodified, plus Task 5's `assertDemoAccount`); no `ALLOW_LIVE` flag anywhere; fail-closed `DEGRADED`/unreachable reporting (Task 4, Task 6 `computeReadState`); three retcode buckets exactly as specified (Task 3); no double-fill (timeout always routes through `resolveInFlight`, never a bare retry).
- §4 testing — fake-bridge-backed unit tests for `marketData.ts`, `broker.ts`, `retcodes.ts` (Tasks 3, 5, 6); manual runbook covering hard-kill and terminal-lag tests (Task 8); DST and gap-type fixtures in Task 6's tests.
- §5 scope — no mechanism/signal logic anywhere; `mt5.ts`/`bridge.py` untouched (verified: no task modifies either file); `/gold/...` scope resolved as a single optional minimal status route (Task 9), no UI page.
- §6 open question (what "passed review" means) — correctly left unaddressed; nothing in this plan gates on it.

**Placeholder scan:** no "TBD"/"TODO"/"similar to Task N" found. Task 7 and Task 8 explicitly state "Test: none" with a concrete justification (spec §4's CI constraint) rather than silently omitting it.

**Type/signature consistency:** `Mt5OrderRequest`, `Mt5OrderResult`, `Mt5Position`, `Mt5CloseResult`, `isDemoAccount`, `fetchMt5Positions`, `fetchMt5Account`, `sendMt5Order`, `closeMt5Position`, `fetchMt5CandleRange`, `magicForTrade` are used identically across Tasks 5, 6, 7, 8, 9, matching `src/lib/mt5.ts`'s verbatim signatures. `PlaceOrderOutcome`/`GoldOrderUnresolvedError` (Task 5) are consumed unchanged by Tasks 7/8/9. `RetcodeBucket`/`classifyRetcode` (Task 3) are consumed unchanged by Task 5. `RawBar`/`Gap` (Task 6) are self-contained and not consumed elsewhere. `checkBridgeHealth`/`BridgeHealth` (Task 4) are consumed unchanged by Tasks 7 and 9.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-16-gold-mt5-pipeline.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
