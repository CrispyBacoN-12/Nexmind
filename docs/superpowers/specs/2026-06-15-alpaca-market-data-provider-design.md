# Alpaca Market-Data Provider — Design

**Date:** 2026-06-15
**Status:** Approved (design), pending implementation plan
**Scope:** Add Alpaca as a market-data source for NEXMIND, behind a central
provider router, with automatic fallback to the existing Yahoo Finance fetcher.
**Explicitly out of scope:** order execution, account/positions, websocket
streaming, paid SIP feed, removing Yahoo.

## Motivation

NEXMIND currently sources all candle/price data from Yahoo Finance's free
unauthenticated chart endpoint (`src/lib/yahoo.ts`). Yahoo is convenient but is
an undocumented endpoint with no SLA, and its data lags real time by an extra
~30s cache window on top of the market feed's own delay. Alpaca is an
API-first US broker whose market-data API is authenticated, documented, and
intended for programmatic use. Adopting Alpaca for data now — without touching
trading — both improves data quality and lays the groundwork for live order
execution through the same broker later.

This change is data-only. Alpaca's market-data API and its order-execution API
are entirely separate; this design touches only the former. NEXMIND continues
to simulate P/L itself in `src/lib/trading/manage.ts`.

## Architecture — provider router pattern

Every consumer currently calls `fetchYahooCandles` / `fetchYahooCandlesSmart`
directly. They will instead call a single new central entry point,
`marketData.fetchCandles(...)`, which decides which provider to use:

```
consumers ──► marketData.fetchCandles(symbol, range, interval)
                      │
                      ├─ ALPACA_KEY present? ──► alpaca.fetchAlpacaCandles ──┐ (success → return)
                      │                                                       │ (error / empty)
                      └─ no key / Alpaca failed ─────────────────────────────► yahoo.fetchYahooCandles
```

Both providers return the existing `CandleResponse` shape, so consumers are
agnostic to which one served the data.

## Components

### 1. `src/lib/alpaca.ts` (new) — Alpaca provider

- **`fetchAlpacaCandles(symbol, range, interval): Promise<CandleResponse>`**
  - Returns the exact `CandleResponse` shape defined in `src/lib/yahoo.ts`
    (reuse that interface; do not redefine).
  - Maps `Range` → a lookback window expressed as `start`/`end` ISO timestamps
    (`start = now - lookback(range)`, `end = now`).
  - Maps `Interval` → Alpaca timeframe string:
    `5m→5Min`, `15m→15Min`, `30m→30Min`, `60m→1Hour`, `1h→1Hour`,
    `1d→1Day`, `1wk→1Week`.
  - Reads `ALPACA_KEY` / `ALPACA_SECRET` from `process.env`; sends them as
    `APCA-API-KEY-ID` / `APCA-API-SECRET-KEY` headers.
  - Uses the free IEX feed (`feed=iex`).
  - Endpoint: `https://data.alpaca.markets/v2/stocks/{symbol}/bars`
    with `timeframe`, `start`, `end`, `feed`, and a sensible `limit`.
  - Keeps the same `next: { revalidate: 30 }` cache window as the Yahoo
    fetcher to bound request volume and match current freshness behavior.
  - Throws on missing key, non-OK HTTP status, or empty bar set — so the
    router can fall back.
  - `price` is taken from the last bar's close (data-only; no separate
    snapshot/quote call).

- **`parseAlpacaBars(json, symbol, range, interval): CandleResponse`** (pure,
  exported for testing)
  - Pure transform from the Alpaca JSON body to `CandleResponse`. No network,
    no env, no `fetch`. This is the primary unit-test surface.
  - Bar timestamps (ISO 8601) convert to the `Candle.t` unix-seconds
    convention used elsewhere.

### 2. `src/lib/marketData.ts` (new) — provider router

- **`fetchCandles(symbol, range, interval): Promise<CandleResponse>`**
  - If `ALPACA_KEY` is present: try `fetchAlpacaCandles`; on any thrown error,
    fall back to `fetchYahooCandles`.
  - If `ALPACA_KEY` is absent: call `fetchYahooCandles` directly (no Alpaca
    attempt).
  - This is the single market-data entry point for the rest of the app.
  - Default `range`/`interval` parameters match the current Yahoo defaults so
    call sites need no behavioral change.

### 3. Consumer migration (4 call sites)

Repoint each from the Yahoo fetcher to `fetchCandles`:

- `src/lib/trading/scanner.ts` (`scanSymbol`, 1h / 3mo)
- `src/lib/trading/engine.ts` (`fetchDailyReturns`, 1d / 3mo)
- `src/lib/trading/manage.ts` (`makePriceFetcher`, 5m / 1d intraday)
- `src/lib/invest/analyze.ts` (1wk / 5y long-term)

The `.BK` Thai-suffix smart-retry in `fetchYahooCandlesSmart` is now dead code
(Thai universe was removed). Consumers should call `fetchCandles`; the smart
wrapper is no longer needed and the `symbol = resp.symbol` reassignment lines
that existed only to capture the `.BK`-resolved ticker can be simplified.
`fetchYahooCandles` itself stays as the Yahoo provider implementation.

## Data flow & error handling

- Cache: `revalidate: 30` retained on both providers; consumers unchanged.
- Consumers that already wrap fetches in try/catch (`fetchDailyReturns`,
  `makePriceFetcher`) keep working without logic changes — they simply receive
  whichever provider's data the router returned.
- Data Alpaca's free tier can't serve well (e.g. weekly 5y history for
  `analyze`) results in an error/empty response from Alpaca, which the router
  catches and serves from Yahoo instead — full data preserved.
- If both providers fail, the router throws; existing call-site try/catch
  handles it exactly as a Yahoo failure is handled today.

## Configuration

- New env vars: `ALPACA_KEY`, `ALPACA_SECRET`. Server-side only; never exposed
  to the client (no `NEXT_PUBLIC_` prefix). Follows the existing
  `ANTHROPIC_API_KEY` / `FINNHUB_API_KEY` graceful-degradation pattern.
- Documented in `README.md` and the `.env` example. The user supplies their own
  Alpaca key; it is not committed.

## Testing

Co-located `node:test` files, run via `npm test` (`tsx --test "src/**/*.test.ts"`):

- `src/lib/alpaca.test.ts`:
  - `Interval` → Alpaca timeframe mapping (all supported intervals).
  - `Range` → lookback / start-date computation.
  - `parseAlpacaBars`: well-formed body → correct `Candle[]`, correct
    timestamp conversion, `price` = last close.
  - Empty / missing bars → throws, so the router falls back to Yahoo.
- Provider-selection logic in `marketData.ts`: with no key, Yahoo path is
  chosen without attempting Alpaca. (Tested via a pure decision helper or
  dependency injection so no real network call is made.)

No test hits the live Alpaca or Yahoo network.

## Out of scope (for now)

- Order execution, account, and positions endpoints.
- Websocket / streaming real-time data.
- Paid SIP (full-market) data feed; only free IEX is used.
- Removing Yahoo — it remains as the fallback provider.
- A UI control to pick the provider — selection is automatic via key presence.
