# Alpaca Market-Data Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Alpaca as a market-data source behind a central provider router that automatically falls back to the existing Yahoo fetcher.

**Architecture:** A new pure-mapping + fetch module (`alpaca.ts`) returns the existing `CandleResponse` shape. A new router (`marketData.ts`) picks Alpaca when `ALPACA_KEY` is set and falls back to Yahoo on any error or when no key is present. The four existing consumers are repointed from the Yahoo fetcher to the router. Data-only — no order execution.

**Tech Stack:** TypeScript, Next.js 16 (App Router), `node:test` + `node:assert/strict` (run via `npm test` = `tsx --test "src/**/*.test.ts"`), Fetch API with Next.js `revalidate` caching.

---

## File Structure

- **Create** `src/lib/alpaca.ts` — Alpaca provider: pure mapping helpers (`intervalToTimeframe`, `rangeToLookbackMs`), pure `parseAlpacaBars`, and the network `fetchAlpacaCandles`.
- **Create** `src/lib/alpaca.test.ts` — unit tests for the pure helpers and parser (no network).
- **Create** `src/lib/marketData.ts` — provider router: `shouldTryAlpaca` (pure) and `fetchCandles` (entry point).
- **Create** `src/lib/marketData.test.ts` — unit test for `shouldTryAlpaca` (no network).
- **Modify** `src/lib/trading/scanner.ts` — repoint `scanSymbol` to `fetchCandles`.
- **Modify** `src/lib/trading/engine.ts` — repoint `fetchDailyReturns` to `fetchCandles`.
- **Modify** `src/lib/trading/manage.ts` — repoint `makePriceFetcher` to `fetchCandles`.
- **Modify** `src/lib/invest/analyze.ts` — repoint `analyzeLongTerm` to `fetchCandles`.
- **Modify** `README.md` and create/extend `.env.example` — document `ALPACA_KEY` / `ALPACA_SECRET`.

Reuse the existing `CandleResponse` interface and `Range`/`Interval` types from `src/lib/yahoo.ts` and the `Candle` type from `src/lib/indicators.ts`. Do not redefine them.

---

## Task 1: Alpaca pure helpers + parser

**Files:**
- Create: `src/lib/alpaca.ts`
- Test: `src/lib/alpaca.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/alpaca.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { intervalToTimeframe, rangeToLookbackMs, parseAlpacaBars } from "./alpaca";

test("intervalToTimeframe maps every supported interval", () => {
  assert.equal(intervalToTimeframe("5m"), "5Min");
  assert.equal(intervalToTimeframe("15m"), "15Min");
  assert.equal(intervalToTimeframe("30m"), "30Min");
  assert.equal(intervalToTimeframe("60m"), "1Hour");
  assert.equal(intervalToTimeframe("1h"), "1Hour");
  assert.equal(intervalToTimeframe("1d"), "1Day");
  assert.equal(intervalToTimeframe("1wk"), "1Week");
});

test("rangeToLookbackMs grows monotonically with range", () => {
  const day = 86_400_000;
  assert.equal(rangeToLookbackMs("1d"), 1 * day);
  assert.equal(rangeToLookbackMs("5d"), 5 * day);
  assert.ok(rangeToLookbackMs("3mo") > rangeToLookbackMs("1mo"));
  assert.ok(rangeToLookbackMs("5y") > rangeToLookbackMs("1y"));
  assert.ok(rangeToLookbackMs("max") >= rangeToLookbackMs("5y"));
});

test("parseAlpacaBars converts bars to Candle[] with unix-second timestamps", () => {
  const json = {
    symbol: "AAPL",
    bars: [
      { t: "2026-06-15T13:30:00Z", o: 1, h: 3, l: 0.5, c: 2, v: 100 },
      { t: "2026-06-15T13:35:00Z", o: 2, h: 4, l: 1.5, c: 3, v: 200 },
    ],
  };
  const resp = parseAlpacaBars(json, "AAPL", "1d", "5m");
  assert.equal(resp.symbol, "AAPL");
  assert.equal(resp.range, "1d");
  assert.equal(resp.interval, "5m");
  assert.equal(resp.candles.length, 2);
  assert.deepEqual(resp.candles[0], { t: Math.floor(Date.parse("2026-06-15T13:30:00Z") / 1000), o: 1, h: 3, l: 0.5, c: 2, v: 100 });
  // price is the last bar's close
  assert.equal(resp.price, 3);
});

test("parseAlpacaBars throws on empty or missing bars (so the router can fall back)", () => {
  assert.throws(() => parseAlpacaBars({ symbol: "AAPL", bars: [] }, "AAPL", "1d", "5m"));
  assert.throws(() => parseAlpacaBars({ symbol: "AAPL" }, "AAPL", "1d", "5m"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/alpaca.test.ts`
