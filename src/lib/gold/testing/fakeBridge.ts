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
