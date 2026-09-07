# Local HTTP bridge exposing an already-running MT5 terminal's price data to
# NEXMIND (which fetches from it as just another market-data provider). Runs
# on the same machine as the terminal — the MetaTrader5 package talks to it
# over IPC, which only works locally. Data-only: never places/closes orders.
#
# Run: python bridge.py
# Requires: pip install MetaTrader5
# Env: MT5_BRIDGE_SECRET (shared secret, required), MT5_BRIDGE_PORT (default 8787)

import json
import os
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
ORDER_SIDES = {"buy": mt5.ORDER_TYPE_BUY, "sell": mt5.ORDER_TYPE_SELL}
MAX_COUNT = 5000
MAX_SYMBOLS = 200
MAX_TICKS = 20000


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
            rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
            if rates is None or len(rates) == 0:
                return self._send_json(404, {"error": f"no rates for {symbol} (is it in Market Watch?)"})
            candles = [
                {"t": int(r["time"]), "o": float(r["open"]), "h": float(r["high"]),
                 "l": float(r["low"]), "c": float(r["close"]), "v": float(r["tick_volume"])}
                for r in rates
            ]
            return self._send_json(200, {"symbol": symbol, "candles": candles})

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
                }
                for s in matches[:MAX_SYMBOLS]
            ]
            return self._send_json(200, {"symbols": out, "total": len(matches)})

        if parsed.path == "/account":
            info = mt5.account_info()
            if info is None:
                return self._send_json(503, {"error": "account_info unavailable"})
            # Trading-relevant fields only — omits login/name/server/company
            # (account-identifying) since the bridge listens on 0.0.0.0.
            return self._send_json(200, {
                "balance": info.balance, "equity": info.equity, "profit": info.profit,
                "credit": info.credit, "margin": info.margin, "margin_free": info.margin_free,
                "margin_level": info.margin_level, "leverage": info.leverage,
                "currency": info.currency, "trade_allowed": info.trade_allowed,
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

        return self._send_json(404, {"error": "unknown path"})

    def log_message(self, fmt, *args):
        print(f"[{datetime.now(timezone.utc).isoformat()}] {fmt % args}")


def main():
    if not mt5.initialize():
        raise SystemExit(f"mt5.initialize() failed: {mt5.last_error()}")
    info = mt5.terminal_info()
    print(f"Connected to terminal: {info.name if info else '?'} (build {info.build if info else '?'})")
    print(f"Bridge listening on http://127.0.0.1:{PORT} (health/quote/candles/symbols/account/margin/ticks)")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    try:
        server.serve_forever()
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