Expected: FAIL — `intervalToTimeframe`/`rangeToLookbackMs`/`parseAlpacaBars` not exported (module not found / undefined).

- [ ] **Step 3: Write the pure helpers + parser**

```ts
// src/lib/alpaca.ts
// Alpaca market-data provider. Returns the same CandleResponse shape as the
// Yahoo fetcher so the rest of the app is provider-agnostic. Data-only:
// this never touches Alpaca's order/account APIs.

import type { Candle } from "./indicators";
import type { CandleResponse, Range, Interval } from "./yahoo";

const DAY_MS = 86_400_000;

/** Map our Interval to an Alpaca v2 timeframe string. */
export function intervalToTimeframe(interval: Interval): string {
  switch (interval) {
    case "5m": return "5Min";
    case "15m": return "15Min";
    case "30m": return "30Min";
    case "60m": return "1Hour";
    case "1h": return "1Hour";
    case "1d": return "1Day";
    case "1wk": return "1Week";
  }
}

/** Lookback window (ms) for a Range, used to compute the Alpaca `start` time. */
export function rangeToLookbackMs(range: Range): number {
  const days: Record<Range, number> = {
    "1d": 1, "5d": 5, "1mo": 31, "3mo": 93, "6mo": 186,
    "1y": 366, "2y": 731, "5y": 1827, "max": 7305, // ~20y
  };
  return days[range] * DAY_MS;
}

interface AlpacaBar { t: string; o: number; h: number; l: number; c: number; v: number }

/**
 * Pure transform from an Alpaca bars response body to CandleResponse.
 * Throws when there are no bars so the router can fall back to Yahoo.
 */
export function parseAlpacaBars(
  json: unknown,
  symbol: string,
  range: Range,
  interval: Interval,
): CandleResponse {
  const bars = (json as { bars?: AlpacaBar[] })?.bars;
  if (!bars || bars.length === 0) {
    throw new Error("alpaca: no bars for symbol");
  }
  const candles: Candle[] = bars.map((b) => ({
    t: Math.floor(Date.parse(b.t) / 1000),
    o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0,
  }));
  return {
    symbol,
    range,
    interval,
    price: candles.at(-1)?.c,
    candles,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/alpaca.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add src/lib/alpaca.ts src/lib/alpaca.test.ts
git commit -m "feat: add Alpaca candle mapping helpers and parser"
```

---

## Task 2: fetchAlpacaCandles (network fetch)

**Files:**
- Modify: `src/lib/alpaca.ts`
- Test: `src/lib/alpaca.test.ts`

The network path can't be unit-tested without hitting Alpaca, but the
"no key configured" guard can: it must throw before any fetch. We test that.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/alpaca.test.ts`:

```ts
import { fetchAlpacaCandles } from "./alpaca";

