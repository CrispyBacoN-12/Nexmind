// MT5 bridge market-data provider — talks to the local Python bridge
// (mt5-bridge/bridge.py) that proxies an already-running MetaTrader 5
// terminal over IPC. Only reachable from the same machine as the terminal,
// so this throws fast (short timeout) rather than hanging the scanner when
// the bridge isn't running or NEXMIND is deployed elsewhere. Data-only:
// the bridge itself never places/closes orders.

import type { Candle } from "./indicators";
import type { CandleResponse, Range, Interval } from "./yahoo";

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:8787";
const FETCH_TIMEOUT_MS = 1500;
const TICKS_TIMEOUT_MS = 4000; // tick ranges can return thousands of rows

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
    "5m": 288, "15m": 96, "30m": 48, "60m": 24, "1h": 24, "1d": 1, "1wk": 1 / 7,
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
    }>;
  };
  return (json.symbols ?? []).map((s) => ({
    name: s.name, description: s.description, digits: s.digits, point: s.point, spread: s.spread,
    tradeContractSize: s.trade_contract_size, volumeMin: s.volume_min, volumeMax: s.volume_max,
    volumeStep: s.volume_step, currencyBase: s.currency_base, currencyProfit: s.currency_profit, path: s.path,
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
  };
  return {
    balance: json.balance, equity: json.equity, profit: json.profit, credit: json.credit,
    margin: json.margin, marginFree: json.margin_free, marginLevel: json.margin_level,
    leverage: json.leverage, currency: json.currency, tradeAllowed: json.trade_allowed,
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
