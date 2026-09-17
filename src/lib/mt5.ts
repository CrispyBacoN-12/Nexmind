// MT5 bridge market-data provider — talks to the local Python bridge
// (mt5-bridge/bridge.py) that proxies an already-running MetaTrader 5
// terminal over IPC. Only reachable from the same machine as the terminal,
// so this throws fast (short timeout) rather than hanging the scanner when
// the bridge isn't running or NEXMIND is deployed elsewhere.
//
// The read path is always available. The write path (sendMt5Order,
// closeMt5Position) reaches endpoints the bridge only serves when it was
// started with MT5_BRIDGE_ALLOW_TRADING=1, and which refuse a non-demo
// account unless it was also started with MT5_BRIDGE_ALLOW_REAL=1 — so a
// caller that reaches for them by mistake gets a 403, not a filled order.

import type { Candle } from "./indicators";
import type { CandleResponse, Range, Interval } from "./yahoo";

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:8787";
const FETCH_TIMEOUT_MS = 1500;
const TICKS_TIMEOUT_MS = 4000; // tick ranges can return thousands of rows
// A decade of H1 is ~60k bars over IPC and then JSON, and the first request for
// a symbol the terminal has not cached also waits on the server download the
// bridge retries through (HISTORY_DOWNLOAD_* there). Both are one-off costs of
// building a cache, not scan-tick latency.
const HISTORY_TIMEOUT_MS = 180_000;

/**
 * Shared GET against the bridge: attaches the shared secret, times out fast,
 * and normalizes errors so every endpoint fails the same way for callers
 * that want to fall back to another provider.
 */