test("fetchAlpacaCandles throws when no API key is configured", async () => {
  const prevKey = process.env.ALPACA_KEY;
  const prevSecret = process.env.ALPACA_SECRET;
  delete process.env.ALPACA_KEY;
  delete process.env.ALPACA_SECRET;
  try {
    await assert.rejects(() => fetchAlpacaCandles("AAPL", "1d", "5m"), /key/i);
  } finally {
    if (prevKey !== undefined) process.env.ALPACA_KEY = prevKey;
    if (prevSecret !== undefined) process.env.ALPACA_SECRET = prevSecret;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/alpaca.test.ts`
Expected: FAIL — `fetchAlpacaCandles` not exported.

- [ ] **Step 3: Implement fetchAlpacaCandles**

Add to `src/lib/alpaca.ts`:

```ts
const ALPACA_DATA_BASE = "https://data.alpaca.markets/v2/stocks";

/**
 * Fetch candles from Alpaca's IEX (free) feed. Throws when no key is set, on a
 * non-OK response, or when the body has no bars — callers fall back to Yahoo.
 */
export async function fetchAlpacaCandles(
  symbol: string,
  range: Range = "1mo",
  interval: Interval = "1h",
): Promise<CandleResponse> {
  const key = process.env.ALPACA_KEY;
  const secret = process.env.ALPACA_SECRET;
  if (!key || !secret) {
    throw new Error("alpaca: missing ALPACA_KEY / ALPACA_SECRET");
  }

  const start = new Date(Date.now() - rangeToLookbackMs(range)).toISOString();
  const end = new Date().toISOString();
  const params = new URLSearchParams({
    timeframe: intervalToTimeframe(interval),
    start,
    end,
    feed: "iex",
    limit: "10000",
    sort: "asc",
  });
  const url = `${ALPACA_DATA_BASE}/${encodeURIComponent(symbol)}/bars?${params}`;

  const res = await fetch(url, {
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      Accept: "application/json",
    },
    // Match the Yahoo fetcher's short cache window to bound request volume.
    next: { revalidate: 30 },
  });

  if (!res.ok) {
    throw new Error(`alpaca upstream ${res.status}`);
  }

  const json = await res.json();
  return parseAlpacaBars(json, symbol, range, interval);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/alpaca.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add src/lib/alpaca.ts src/lib/alpaca.test.ts
git commit -m "feat: add fetchAlpacaCandles network fetch with key guard"
```

---

## Task 3: marketData router

**Files:**
- Create: `src/lib/marketData.ts`
- Test: `src/lib/marketData.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/marketData.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldTryAlpaca } from "./marketData";

test("shouldTryAlpaca is true only when both key and secret are present", () => {
  assert.equal(shouldTryAlpaca({ ALPACA_KEY: "k", ALPACA_SECRET: "s" }), true);
  assert.equal(shouldTryAlpaca({ ALPACA_KEY: "k" }), false);
  assert.equal(shouldTryAlpaca({ ALPACA_SECRET: "s" }), false);
  assert.equal(shouldTryAlpaca({}), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/marketData.test.ts`
Expected: FAIL — `shouldTryAlpaca` not exported.

- [ ] **Step 3: Implement the router**

```ts
// src/lib/marketData.ts
// Central market-data entry point. Prefers Alpaca when configured and falls
// back to Yahoo on any error (or immediately when no Alpaca key is set).

import { fetchAlpacaCandles } from "./alpaca";
import { fetchYahooCandles, type CandleResponse, type Range, type Interval } from "./yahoo";

/** Pure decision: try Alpaca only when both credentials are present. */
export function shouldTryAlpaca(env: { ALPACA_KEY?: string; ALPACA_SECRET?: string }): boolean {
  return Boolean(env.ALPACA_KEY && env.ALPACA_SECRET);
}

/**
 * Fetch candles from the best available provider. Alpaca first when
 * configured; Yahoo as the fallback (and the only provider when no key is set).
 */
export async function fetchCandles(
  symbol: string,
  range: Range = "1mo",
  interval: Interval = "1h",
): Promise<CandleResponse> {
  if (shouldTryAlpaca(process.env)) {
    try {
      return await fetchAlpacaCandles(symbol, range, interval);
    } catch (e) {
      console.warn(`marketData: Alpaca failed for ${symbol}, falling back to Yahoo —`, e);
    }
  }
  return fetchYahooCandles(symbol, range, interval);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/marketData.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add src/lib/marketData.ts src/lib/marketData.test.ts
git commit -m "feat: add marketData router with Alpaca-first, Yahoo fallback"
```

---

## Task 4: Migrate consumers to fetchCandles

**Files:**
- Modify: `src/lib/trading/scanner.ts`
- Modify: `src/lib/trading/engine.ts`
- Modify: `src/lib/trading/manage.ts`
- Modify: `src/lib/invest/analyze.ts`

No new tests — this is a mechanical repoint. The existing suite plus a
type-check and a smoke run protect against regressions. `fetchCandles` has the
same signature and return type as `fetchYahooCandles`, and returns the input
`symbol` unchanged (the `.BK` smart-retry is dropped since Thai was removed), so
the `symbol = resp.symbol` lines remain correct and need no change.

- [ ] **Step 1: scanner.ts**

In `src/lib/trading/scanner.ts`, change the import:

```ts
// before
import { fetchYahooCandlesSmart, type Interval, type Range } from "@/lib/yahoo";
// after
import { type Interval, type Range } from "@/lib/yahoo";
import { fetchCandles } from "@/lib/marketData";
```

And the call inside `scanSymbol`:

```ts
// before
const resp = await fetchYahooCandlesSmart(symbol, range, interval);
// after
const resp = await fetchCandles(symbol, range, interval);
```

- [ ] **Step 2: engine.ts**

In `src/lib/trading/engine.ts`, update the import to add `fetchCandles` and drop
`fetchYahooCandlesSmart` if it is otherwise unused (keep `type Interval, Range`
if still referenced):

```ts
// before
import { fetchYahooCandlesSmart, type Interval, type Range } from "@/lib/yahoo";
// after
import { type Interval, type Range } from "@/lib/yahoo";
import { fetchCandles } from "@/lib/marketData";
```

And the call inside `fetchDailyReturns`:

```ts
// before
const resp = await fetchYahooCandlesSmart(symbol, "3mo", "1d");
// after
const resp = await fetchCandles(symbol, "3mo", "1d");
```

If `engine.ts` references `fetchYahooCandlesSmart` anywhere else, repoint those
too. Run `git grep -n fetchYahooCandlesSmart src/lib/trading/engine.ts` to
confirm none remain.

- [ ] **Step 3: manage.ts**

In `src/lib/trading/manage.ts`, change the import:

```ts
// before
import { fetchYahooCandles } from "@/lib/yahoo";
// after
import { fetchCandles } from "@/lib/marketData";
```

And the call inside `makePriceFetcher`:

```ts
// before
const r = await fetchYahooCandles(symbol, "1d", "5m");
// after
const r = await fetchCandles(symbol, "1d", "5m");
```

- [ ] **Step 4: analyze.ts**

In `src/lib/invest/analyze.ts`, change the import:

```ts
// before
import { fetchYahooCandlesSmart } from "@/lib/yahoo";
// after
import { fetchCandles } from "@/lib/marketData";
```

And the call inside `analyzeLongTerm`:

```ts
// before
const chart = await fetchYahooCandlesSmart(symbol, "5y", "1wk");
// after
const chart = await fetchCandles(symbol, "5y", "1wk");
```

- [ ] **Step 5: Type-check and full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean type-check; all tests pass (existing 83 + new Alpaca/marketData tests).

- [ ] **Step 6: Smoke-run the dev server**

Run: `npm run dev` (port 3275), then in another shell:
`curl -s http://localhost:3275/api/settings -o /dev/null -w "%{http_code}\n"`
Expected: `200` (with no Alpaca key set, the app behaves exactly as before via Yahoo fallback). Stop the dev server afterward.

- [ ] **Step 7: Commit**

```bash
git add src/lib/trading/scanner.ts src/lib/trading/engine.ts src/lib/trading/manage.ts src/lib/invest/analyze.ts
git commit -m "feat: route all market-data reads through marketData.fetchCandles"
```

---

## Task 5: Document the env vars

**Files:**
- Modify: `README.md`
- Create or modify: `.env.example`

- [ ] **Step 1: Add the keys to `.env.example`**

Append to `.env.example` (create the file if it does not exist):

```
# Alpaca market data (optional). When both are set, NEXMIND uses Alpaca's free
# IEX feed for candles/prices and falls back to Yahoo on any error. Leave unset
# to use Yahoo only. Get keys at https://alpaca.markets (paper account is free).
ALPACA_KEY=
ALPACA_SECRET=
```

- [ ] **Step 2: Document in README**

In `README.md`, under the environment/configuration section (or add a short
"Market data" subsection if none exists), add:

```markdown
### Market data

NEXMIND reads candles and prices through a provider router
(`src/lib/marketData.ts`). By default it uses Yahoo Finance (no key needed).
If you set `ALPACA_KEY` and `ALPACA_SECRET` in `.env.local`, it uses Alpaca's
free IEX feed instead and falls back to Yahoo automatically on any error.
This is data-only; NEXMIND does not place orders through Alpaca.
```

- [ ] **Step 3: Verify no secrets are committed**

Run: `git status --short` and confirm `.env.local` is not staged (only
`.env.example` and `README.md`).

- [ ] **Step 4: Commit**

```bash
git add README.md .env.example
git commit -m "docs: document optional Alpaca market-data env vars"
```

---

## Self-Review Notes

- **Spec coverage:** `alpaca.ts` provider (Task 1–2), `marketData.ts` router with key-presence selection + Yahoo fallback (Task 3), all four consumer migrations (Task 4), env config + docs (Task 5), `revalidate: 30` retained (Task 2), pure `parseAlpacaBars` test surface + no-network tests (Tasks 1–3), out-of-scope items untouched (no order/account code). All spec sections map to a task.
- **Type consistency:** `CandleResponse`, `Range`, `Interval` imported from `yahoo.ts`; `Candle` from `indicators.ts`. `fetchCandles` mirrors `fetchYahooCandles`'s signature `(symbol, range="1mo", interval="1h")`. `intervalToTimeframe`/`rangeToLookbackMs`/`parseAlpacaBars`/`fetchAlpacaCandles`/`shouldTryAlpaca`/`fetchCandles` names are used identically across tasks.
- **No placeholders:** every code step shows complete code; commands have expected output.
