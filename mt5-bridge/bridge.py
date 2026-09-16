# Local HTTP bridge exposing an already-running MT5 terminal's price data to
# NEXMIND (which fetches from it as just another market-data provider). Runs
# on the same machine as the terminal — the MetaTrader5 package talks to it
# over IPC, which only works locally.
#
# Read paths are always on. The write paths (/order, /close) are off unless the
# bridge was started with MT5_BRIDGE_ALLOW_TRADING=1, and refuse a live-money
# account unless it was ALSO started with MT5_BRIDGE_ALLOW_REAL=1. Two switches
# rather than one because they are different mistakes: the first is "this
# bridge was never meant to trade", the second is "this bridge was meant to
# trade, but not that account".
#
# Run: python bridge.py
# Requires: pip install MetaTrader5
# Env: MT5_BRIDGE_SECRET (shared secret, required), MT5_BRIDGE_PORT (default 8787),
#      MT5_TERMINAL_PATH (terminal64.exe to attach to; omit to auto-detect),
#      MT5_BRIDGE_ALLOW_TRADING=1 (enable /order and /close; default off),
#      MT5_BRIDGE_ALLOW_REAL=1 (allow a non-demo account; default off),
#      MT5_BRIDGE_MAX_VOLUME (per-order lot ceiling, default 1.0)

import json
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import MetaTrader5 as mt5

SECRET = os.environ.get("MT5_BRIDGE_SECRET")
if not SECRET:
    raise SystemExit("Set MT5_BRIDGE_SECRET before starting the bridge.")
PORT = int(os.environ.get("MT5_BRIDGE_PORT", "8787"))

TIMEFRAMES = {
    "M1": mt5.TIMEFRAME_M1, "M5": mt5.TIMEFRAME_M5, "M15": mt5.TIMEFRAME_M15,
    "M30": mt5.TIMEFRAME_M30, "H1": mt5.TIMEFRAME_H1, "H4": mt5.TIMEFRAME_H4,
    "D1": mt5.TIMEFRAME_D1, "W1": mt5.TIMEFRAME_W1,
}
# Nominal bar length, used to size a history chunk in calendar time.
TIMEFRAME_SECONDS = {
    "M1": 60, "M5": 300, "M15": 900, "M30": 1800,
    "H1": 3600, "H4": 14400, "D1": 86400, "W1": 604800,
}
ORDER_SIDES = {"buy": mt5.ORDER_TYPE_BUY, "sell": mt5.ORDER_TYPE_SELL}
ACCOUNT_TRADE_MODES = {
    mt5.ACCOUNT_TRADE_MODE_DEMO: "demo",
    mt5.ACCOUNT_TRADE_MODE_CONTEST: "contest",
    mt5.ACCOUNT_TRADE_MODE_REAL: "real",
}
MAX_COUNT = 5000
MAX_SYMBOLS = 200
MAX_TICKS = 20000

# Ceiling on one /candles?from=&to= page. Higher than MAX_COUNT because this
# path exists to walk decades of intraday history, not to answer a scan tick:
# H1 gold since 2004 is ~125k bars, so a 5,000 cap would need 25 round trips.
# A page that hits this returns the OLDEST bars and says truncated=true, so the
# caller resumes from the last timestamp it got rather than silently losing the
# middle of the series — the failure mode that made every Webull range label a
# lie (STATE.md §4a).
MAX_RANGE_COUNT = 50000

# How long to let the terminal pull history from the server before an empty
# answer is believed. Deep intraday history is tens of megabytes and arrives in
# chunks, so the first few requests can legitimately return nothing.
HISTORY_DOWNLOAD_RETRIES = 12
HISTORY_DOWNLOAD_WAIT_S = 2.5

# Bars to aim for in ONE copy_rates_range call. The terminal refuses a range
# whose bar count is too large with (-2, 'Terminal: Invalid params') — measured
# 2026-09-08: XAUUSD H4 over 1990-2026 (34k bars) answers, H1 over the same span
# (~137k) and M15 (~550k) both refuse, while the identical call over a shorter
# window succeeds. So the ceiling is on the REQUEST, and a cap applied to the
# response cannot help: the response never arrives. The range is walked in
# chunks of this many bars' worth of calendar time instead.
CHUNK_BARS = 20000