async function bridgeFetch(path: string, params: URLSearchParams, timeoutMs = FETCH_TIMEOUT_MS): Promise<unknown> {
  const secret = process.env.MT5_BRIDGE_SECRET;
  if (!secret) throw new Error("mt5: missing MT5_BRIDGE_SECRET");
  const base = process.env.MT5_BRIDGE_URL || DEFAULT_BRIDGE_URL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${base}${path}?${params}`, {
      headers: { "X-Bridge-Secret": secret },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (e) {
    throw new Error(`mt5: bridge unreachable (${e instanceof Error ? e.message : e})`);
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`mt5: upstream ${res.status} ${(body as { error?: string }).error ?? ""}`.trim());
  }
  return res.json();
}

/** Map our Interval to an MT5 bridge timeframe string (see bridge.py TIMEFRAMES). */
export function intervalToMt5Timeframe(interval: Interval): string {
  switch (interval) {
    case "1m": return "M1";
    case "5m": return "M5";
    case "15m": return "M15";
    case "30m": return "M30";
    case "60m": return "H1";
    case "1h": return "H1";
    case "1d": return "D1";
    case "1wk": return "W1";
    default: {
      const _exhaustive: never = interval;
      throw new Error(`mt5: unsupported interval ${_exhaustive}`);
    }
  }
}

/** Bar count to request for a Range at a given Interval, capped at the bridge's MAX_COUNT (5000). */
export function rangeToBarCount(range: Range, interval: Interval): number {
  const days: Record<Range, number> = {
    "1d": 1, "5d": 5, "1mo": 31, "3mo": 93, "6mo": 186,
    "1y": 366, "2y": 731, "5y": 1827, "max": 7305,
  };
  const barsPerDay: Record<Interval, number> = {
    "1m": 1440, "5m": 288, "15m": 96, "30m": 48, "60m": 24, "1h": 24, "1d": 1, "1wk": 1 / 7,
  };
  return Math.min(5000, Math.max(1, Math.ceil(days[range] * barsPerDay[interval])));
}

interface Mt5Candle { t: number; o: number; h: number; l: number; c: number; v: number }

/**
 * Fetch candles from the local MT5 bridge. Throws when no secret is
 * configured, the bridge is unreachable/times out, or the symbol has no
 * rates (not in the terminal's Market Watch) — callers fall back to the
 * next provider.
 */
export async function fetchMt5Candles(
  symbol: string,
  range: Range = "1mo",
  interval: Interval = "1h",
): Promise<CandleResponse> {
  const params = new URLSearchParams({
    symbol,
    timeframe: intervalToMt5Timeframe(interval),
    count: String(rangeToBarCount(range, interval)),
  });
  const json = (await bridgeFetch("/candles", params)) as { symbol?: string; candles?: Mt5Candle[] };
  const raw = json.candles ?? [];
  if (raw.length === 0) throw new Error(`mt5: no candles for ${symbol}`);

  const candles: Candle[] = raw.map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }));
  return {
    symbol: json.symbol ?? symbol,
    range,
    interval,
    price: candles.at(-1)?.c,
    candles,
  };
}

/**
 * Fetch an explicit date range of bars, for building a history cache.
 *
 * Separate from fetchMt5Candles rather than a parameter on it, because the two
 * ask genuinely different questions. That one asks for the last N bars, which is
 * right for a scan tick and wrong for a cache: a count measured back from now
 * names a different window every day, so the same call never reproduces the same
 * series twice. This one names the window.
 *
 * `truncated` means the server had more bars in the range than one page holds.
 * It is not a warning to log and move past — the caller must resume from the
 * last timestamp it received, or the cache silently loses its middle.
 */
export async function fetchMt5CandleRange(
  symbol: string,
  timeframe: string,
  fromSec: number,
  toSec: number,
): Promise<{ candles: Candle[]; truncated: boolean }> {
  const params = new URLSearchParams({
    symbol,
    timeframe,
    from: String(Math.floor(fromSec)),
    to: String(Math.floor(toSec)),
  });
  const json = (await bridgeFetch("/candles", params, HISTORY_TIMEOUT_MS)) as {
    candles?: Mt5Candle[]; truncated?: boolean;
  };
  return {
    candles: (json.candles ?? []).map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v })),
    truncated: Boolean(json.truncated),
  };
}

export interface Mt5SymbolInfo {
  name: string;
  description: string;
  digits: number;
  point: number;
  spread: number;
  tradeContractSize: number;
  volumeMin: number;
  volumeMax: number;
  volumeStep: number;
  currencyBase: string;
  currencyProfit: string;
  path: string;
  /** Overnight financing, per lot per night, in the units swapMode names. */
  swapLong: number;
  swapShort: number;
  swapMode: number;
  /** Weekday (1 = Monday .. 5 = Friday) charged three nights instead of one. */
  swapRollover3Days: number;
  tradeTickValue: number;
  tradeTickSize: number;
  /**
   * Minimum distance, in points, a stop or limit may sit from the current
   * price. A rule whose stop falls inside this cannot be placed at all, so it
   * bounds which strategies are tradeable here — read it before declaring folds,
   * not at the first live order. 0 means the broker sets no fixed floor (it may
   * still widen dynamically).
   */
  tradeStopsLevel: number;
  /** Points around the price where modify/close is refused outright. */
  tradeFreezeLevel: number;
  /** Initial margin per lot, 0 when the broker leaves it to the leverage rule. */
  marginInitial: number;
}

/**
 * Search the terminal's full symbol universe for a substring match (e.g.
 * "XAU" -> XAUUSD, XAUUSDm, XAUEUR, ...). Use this to resolve a broker's
 * actual ticker/suffix instead of guessing, and to read real contract specs
 * (point/digits/contract size/volume steps) instead of assuming generic ones.
 */
export async function fetchMt5Symbols(search: string): Promise<Mt5SymbolInfo[]> {
  const params = new URLSearchParams({ search });
  const json = (await bridgeFetch("/symbols", params)) as {
    symbols?: Array<{
      name: string; description: string; digits: number; point: number; spread: number;
      trade_contract_size: number; volume_min: number; volume_max: number; volume_step: number;
      currency_base: string; currency_profit: string; path: string;
      swap_long: number; swap_short: number; swap_mode: number; swap_rollover3days: number;
      trade_tick_value: number; trade_tick_size: number;
      trade_stops_level: number; trade_freeze_level: number; margin_initial: number;
    }>;
  };
  return (json.symbols ?? []).map((s) => ({
    name: s.name, description: s.description, digits: s.digits, point: s.point, spread: s.spread,
    tradeContractSize: s.trade_contract_size, volumeMin: s.volume_min, volumeMax: s.volume_max,
    volumeStep: s.volume_step, currencyBase: s.currency_base, currencyProfit: s.currency_profit, path: s.path,
    swapLong: s.swap_long, swapShort: s.swap_short, swapMode: s.swap_mode,
    swapRollover3Days: s.swap_rollover3days,
    tradeTickValue: s.trade_tick_value, tradeTickSize: s.trade_tick_size,
    tradeStopsLevel: s.trade_stops_level, tradeFreezeLevel: s.trade_freeze_level,
    marginInitial: s.margin_initial,
  }));
}

export interface Mt5AccountInfo {
  balance: number;
  equity: number;
  profit: number;
  credit: number;
  margin: number;
  marginFree: number;
  marginLevel: number;
  leverage: number;
  currency: string;
  tradeAllowed: boolean;
  /**
   * "demo" | "contest" | "real" — the guard the execution path checks before it
   * is allowed to send anything. Anything else is an unrecognised code from the
   * terminal and must be treated as real: an unknown account type is not a safe
   * one.
   */
  tradeMode: string;
  /**
   * The broker server this account lives on (e.g. "FPMarkets-Demo"). A spread
   * profile is a measurement OF a venue and is meaningless unlabelled — Phase 0
   * measured 17 years of gold off MetaQuotes-Demo while believing it was a
   * broker's own feed. The login is deliberately not carried: it identifies the
   * holder, the server identifies the venue, and only the second is needed.
   */
  server: string;
}

/** Is this an account NEXMIND may send orders to without an explicit override? */
export function isDemoAccount(account: Mt5AccountInfo): boolean {
  return account.tradeMode === "demo" || account.tradeMode === "contest";
}

/**
 * Read the connected account's balance/equity/margin/leverage. NEXMIND never
 * trades this account (paper mode) — this is a reference for sizing paper
 * positions against real leverage/margin terms, not a live-trading hook.
 */
export async function fetchMt5Account(): Promise<Mt5AccountInfo> {
  const json = (await bridgeFetch("/account", new URLSearchParams())) as {
    balance: number; equity: number; profit: number; credit: number; margin: number;
    margin_free: number; margin_level: number; leverage: number; currency: string; trade_allowed: boolean;
    trade_mode?: string; server?: string;
  };
  return {
    balance: json.balance, equity: json.equity, profit: json.profit, credit: json.credit,
    margin: json.margin, marginFree: json.margin_free, marginLevel: json.margin_level,
    leverage: json.leverage, currency: json.currency, tradeAllowed: json.trade_allowed,
    // A bridge too old to report trade_mode reads as "unknown", which
    // isDemoAccount refuses — the same fail-closed direction as everywhere else.
    tradeMode: json.trade_mode ?? "unknown",
    server: json.server ?? "unknown",
  };
}

export interface Mt5MarginResult {
  symbol: string;
  side: "buy" | "sell";
  volume: number;
  price: number;
  margin: number;
}

/**
 * Ask the broker's own margin engine what a trade would cost — no order is
 * placed. `price` defaults to the current ask (buy) / bid (sell) if omitted.
 * Use this for realistic position sizing instead of an assumed formula.
 */
export async function fetchMt5Margin(
  symbol: string,
  side: "buy" | "sell",
  volume: number,
  price?: number,
): Promise<Mt5MarginResult> {
  const params = new URLSearchParams({ symbol, side, volume: String(volume) });
  if (price != null) params.set("price", String(price));
  const json = (await bridgeFetch("/margin", params)) as Mt5MarginResult;
  return json;
}

export interface Mt5Tick {
  t: number; // unix seconds, fractional (sub-second precision)
  bid: number;
  ask: number;
  last: number;
  volume: number;
}

/**
 * Fetch raw bid/ask ticks for the last `minutes` (1-120, default 5) — for
 * realistic spread/slippage modeling that 1m candles can't capture. Capped
 * at the bridge's MAX_TICKS (20000); `truncated` on the response says
 * whether the window was cut. Uses a longer timeout since gold/majors can
 * produce thousands of ticks per minute in a volatile session.
 */
export async function fetchMt5Ticks(symbol: string, minutes = 5): Promise<{ ticks: Mt5Tick[]; truncated: boolean }> {
  const params = new URLSearchParams({ symbol, minutes: String(minutes) });
  const json = (await bridgeFetch("/ticks", params, TICKS_TIMEOUT_MS)) as {
    ticks?: Mt5Tick[]; truncated?: boolean;
  };
  return { ticks: json.ticks ?? [], truncated: Boolean(json.truncated) };
}

// --- write path -----------------------------------------------------------
// Everything below reaches an endpoint that can move money. None of it is
// called by the scanner or the research path.

/**
 * order_send goes to the broker and back, and a rejected order can take
 * seconds to say so. Long enough that a slow fill is not reported as a
 * timeout, because a timed-out order is the one case where NEXMIND does not
 * know whether it has a position — which is what the magic key exists to
 * resolve on the retry.
 */
const ORDER_TIMEOUT_MS = 15_000;

async function bridgePost(path: string, body: unknown, timeoutMs = ORDER_TIMEOUT_MS): Promise<unknown> {
  const secret = process.env.MT5_BRIDGE_SECRET;
  if (!secret) throw new Error("mt5: missing MT5_BRIDGE_SECRET");
  const base = process.env.MT5_BRIDGE_URL || DEFAULT_BRIDGE_URL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "X-Bridge-Secret": secret, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (e) {
    throw new Error(`mt5: bridge unreachable (${e instanceof Error ? e.message : e})`);
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(`mt5: upstream ${res.status} ${(json as { error?: string }).error ?? ""}`.trim());
  }
  return res.json();
}

/**
 * The idempotency key for one trade, derived here rather than by the bridge.
 *
 * The bridge deliberately refuses to invent a magic: it has no memory across a
 * restart, so a magic it made up could not recognise an order it had already
 * sent — and a restart is exactly when a retry happens. Deriving it from the
 * Trade row's own id makes the same trade produce the same key from any
 * process, at any time, with nothing persisted in between.
 *
 * FNV-1a folded into 31 bits, so the value survives JSON as a safe integer and
 * stays positive. Collisions are possible in principle (~2^31 space) but only
 * matter between positions open at the same moment, and the bridge answers a
 * collision with 409 rather than guessing — a refused order, not a wrong one.
 */
export function magicForTrade(tradeId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < tradeId.length; i++) {
    h ^= tradeId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h & 0x7fffffff) || 1; // 0 means "no magic" to MT5, so never emit it
}

export interface Mt5Position {
  ticket: number;
  symbol: string;
  side: "buy" | "sell";
  volume: number;
  priceOpen: number;
  priceCurrent: number;
  sl: number;
  tp: number;
  profit: number;
  swap: number;
  magic: number;
  comment: string;
  /** Unix seconds the position opened. */
  openedAt: number;
}

/**
 * What the broker says is open right now — the reconciliation read.
 *
 * A CFD position can be closed by the broker (stop-out, margin call) without
 * NEXMIND being told, so the DB's idea of what is open is a belief and this is
 * the fact. Served outside the bridge's trading gate on purpose: a bridge that
 * is not allowed to trade must still be able to report what it holds.
 */
export async function fetchMt5Positions(symbol?: string): Promise<Mt5Position[]> {
  const params = new URLSearchParams();
  if (symbol) params.set("symbol", symbol);
  const json = (await bridgeFetch("/positions", params)) as { positions?: Mt5Position[] };
  return json.positions ?? [];
}

/**
 * Either the order was placed, or the magic was already open and nothing was
 * sent. Modelled as a union so a caller cannot read `price` off a retry that
 * placed nothing — the failure idempotency is there to prevent is booking the
 * same trade twice, and a shape that hides which case happened invites it.
 */
export type Mt5OrderResult =
  | { duplicate: true; position: Mt5Position; note: string }
  | {
      duplicate: false;
      retcode: number;
      retcodeComment: string;
      order: number;
      deal: number;
      volume: number;
      price: number;
      magic: number;
    };

export interface Mt5OrderRequest {
  symbol: string;
  side: "buy" | "sell";
  /** Lots. The bridge enforces its own ceiling; sizing is the Iron Rules' job. */
  volume: number;
  /** Idempotency key — pass magicForTrade(trade.id), never a fresh number. */
  magic: number;
  sl?: number;
  tp?: number;
  comment?: string;
  /** Max slippage in points. Bridge default is 20. */
  deviation?: number;
}

/**
 * Send a market order. Throws on anything that is not a fill or a recognised
 * retry — including a broker refusal, which arrives as a non-DONE retcode and
 * is raised rather than returned, so a caller checking only for an exception
 * cannot book a position the broker never opened.
 */
export async function sendMt5Order(req: Mt5OrderRequest): Promise<Mt5OrderResult> {
  return (await bridgePost("/order", req)) as Mt5OrderResult;
}

export interface Mt5CloseResult {
  closed: boolean;
  ticket?: number;
  retcode?: number;
  price?: number;
  volume?: number;
  /** Set when there was nothing to close. */
  note?: string;
}

/**
 * Close a position by ticket, or by the magic that opened it.
 *
 * `closed: false` is a success, not an error: it means the position is already
 * gone, which is the state the caller asked for and the normal outcome after a
 * broker-side stop-out. Treating it as a failure would make reconciliation
 * retry a close forever.
 */
export async function closeMt5Position(
  target: { ticket: number } | { magic: number },
  volume?: number,
): Promise<Mt5CloseResult> {
  return (await bridgePost("/close", { ...target, ...(volume != null ? { volume } : {}) })) as Mt5CloseResult;
}