# --- write path (Phase 4) ----------------------------------------------
# Both switches are set by whoever STARTS the bridge, not by whoever calls it:
# the shared secret says who is asking, these say what this process was ever
# launched to do. A caller holding the secret still cannot turn trading on.
ALLOW_TRADING = os.environ.get("MT5_BRIDGE_ALLOW_TRADING") == "1"
# Phase 4 of the plan runs entirely on demo. That is worth enforcing where the
# IPC handle lives and not only in the NEXMIND process, because the caller is a
# script that can be replaced and this is the last thing before order_send.
ALLOW_REAL = os.environ.get("MT5_BRIDGE_ALLOW_REAL") == "1"
# A fat-finger ceiling, not a risk rule — position sizing belongs to the Iron
# Rules. This only bounds how bad a single malformed request can be.
MAX_ORDER_VOLUME = float(os.environ.get("MT5_BRIDGE_MAX_VOLUME", "1.0"))
DEFAULT_DEVIATION = 20
TRADE_RETCODE_DONE = getattr(mt5, "TRADE_RETCODE_DONE", 10009)

# One in-flight order per magic. positions_get() is checked before sending, but
# two identical requests arriving together would both pass that check and open
# two positions. ThreadingHTTPServer makes that an ordinary sequence rather
# than a theoretical one, and a duplicate position is the exact failure the
# idempotency key exists to prevent.
_ORDER_LOCKS = {}
_ORDER_LOCKS_GUARD = threading.Lock()


def order_lock(magic):
    with _ORDER_LOCKS_GUARD:
        return _ORDER_LOCKS.setdefault(magic, threading.Lock())


def position_payload(p):
    return {
        "ticket": p.ticket, "symbol": p.symbol,
        "side": "buy" if p.type == mt5.POSITION_TYPE_BUY else "sell",
        "volume": p.volume, "priceOpen": p.price_open, "priceCurrent": p.price_current,
        "sl": p.sl, "tp": p.tp, "profit": p.profit, "swap": p.swap,
        "magic": p.magic, "comment": p.comment, "openedAt": p.time,
    }


def open_positions(symbol=None):
    """Open positions, or None when the terminal could not answer.

    None and [] must not be conflated. positions_get() returns None both when
    the account is flat and when the call failed, and here the two mean
    opposite things: flat lets an order through, a failed read must not. The
    idempotency check reads this, so treating an error as "nothing is open"
    would place the duplicate that check exists to prevent.
    """
    found = mt5.positions_get(symbol=symbol) if symbol else mt5.positions_get()
    if found is not None:
        return list(found)
    return [] if mt5.last_error()[0] == getattr(mt5, "RES_S_OK", 1) else None


def find_by_magic(magic):
    found = open_positions()
    return None if found is None else [p for p in found if p.magic == magic]


def pick_filling(symbol):
    """A filling mode this broker actually accepts for this symbol.

    order_send refuses with "Unsupported filling mode" when handed one the
    symbol does not allow, and brokers disagree — FOK on one, IOC on the next.
    symbol_info.filling_mode is a bitmask of what is permitted, so read it
    rather than hardcoding whichever mode happened to work on the first demo.
    """
    info = mt5.symbol_info(symbol)
    allowed = getattr(info, "filling_mode", 0) if info else 0
    if allowed & 1:  # SYMBOL_FILLING_FOK
        return mt5.ORDER_FILLING_FOK
    if allowed & 2:  # SYMBOL_FILLING_IOC
        return mt5.ORDER_FILLING_IOC
    return mt5.ORDER_FILLING_RETURN


def copy_rates_chunked(symbol, timeframe, tf, date_from, date_to):
    """Walk [date_from, date_to] in bounded chunks, oldest first.

    Returns (rows, truncated). `truncated` means the window held more than
    MAX_RANGE_COUNT bars and the answer stops early at a real bar boundary — the
    caller resumes from the last timestamp. It never means bars were dropped
    from the middle, which is the distinction that makes the flag worth having.
    """
    step = TIMEFRAME_SECONDS[timeframe] * CHUNK_BARS
    rows = []
    seen_until = None  # last timestamp already collected, so chunk overlap dedupes
    cursor = int(date_from.timestamp())
    end = int(date_to.timestamp())
    waited = False

    while cursor < end and len(rows) < MAX_RANGE_COUNT:
        chunk_to = min(cursor + step, end)
        rates = mt5.copy_rates_range(
            symbol, tf,
            datetime.fromtimestamp(cursor, timezone.utc),
            datetime.fromtimestamp(chunk_to, timezone.utc),
        )
        # A symbol selected a moment ago has no history cached locally yet; the
        # terminal starts pulling it from the server on first request and answers
        # empty until that lands. Empty and "this broker has no history here"
        # look identical, so wait through it once — but only once per request,
        # because most empty chunks are genuinely empty (gold before this
        # broker's archive begins) and waiting on each would take hours.
        if (rates is None or len(rates) == 0) and not waited:
            waited = True
            for _ in range(HISTORY_DOWNLOAD_RETRIES):
                time.sleep(HISTORY_DOWNLOAD_WAIT_S)
                rates = mt5.copy_rates_range(
                    symbol, tf,
                    datetime.fromtimestamp(cursor, timezone.utc),
                    datetime.fromtimestamp(chunk_to, timezone.utc),
                )
                if rates is not None and len(rates):
                    break
        if rates is not None and len(rates):
            for r in rates:
                t = int(r["time"])
                # Filter to the window actually asked for. The terminal does not
                # answer an out-of-archive range with nothing — it answers with
                # the single nearest bar it does hold (measured 2026-09-08: H1
                # for 2004-06..2004-09 returns one bar stamped 2009-08-06, the
                # first bar of the archive). Unfiltered, that bar is appended
                # from the first chunk of a 1990-start walk, seen_until jumps
                # forward to it, and every genuine bar before it is then dropped
                # as already-seen. It happens to be harmless only while the
                # phantom IS the archive's first bar.
                if t < cursor or t > chunk_to:
                    continue
                if seen_until is None or t > seen_until:
                    rows.append(r)
                    seen_until = t
        cursor = chunk_to

    # Two ways to stop short, and both have to raise the flag: the loop broke
    # with range left to walk, or the last chunk overshot the cap. Reading only
    # the second would report a complete series after stopping a decade early.
    truncated = cursor < end or len(rows) > MAX_RANGE_COUNT
    return rows[:MAX_RANGE_COUNT], truncated


def ensure_selected(symbol):
    """Put a symbol in Market Watch, which is what makes its history reachable.

    The terminal serves rates and ticks only for selected symbols: ask for
    XAUUSD while it sits unselected and copy_rates_range returns an empty array,
    not an error. That is indistinguishable at the call site from "this broker
    has no gold history" — the exact question Phase 0 exists to answer — so the
    selection has to happen here rather than by hand in the terminal, and its
    failure has to be reported as itself.

    Returns None on success, or a message naming what went wrong. Selecting is
    a Market Watch change and nothing more; it places no order and moves no
    money.
    """
    info = mt5.symbol_info(symbol)
    if info is None:
        return f"unknown symbol {symbol}: {mt5.last_error()}"
    if info.visible:
        return None
    if not mt5.symbol_select(symbol, True):
        return f"symbol_select({symbol}) failed: {mt5.last_error()}"
    return None


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status, body):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _authorized(self):
        return self.headers.get("X-Bridge-Secret") == SECRET

    def do_GET(self):
        if not self._authorized():
            return self._send_json(401, {"error": "bad or missing X-Bridge-Secret"})

        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if parsed.path == "/health":
            info = mt5.terminal_info()
            return self._send_json(200, {"connected": info is not None})

        if parsed.path == "/quote":
            symbol = (params.get("symbol") or [None])[0]
            if not symbol:
                return self._send_json(400, {"error": "missing symbol"})
            problem = ensure_selected(symbol)
            if problem:
                return self._send_json(404, {"error": problem})
            tick = mt5.symbol_info_tick(symbol)
            if tick is None:
                return self._send_json(404, {"error": f"no tick for {symbol}"})
            return self._send_json(200, {
                "symbol": symbol, "bid": tick.bid, "ask": tick.ask,
                "time": tick.time,
            })

        if parsed.path == "/candles":
            symbol = (params.get("symbol") or [None])[0]
            timeframe = (params.get("timeframe") or ["H1"])[0]
            count = min(int((params.get("count") or ["500"])[0]), MAX_COUNT)
            if not symbol:
                return self._send_json(400, {"error": "missing symbol"})
            tf = TIMEFRAMES.get(timeframe)
            if tf is None:
                return self._send_json(400, {"error": f"unsupported timeframe {timeframe}"})
            problem = ensure_selected(symbol)
            if problem:
                return self._send_json(404, {"error": problem})
            # Two modes, deliberately distinct. Without from/to this is the live
            # path: the last `count` bars, position-based, cheap. With from/to it
            # is the history path: an explicit date range, because a bar count
            # counted back from now names a different window every day and can
            # never reproduce a cache (the Webull window-policy trap).
            from_raw = (params.get("from") or [None])[0]
            to_raw = (params.get("to") or [None])[0]
            if from_raw or to_raw:
                if not (from_raw and to_raw):
                    return self._send_json(400, {"error": "from and to must be given together"})
                try:
                    date_from = datetime.fromtimestamp(int(from_raw), timezone.utc)
                    date_to = datetime.fromtimestamp(int(to_raw), timezone.utc)
                except (ValueError, OverflowError, OSError):
                    return self._send_json(400, {"error": "from and to must be epoch seconds"})
                if date_to <= date_from:
                    return self._send_json(400, {"error": "to must be after from"})
                rates, truncated = copy_rates_chunked(symbol, timeframe, tf, date_from, date_to)
            else:
                rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
                truncated = False
            if rates is None or len(rates) == 0:
                return self._send_json(404, {"error": f"no rates for {symbol} {timeframe} ({mt5.last_error()})"})
            candles = [
                {"t": int(r["time"]), "o": float(r["open"]), "h": float(r["high"]),
                 "l": float(r["low"]), "c": float(r["close"]), "v": float(r["tick_volume"])}
                for r in rates
            ]
            return self._send_json(200, {"symbol": symbol, "candles": candles, "truncated": truncated})

        if parsed.path == "/symbols":
            search = (params.get("search") or [None])[0]
            if not search:
                return self._send_json(400, {"error": "missing search"})
            matches = mt5.symbols_get(group=f"*{search}*") or ()
            out = [
                {
                    "name": s.name, "description": s.description,
                    "digits": s.digits, "point": s.point, "spread": s.spread,
                    "trade_contract_size": s.trade_contract_size,
                    "volume_min": s.volume_min, "volume_max": s.volume_max, "volume_step": s.volume_step,
                    "currency_base": s.currency_base, "currency_profit": s.currency_profit,
                    "path": s.path,
                    # Carry cost. A CFD held overnight is charged a swap the
                    # backtest cannot see, and gold's is asymmetric and rolls
                    # triple on Wednesday — on a rule holding days that is not a
                    # footnote, it is the sign of the result. swap_mode says what
                    # the numbers mean (points, base-currency, percent per year).
                    "swap_long": s.swap_long, "swap_short": s.swap_short,
                    "swap_mode": s.swap_mode, "swap_rollover3days": s.swap_rollover3days,
                    "trade_tick_value": s.trade_tick_value, "trade_tick_size": s.trade_tick_size,
                    # Where a stop is ALLOWED to sit. A 1.5xATR stop on H1 gold
                    # is a few hundred points, but the broker sets its own floor,
                    # and a rule whose stop falls inside trade_stops_level cannot
                    # be placed at all. That is a fact about which rules are
                    # tradeable here, so it belongs before the folds are declared
                    # rather than at the first live order.
                    "trade_stops_level": s.trade_stops_level,
                    "trade_freeze_level": s.trade_freeze_level,
                    "margin_initial": s.margin_initial,
                }
                for s in matches[:MAX_SYMBOLS]
            ]
            return self._send_json(200, {"symbols": out, "total": len(matches)})

        if parsed.path == "/account":
            info = mt5.account_info()
            if info is None:
                return self._send_json(503, {"error": "account_info unavailable"})
            # Trading-relevant fields only — omits login/name/company, which
            # identify the account holder and are not needed by any caller.
            # Two exceptions, both load-bearing. trade_mode: NEXMIND refuses to
            # send an order to a REAL account unless explicitly configured to, so
            # it has to tell demo from real without being told. server: a spread
            # profile is a measurement OF a broker and is worthless unlabelled —
            # Phase 0 measured 17 years of gold off MetaQuotes-Demo believing it
            # was the broker's own feed. The server names the venue; the login
            # would name the person, and stays out.
            return self._send_json(200, {
                "balance": info.balance, "equity": info.equity, "profit": info.profit,
                "credit": info.credit, "margin": info.margin, "margin_free": info.margin_free,
                "margin_level": info.margin_level, "leverage": info.leverage,
                "currency": info.currency, "trade_allowed": info.trade_allowed,
                "server": info.server,
                "trade_mode": ACCOUNT_TRADE_MODES.get(info.trade_mode, str(info.trade_mode)),
            })

        if parsed.path == "/margin":
            symbol = (params.get("symbol") or [None])[0]
            side = (params.get("side") or [None])[0]
            volume_raw = (params.get("volume") or [None])[0]
            if not symbol or not side or not volume_raw:
                return self._send_json(400, {"error": "missing symbol, side, or volume"})
            order_type = ORDER_SIDES.get(side.lower())
            if order_type is None:
                return self._send_json(400, {"error": "side must be buy or sell"})
            try:
                volume = float(volume_raw)
            except ValueError:
                return self._send_json(400, {"error": "volume must be a number"})
            price_raw = (params.get("price") or [None])[0]
            if price_raw:
                price = float(price_raw)
            else:
                tick = mt5.symbol_info_tick(symbol)
                if tick is None:
                    return self._send_json(404, {"error": f"no tick for {symbol}"})
                price = tick.ask if order_type == mt5.ORDER_TYPE_BUY else tick.bid
            margin = mt5.order_calc_margin(order_type, symbol, volume, price)
            if margin is None:
                return self._send_json(400, {"error": f"order_calc_margin failed: {mt5.last_error()}"})
            return self._send_json(200, {
                "symbol": symbol, "side": side.lower(), "volume": volume, "price": price, "margin": margin,
            })

        if parsed.path == "/ticks":
            symbol = (params.get("symbol") or [None])[0]
            if not symbol:
                return self._send_json(400, {"error": "missing symbol"})
            problem = ensure_selected(symbol)
            if problem:
                return self._send_json(404, {"error": problem})
            minutes = min(max(int((params.get("minutes") or ["5"])[0]), 1), 120)
            now = datetime.now(timezone.utc)
            date_from = now - timedelta(minutes=minutes)
            ticks = mt5.copy_ticks_range(symbol, date_from, now, mt5.COPY_TICKS_ALL)
            if ticks is None or len(ticks) == 0:
                return self._send_json(404, {"error": f"no ticks for {symbol} in the last {minutes}m"})
            truncated = len(ticks) > MAX_TICKS
            if truncated:
                ticks = ticks[-MAX_TICKS:]
            out = [
                {"t": float(t["time_msc"]) / 1000, "bid": float(t["bid"]), "ask": float(t["ask"]),
                 "last": float(t["last"]), "volume": float(t["volume_real"])}
                for t in ticks
            ]
            return self._send_json(200, {"symbol": symbol, "ticks": out, "truncated": truncated})

        if parsed.path == "/positions":
            # Deliberately OUTSIDE the trading gate. Reconciliation has to work
            # on a bridge that is not allowed to trade, or the desk cannot tell
            # that a CFD was closed underneath it by a stop-out.
            symbol = (params.get("symbol") or [None])[0]
            found = open_positions(symbol)
            if found is None:
                return self._send_json(502, {"error": f"positions_get failed: {mt5.last_error()}"})
            return self._send_json(200, {"positions": [position_payload(p) for p in found]})

        return self._send_json(404, {"error": "unknown path"})

    def _trading_refusal(self):
        """Every reason this bridge must not send an order, in one place so a
        new endpoint cannot forget one."""
        if not ALLOW_TRADING:
            return (403, "trading disabled — start the bridge with MT5_BRIDGE_ALLOW_TRADING=1")
        acct = mt5.account_info()
        if acct is None:
            return (503, "not logged in")
        mode = ACCOUNT_TRADE_MODES.get(acct.trade_mode, str(acct.trade_mode))
        # An unrecognised trade_mode reads as real. An account type nobody
        # taught this code about is not one to discover by sending it an order.
        if mode not in ("demo", "contest") and not ALLOW_REAL:
            return (403, f"account is {mode!r} — set MT5_BRIDGE_ALLOW_REAL=1 to trade it")
        if not acct.trade_allowed:
            return (503, "account trade_allowed is false (server-side restriction)")
        term = mt5.terminal_info()
        if term is None or not term.trade_allowed:
            return (503, "terminal has Algo Trading off — enable it in the MT5 UI")
        return None

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None, "bad Content-Length"
        if length <= 0 or length > 64 * 1024:
            return None, "missing or oversized body"
        try:
            return json.loads(self.rfile.read(length).decode()), None
        except (ValueError, UnicodeDecodeError) as e:
            return None, f"bad JSON body: {e}"

    def do_POST(self):
        if not self._authorized():
            return self._send_json(401, {"error": "bad or missing X-Bridge-Secret"})
        refusal = self._trading_refusal()
        if refusal:
            return self._send_json(refusal[0], {"error": refusal[1]})
        parsed = urlparse(self.path)
        if parsed.path not in ("/order", "/close"):
            return self._send_json(404, {"error": "unknown path"})
        body, problem = self._read_json_body()
        if problem:
            return self._send_json(400, {"error": problem})
        return self._order(body) if parsed.path == "/order" else self._close(body)

    def _order(self, body):
        symbol = body.get("symbol")
        side = body.get("side")
        magic = body.get("magic")
        if not symbol or side not in ORDER_SIDES:
            return self._send_json(400, {"error": "symbol and side (buy|sell) are required"})
        # No default and no derivation here. The magic IS the idempotency key,
        # and a bridge that invents one cannot recognise a retry of an order it
        # sent before it restarted — which is precisely when a retry happens.
        if not isinstance(magic, int) or isinstance(magic, bool) or magic <= 0:
            return self._send_json(400, {"error": "magic must be a positive int (the caller idempotency key)"})
        try:
            volume = float(body.get("volume"))
        except (TypeError, ValueError):
            return self._send_json(400, {"error": "volume must be a number"})
        if not 0 < volume <= MAX_ORDER_VOLUME:
            return self._send_json(400, {"error": f"volume must be in (0, {MAX_ORDER_VOLUME}]"})
        problem = ensure_selected(symbol)
        if problem:
            return self._send_json(404, {"error": problem})

        with order_lock(magic):
            existing = find_by_magic(magic)
            if existing is None:
                return self._send_json(502, {
                    "error": "cannot read open positions — refusing to send an order that may duplicate one",
                })
            if existing:
                p = existing[0]
                held = "buy" if p.type == mt5.POSITION_TYPE_BUY else "sell"
                # Same key, different trade means the caller derivation
                # collided. Neither answer is safe to guess, so refuse loudly
                # rather than skip a real order or duplicate one.
                if p.symbol != symbol or held != side:
                    return self._send_json(409, {
                        "error": f"magic {magic} already holds {p.symbol} {held} {p.volume} — not this order",
                        "position": position_payload(p),
                    })
                return self._send_json(200, {
                    "duplicate": True, "position": position_payload(p),
                    "note": "magic already open — retry recognised, nothing sent",
                })

            tick = mt5.symbol_info_tick(symbol)
            if tick is None:
                return self._send_json(404, {"error": f"no tick for {symbol}"})
            request = {
                "action": mt5.TRADE_ACTION_DEAL,
                "symbol": symbol,
                "volume": volume,
                "type": ORDER_SIDES[side],
                "price": tick.ask if side == "buy" else tick.bid,
                "deviation": int(body.get("deviation") or DEFAULT_DEVIATION),
                "magic": magic,
                # MT5 truncates a comment past 31 chars; do it here so what the
                # terminal shows is what the caller believes it sent.
                "comment": str(body.get("comment") or "")[:31],
                "type_time": mt5.ORDER_TIME_GTC,
                "type_filling": pick_filling(symbol),
            }
            for key in ("sl", "tp"):
                if body.get(key) is not None:
                    request[key] = float(body[key])
            result = mt5.order_send(request)

        if result is None:
            return self._send_json(502, {"error": f"order_send returned None: {mt5.last_error()}"})
        payload = {
            "retcode": result.retcode, "retcodeComment": result.comment,
            "order": result.order, "deal": result.deal,
            "volume": result.volume, "price": result.price, "magic": magic,
        }
        if result.retcode != TRADE_RETCODE_DONE:
            # A non-DONE retcode is a refusal, not a fill. It is reported as an
            # error so a caller checking only the HTTP status cannot book a
            # position the broker never opened.
            return self._send_json(502, dict(payload, error=f"order rejected: {result.retcode} {result.comment}"))
        return self._send_json(200, dict(payload, duplicate=False))

    def _close(self, body):
        ticket = body.get("ticket")
        magic = body.get("magic")
        has_ticket = isinstance(ticket, int) and not isinstance(ticket, bool)
        has_magic = isinstance(magic, int) and not isinstance(magic, bool)
        if not has_ticket and not has_magic:
            return self._send_json(400, {"error": "ticket or magic is required"})
        if has_ticket:
            got = mt5.positions_get(ticket=ticket)
            if got is None and mt5.last_error()[0] != getattr(mt5, "RES_S_OK", 1):
                found = None
            else:
                found = list(got or [])
        else:
            found = find_by_magic(magic)
        if found is None:
            return self._send_json(502, {"error": f"cannot read open positions: {mt5.last_error()}"})
        if not found:
            # Already flat is the outcome the caller asked for, and a CFD can be
            # closed by the broker without NEXMIND hearing about it. Reporting
            # that as an error would make reconciliation retry it forever.
            return self._send_json(200, {"closed": False, "note": "no such open position — already flat"})

        p = found[0]
        opposite = mt5.ORDER_TYPE_SELL if p.type == mt5.POSITION_TYPE_BUY else mt5.ORDER_TYPE_BUY
        tick = mt5.symbol_info_tick(p.symbol)
        if tick is None:
            return self._send_json(404, {"error": f"no tick for {p.symbol}"})
        result = mt5.order_send({
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": p.symbol,
            "volume": float(body.get("volume") or p.volume),
            "type": opposite,
            "position": p.ticket,
            "price": tick.bid if opposite == mt5.ORDER_TYPE_SELL else tick.ask,
            "deviation": int(body.get("deviation") or DEFAULT_DEVIATION),
            "magic": p.magic,
            "comment": "nexmind close",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": pick_filling(p.symbol),
        })
        if result is None:
            return self._send_json(502, {"error": f"order_send returned None: {mt5.last_error()}"})
        if result.retcode != TRADE_RETCODE_DONE:
            return self._send_json(502, {
                "error": f"close rejected: {result.retcode} {result.comment}", "retcode": result.retcode,
            })
        return self._send_json(200, {
            "closed": True, "ticket": p.ticket, "retcode": result.retcode,
            "price": result.price, "volume": result.volume,
        })

    def log_message(self, fmt, *args):
        print(f"[{datetime.now(timezone.utc).isoformat()}] {fmt % args}")


def main():
    # Which terminal, stated rather than inferred. A bare initialize() attaches to
    # whatever terminal is running or was last used — fine with one install, and
    # silently wrong with several. Comparing brokers means running several.
    path = os.environ.get("MT5_TERMINAL_PATH")
    if not (mt5.initialize(path=path) if path else mt5.initialize()):
        raise SystemExit(f"mt5.initialize({path or 'auto-detect'}) failed: {mt5.last_error()}")
    info = mt5.terminal_info()
    print(f"Connected to terminal: {info.name if info else '?'} (build {info.build if info else '?'})")
    # Name the account on every start. Phase 0 measured 17 years of gold history
    # off MetaQuotes-Demo while believing it was the broker's feed; one line here
    # would have caught that on the first run instead of after the measurements.
    acct = mt5.account_info()
    if acct is None:
        print("Account: NOT LOGGED IN — history depth and spreads are not a broker's")
    else:
        mode = ACCOUNT_TRADE_MODES.get(acct.trade_mode, str(acct.trade_mode))
        print(f"Account: {acct.server} [{mode}] {acct.currency} {acct.balance:,.2f} "
              f"leverage 1:{acct.leverage} algo={acct.trade_allowed}")
    if not ALLOW_TRADING:
        trading = "OFF (read-only)"
    elif ALLOW_REAL:
        trading = "ON, REAL ACCOUNTS PERMITTED"
    else:
        trading = "ON, demo/contest only"
    print(f"Bridge listening on http://127.0.0.1:{PORT} "
          f"(health/quote/candles/symbols/account/margin/ticks/positions)")
    print(f"Write path (/order, /close): {trading}; per-order volume ceiling {MAX_ORDER_VOLUME}")
    # Loopback only. The MetaTrader5 package talks to the terminal over local
    # IPC, so the bridge has to run on this machine anyway and there is no
    # reason for it to answer the network — a shared secret in a header is not
    # what should stand between a LAN and an account's order endpoint.
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    try:
        server.serve_forever()
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
