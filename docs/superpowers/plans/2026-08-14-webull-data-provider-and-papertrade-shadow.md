# Webull Data Provider + PaperTrade Shadow Execution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Webull as a market-data provider ahead of Alpaca in NEXMIND's fallback chain, and add an opt-in per-portfolio "shadow" mode that mirrors approved signals into Webull's PaperTrade OpenAPI as real bracket orders, purely to observe realistic fills alongside NEXMIND's own simulation.

**Architecture:** Two additive layers, matching the approved design's Phase 1 (data) / Phase 2 (shadow execution) split. Phase 1 inserts `webull.ts` into `marketData.ts`'s existing try/catch/fallback chain (MT5 → **Webull** → Alpaca → Yahoo). Phase 2 hooks into `engine.ts`'s exec stage immediately after the authoritative `Trade` row is created, `await`s a non-throwing shadow-order placement into a new `WebullShadowOrder` table, and polls it via a new lightweight GitHub Actions cron plus the existing swing-scan cron as a backstop.

**Tech Stack:** Next.js 16, Prisma 7 (Postgres/Neon), TypeScript, `node:test` (`npm test`), `node:crypto` for HMAC-SHA256 request signing, GitHub Actions for cron.

## Global Constraints

- Webull shadow orders are **purely observational** — they never feed back into `manage.ts`, win-rate stats, or Iron Rules, and never alter the authoritative simulated `Trade` row in any way.
- Phase 2 is **fully fail-open**: a Webull outage, rate limit, auth failure, or rejected symbol must never block, delay past an `await`, or alter the real (simulated) `Trade` row — it only prevents that one shadow order from being placed.
- All new env vars are server-side only (no `NEXT_PUBLIC_` prefix) and follow the existing graceful-degradation pattern: absent credentials → feature silently doesn't activate, no error.
- **No live/real-money order execution** in this plan — PaperTrade only, out of scope per the design's "Phase 3."
- Parent bracket order is always `MARKET` (never `LIMIT`); `TIF` is always `GTC`; quantity is floored to a whole share via `Math.floor` and the order is **skipped** (not sent) if the floored quantity is `< 1`; placement is **skipped** (not sent) outside regular trading hours.
- `exitPrice` on a shadow order is the **volume-weighted average fill price (VWAP)** across a triggered child order's executions; a shadow order only reaches `status = closed` once `exitFilledQty === entryFilledQty` or the triggered child order itself reports a terminal state.
- The `WebullShadowOrder` update layer **rejects any write that would move `status` away from a terminal value** (`closed`, `cancelled`, `rejected`) — once terminal, only field-level corrections at the same status may still apply.
- No automated test hits the live or sandbox Webull network.

## Resolved implementation details

The spec left a few things intentionally unconfirmed pending the real Webull API reference, or described them in a way that doesn't map 1:1 onto NEXMIND's actual codebase. This plan makes the following concrete, non-placeholder decisions so every task below has real code to write:

1. **`WebullShadowOrder.tradeId` is `Int @unique` with a Prisma relation to `Trade`**, not the spec's illustrative `String @default(cuid())`. `Trade.id` in `prisma/schema.prisma:137` is `Int @id @default(autoincrement())` — every other model in this schema follows that same integer-autoincrement convention, and the spec's `String`/`cuid()` block was evidently illustrative shorthand, not a literal requirement.
2. **The `webull-shadow` `decisionLog` step is appended via a follow-up `prisma.trade.update`**, not inside the original `prisma.trade.create` call in `engine.ts:285-304`. `trade.id` doesn't exist until that `create` resolves, but `WebullShadowOrder.tradeId` needs it — so the shadow-order attempt necessarily happens *after* `create`, and its outcome is folded into `decisionLog` via a second write.
3. **Webull's request auth is implemented as pure per-request HMAC-SHA256 signing** (App Key + Secret, no OAuth token exchange), per the exact field-for-field algorithm the spec's round-3 feedback specified (nonce+host in the sorted string, POST-body-hash vs. GET-no-hash, `app_secret + "&"` HMAC key). The design doc's earlier, vaguer "token-based 2FA" phrasing is treated as referring to Webull's *account onboarding* process, not per-request auth — round 3's detailed signing algorithm is the later and more authoritative source. `auth.test.ts`'s fixture pairs are **self-computed** using the same primitives the algorithm describes (`node:crypto` calls made directly in the test) rather than literal Webull-published values, since none are available while authoring this plan offline; a code comment marks where to swap in a real Webull-published sample once available, per the spec's own instruction.
4. **Every DB- or network-touching module below separates its pure decision/parsing/derivation logic into its own exported, independently tested function**, leaving the impure wrapper covered only by a "throws on missing credentials" guard test where applicable. This matches the codebase's own established convention exactly (confirmed via `alpaca.test.ts` — only `fetchAlpacaCandles`'s missing-key path is tested, never a live/mocked fetch; `circuitBreaker.test.ts` — only the pure `currentDrawdownPct`/`currentEquity` are tested, never the DB-touching `getCurrentDrawdownPct`/`getCurrentEquity`; `engine.test.ts` — only pure `resolveExitOverride`/`minRiskRewardFor`/`buildRLState` are tested, never `runTradeTick` itself). It also directly satisfies the spec's Testing section requirements (cache-hit/miss, the monotonicity guard, VWAP derivation, bracket-order construction) without inventing a fetch/DB-mocking pattern this codebase doesn't otherwise use.

---

### Task 1: Prisma schema — `WebullShadowOrder`, `WebullTickerCache`, `Portfolio.webullShadowEnabled`

**Files:**
- Modify: `prisma/schema.prisma:76-100` (Portfolio model), `prisma/schema.prisma:136-162` (Trade model), append after `prisma/schema.prisma:274` (end of file)

**Interfaces:**
- Produces: `Portfolio.webullShadowEnabled: boolean`, `WebullShadowOrder` model (fields below), `WebullTickerCache` model (`symbol`, `tickerId`, `updatedAt`), `Trade.webullShadowOrder?: WebullShadowOrder` back-relation.

- [ ] **Step 1: Add `webullShadowEnabled` to `Portfolio`**

In `prisma/schema.prisma`, in the `Portfolio` model, right after the `killSwitchReason` line:

```prisma
  killSwitch       Boolean     @default(false)
  killSwitchReason String      @default("")
  webullShadowEnabled Boolean  @default(false)
```

- [ ] **Step 2: Add the `webullShadowOrder` back-relation to `Trade`**

In `prisma/schema.prisma`, in the `Trade` model, right after the `closedAt` line:

```prisma
  openedAt        DateTime  @default(now())
  closedAt        DateTime?
  webullShadowOrder WebullShadowOrder?
```

- [ ] **Step 3: Append the `WebullShadowOrder` and `WebullTickerCache` models**

At the end of `prisma/schema.prisma` (after the `ScanLog` model):

```prisma
/// A risk-free "shadow" bracket order mirrored into Webull's PaperTrade
/// account for a NEXMIND Trade — purely observational, never fed back into
/// grading. Parent (entry) + up to two OCO children (stop-loss/take-profit).
model WebullShadowOrder {
  id             Int       @id @default(autoincrement())
  trade          Trade     @relation(fields: [tradeId], references: [id])
  tradeId        Int       @unique
  parentOrderId  String
  slOrderId      String?
  tpOrderId      String?
  status         String // pending | open | filled | closed | cancelled | rejected
  entryFillPrice Float?
  entryFilledQty Float?
  entryFilledAt  DateTime?
  exitPrice      Float? // VWAP of the triggered child order's executions
  exitReason     String? // TAKE_PROFIT | STOP_LOSS | MANUAL_CANCEL
  exitFilledQty  Float?
  closedAt       DateTime?
  lastError      String?
  createdAt      DateTime  @default(now())
}

/// Cache of symbol -> Webull's internal numeric tickerId (static per symbol).
/// Persistent (not in-memory) because the exec-stage hook and the polling
/// cron are fresh, short-lived processes that share no memory.
model WebullTickerCache {
  symbol    String   @id
  tickerId  Int
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 4: Push the schema and regenerate the client**

Run:
```bash
npm run db:push
npm run db:generate
```
Expected: both succeed with no errors; `src/generated/prisma` now exports `WebullShadowOrder`/`WebullTickerCache` types.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expect PASS (nothing references the new types yet).

```bash
git add prisma/schema.prisma
git commit -m "feat: add WebullShadowOrder/WebullTickerCache schema + Portfolio.webullShadowEnabled"
```

---

### Task 2: `src/lib/webull/auth.ts` — shared request signing

**Files:**
- Create: `src/lib/webull/auth.ts`
- Test: `src/lib/webull/auth.test.ts`

**Interfaces:**
- Consumes: `process.env.WEBULL_APP_KEY`, `process.env.WEBULL_APP_SECRET`.
- Produces: `buildSignatureString(req: SignableRequest): string`, `signString(signatureString: string, appSecret: string): string`, `classifyAuthError(body): "clock-skew" | "bad-key"`, `class WebullAuthError extends Error { reason }`, `signedFetch(path: string, opts: SignedFetchOptions): Promise<Response>` where `SignedFetchOptions = { baseUrl: string; method?: "GET" | "POST"; params?: Record<string,string>; body?: unknown }`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/webull/auth.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { buildSignatureString, signString, classifyAuthError, signedFetch } from "./auth";

// These fixtures are self-computed (via the same primitives Webull's OpenAPI
// signing spec describes: sorted host+nonce+params, POST body as
// toUpper(SHA256(body)), HMAC-SHA256 keyed by `secret + "&"`) — not literal
// values published by Webull, since none are available while authoring this
// offline. They pin the *algorithm* shape so a future edit that silently
// breaks the nonce/host inclusion, the POST-vs-GET body-hash branch, or the
// trailing-"&" key fails loudly here. Swap in a real Webull-published sample
// request/signature pair once available (see design doc §3a).

test("buildSignatureString: sorts host + nonce + params alphabetically", () => {
  const s = buildSignatureString({ host: "api.webull.com", params: { symbol: "AAPL", count: "50" }, nonce: "abc-123" });
  assert.equal(s, "count=50&host=api.webull.com&symbol=AAPL&x-signature-nonce=abc-123");
});

test("buildSignatureString: GET (no body) omits the body-hash segment entirely", () => {
  const s = buildSignatureString({ host: "h", params: {}, nonce: "n" });
  assert.equal(s, "host=h&x-signature-nonce=n");
  const emptyHash = createHash("sha256").update("").digest("hex").toUpperCase();
  assert.ok(!s.includes(emptyHash), "must not hash an empty body for a bodyless GET");
});

test("buildSignatureString: POST appends toUpper(SHA256(body)) as the last segment", () => {
  const body = '{"qty":1}';
  const s = buildSignatureString({ host: "h", params: {}, nonce: "n", body });
  const expectedHash = createHash("sha256").update(body).digest("hex").toUpperCase();
  assert.equal(s, `host=h&x-signature-nonce=n&${expectedHash}`);
});

test("signString: HMAC key is app_secret + literal '&', not the raw secret", () => {
  const sig = signString("some-string", "mysecret");
  const expected = createHmac("sha256", "mysecret&").update("some-string").digest("hex");
  assert.equal(sig, expected);
  const wrongKeySig = createHmac("sha256", "mysecret").update("some-string").digest("hex");
  assert.notEqual(sig, wrongKeySig, "must not sign with the raw secret (missing trailing &)");
});

test("classifyAuthError: timestamp/expired/nonce/clock wording -> clock-skew", () => {
  assert.equal(classifyAuthError({ msg: "Request timestamp expired" }), "clock-skew");
  assert.equal(classifyAuthError({ code: "NONCE_REUSED" }), "clock-skew");
});

test("classifyAuthError: anything else -> bad-key", () => {
  assert.equal(classifyAuthError({ msg: "Invalid app key" }), "bad-key");
  assert.equal(classifyAuthError({}), "bad-key");
});

test("signedFetch throws when no API key is configured", async () => {
  const prevKey = process.env.WEBULL_APP_KEY;
  const prevSecret = process.env.WEBULL_APP_SECRET;
  delete process.env.WEBULL_APP_KEY;
  delete process.env.WEBULL_APP_SECRET;
  try {
    await assert.rejects(() => signedFetch("/x", { baseUrl: "https://example.com" }), /WEBULL_APP_KEY/);
  } finally {
    if (prevKey !== undefined) process.env.WEBULL_APP_KEY = prevKey;
    if (prevSecret !== undefined) process.env.WEBULL_APP_SECRET = prevSecret;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/webull/auth.test.ts`
Expected: FAIL — `./auth` module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/lib/webull/auth.ts`:

```ts
// Shared HMAC-SHA256 request signing for Webull's OpenAPI (data + PaperTrade).
// One module so webull.ts and webull/paperTrade.ts never build two
// independently-maintained signature implementations that could drift apart.
import { createHmac, createHash, randomUUID } from "node:crypto";

export interface SignableRequest {
  host: string;
  params: Record<string, string>;
  body?: string;
  nonce: string;
}

/** Pure: builds the exact string Webull hashes — every query param plus
 *  `host` and `x-signature-nonce`, sorted alphabetically, from one shared
 *  source list (never two independently-maintained lists that could drift
 *  apart). A POST body is appended as `toUpper(SHA256(body))`; a bodyless GET
 *  omits that segment entirely rather than hashing an empty string. */
export function buildSignatureString(req: SignableRequest): string {
  const entries: [string, string][] = [
    ...Object.entries(req.params),
    ["host", req.host],
    ["x-signature-nonce", req.nonce],
  ];
  entries.sort(([a], [b]) => a.localeCompare(b));
  const sorted = entries.map(([k, v]) => `${k}=${v}`).join("&");
  if (req.body) {
    const bodyHash = createHash("sha256").update(req.body).digest("hex").toUpperCase();
    return `${sorted}&${bodyHash}`;
  }
  return sorted;
}

/** Pure: HMAC-SHA256 hex signature. The key is `app_secret + "&"` (a literal
 *  trailing ampersand), not the raw secret — Webull's OpenAPI signing spec. */
export function signString(signatureString: string, appSecret: string): string {
  return createHmac("sha256", `${appSecret}&`).update(signatureString).digest("hex");
}

export type WebullAuthErrorReason = "clock-skew" | "bad-key";

export class WebullAuthError extends Error {
  constructor(message: string, public readonly reason: WebullAuthErrorReason) {
    super(message);
    this.name = "WebullAuthError";
  }
}

/** Pure: classifies a 401 response body as clock-skew (stale timestamp/nonce
 *  — safe to retry once with a fresh one) vs. a bad/revoked key (a real auth
 *  error — alert, don't retry). */
export function classifyAuthError(body: { code?: string; msg?: string }): WebullAuthErrorReason {
  const text = `${body.code ?? ""} ${body.msg ?? ""}`.toLowerCase();
  if (/expired|timestamp|clock|nonce/.test(text)) return "clock-skew";
  return "bad-key";
}

export interface SignedFetchOptions {
  baseUrl: string;
  method?: "GET" | "POST";
  params?: Record<string, string>;
  body?: unknown;
}

async function doSignedFetch(path: string, opts: SignedFetchOptions, retried: boolean): Promise<Response> {
  const appKey = process.env.WEBULL_APP_KEY;
  const appSecret = process.env.WEBULL_APP_SECRET;
  if (!appKey || !appSecret) throw new Error("webull: missing WEBULL_APP_KEY / WEBULL_APP_SECRET");

  const method = opts.method ?? "GET";
  const url = new URL(path, opts.baseUrl);
  const host = url.host;
  const bodyStr = opts.body != null ? JSON.stringify(opts.body) : undefined;
  const nonce = randomUUID();
  // Every call sets its timestamp from call time (never cached) — Webull's
  // signing is timestamp-based and rejects requests outside its clock-skew
  // window, so a stale cached timestamp would fail every subsequent call.
  const params: Record<string, string> = { ...(opts.params ?? {}), appKey, timestamp: String(Date.now()) };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const signatureString = buildSignatureString({ host, params, body: bodyStr, nonce });
  const signature = signString(signatureString, appSecret);

  const res = await fetch(url.toString(), {
    method,
    headers: {
      "x-signature-nonce": nonce,
      "x-app-key": appKey,
      "x-signature": signature,
      ...(bodyStr ? { "content-type": "application/json" } : {}),
    },
    ...(bodyStr ? { body: bodyStr } : {}),
  });

  if (res.status === 401) {
    const errBody = await res.json().catch(() => ({}));
    const reason = classifyAuthError(errBody as { code?: string; msg?: string });
    if (reason === "clock-skew" && !retried) {
      return doSignedFetch(path, opts, true); // resync: fresh timestamp+nonce, retry exactly once
    }
    throw new WebullAuthError(`webull auth failed (${reason}): ${JSON.stringify(errBody)}`, reason);
  }
  return res;
}

/** Signed GET/POST against a Webull OpenAPI host. A clock-skew-classified 401
 *  is retried once with a resynced timestamp; a second failure (or a
 *  bad-key 401) throws WebullAuthError so callers/alerts can tell the two
 *  apart ("your runner's clock is off" vs. "your key is wrong"). */
export async function signedFetch(path: string, opts: SignedFetchOptions): Promise<Response> {
  return doSignedFetch(path, opts, false);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/webull/auth.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/webull/auth.ts src/lib/webull/auth.test.ts
git commit -m "feat: add Webull HMAC-SHA256 request signing module"
```

---

### Task 3: `src/lib/webull/symbols.ts` — symbol → tickerId resolution

**Files:**
- Create: `src/lib/webull/symbols.ts`
- Test: `src/lib/webull/symbols.test.ts`

**Interfaces:**
- Consumes: `signedFetch` from `./auth` (Task 2), `prisma.webullTickerCache` (Task 1).
- Produces: `parseTickerIdResponse(json: unknown, symbol: string): number`, `getTickerId(symbol: string): Promise<number>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/webull/symbols.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTickerIdResponse } from "./symbols";

test("parseTickerIdResponse: matches the result whose symbol equals the query, case-insensitively", () => {
  const json = { data: [{ symbol: "AAPL", tickerId: 913256135 }, { symbol: "AAPLW", tickerId: 999 }] };
  assert.equal(parseTickerIdResponse(json, "aapl"), 913256135);
});

test("parseTickerIdResponse: falls back to the first result when no exact symbol match", () => {
  const json = { data: [{ symbol: "AAPL.US", tickerId: 913256135 }] };
  assert.equal(parseTickerIdResponse(json, "AAPL"), 913256135);
});

test("parseTickerIdResponse: throws when no results or no tickerId", () => {
  assert.throws(() => parseTickerIdResponse({ data: [] }, "AAPL"), /tickerId/);
  assert.throws(() => parseTickerIdResponse({}, "AAPL"), /tickerId/);
  assert.throws(() => parseTickerIdResponse({ data: [{ symbol: "AAPL" }] }, "AAPL"), /tickerId/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/webull/symbols.test.ts`
Expected: FAIL — `./symbols` module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/lib/webull/symbols.ts`:

```ts
// Resolves a stock ticker to Webull's internal numeric tickerId — every
// Webull data/order endpoint keys off this id, not the ticker string.
// Backed by a persistent WebullTickerCache row (not an in-memory Map), since
// tickerId is effectively static per symbol but the exec-stage hook and the
// polling cron are fresh, short-lived processes that share no memory.
import { prisma } from "@/lib/db";
import { signedFetch } from "./auth";

const DATA_HOST = () => process.env.WEBULL_BASE_URL || "https://quotes-api.webullbroker.com"; // confirm host against the live API reference

interface WebullSymbolSearchResult { symbol?: string; tickerId?: number }

/** Pure: extracts the tickerId matching `symbol` from a symbol-search
 *  response body (falling back to the first result on no exact match).
 *  Throws when there's no usable result so the caller doesn't silently cache
 *  a wrong id. */
export function parseTickerIdResponse(json: unknown, symbol: string): number {
  const results = (json as { data?: WebullSymbolSearchResult[] })?.data ?? [];
  const match = results.find((r) => r.symbol?.toUpperCase() === symbol.toUpperCase()) ?? results[0];
  if (!match?.tickerId) throw new Error(`webull: no tickerId found for ${symbol}`);
  return match.tickerId;
}

/** Resolves symbol -> Webull tickerId. Checks the DB cache first; on a miss,
 *  calls Webull's symbol-search endpoint and upserts the result. */
export async function getTickerId(symbol: string): Promise<number> {
  const cached = await prisma.webullTickerCache.findUnique({ where: { symbol } });
  if (cached) return cached.tickerId;

  const res = await signedFetch("/api/openapi/quote/symbol-search", {
    baseUrl: DATA_HOST(),
    method: "GET",
    params: { keyword: symbol },
  });
  if (!res.ok) throw new Error(`webull: symbol-search upstream ${res.status}`);
  const tickerId = parseTickerIdResponse(await res.json(), symbol);

  await prisma.webullTickerCache.upsert({
    where: { symbol },
    update: { tickerId },
    create: { symbol, tickerId },
  });
  return tickerId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/webull/symbols.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/webull/symbols.ts src/lib/webull/symbols.test.ts
git commit -m "feat: add Webull symbol -> tickerId resolution with persistent cache"
```

---

### Task 4: `src/lib/webull.ts` — Webull market-data provider

**Files:**
- Create: `src/lib/webull.ts`
- Test: `src/lib/webull.test.ts`

**Interfaces:**
- Consumes: `signedFetch` from `./webull/auth` (Task 2), `getTickerId` from `./webull/symbols` (Task 3), `CandleResponse`/`Range`/`Interval` from `./yahoo`.
- Produces: `intervalToWebullType(interval: Interval): string`, `rangeToWebullCount(range: Range, interval: Interval): number`, `parseWebullBars(json, symbol, range, interval): CandleResponse`, `fetchWebullCandles(symbol, range?, interval?): Promise<CandleResponse>`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/webull.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { intervalToWebullType, rangeToWebullCount, parseWebullBars, fetchWebullCandles } from "./webull";

test("intervalToWebullType maps every supported interval", () => {
  assert.equal(intervalToWebullType("5m"), "m5");
  assert.equal(intervalToWebullType("15m"), "m15");
  assert.equal(intervalToWebullType("30m"), "m30");
  assert.equal(intervalToWebullType("60m"), "m60");
  assert.equal(intervalToWebullType("1h"), "m60");
  assert.equal(intervalToWebullType("1d"), "d1");
  assert.equal(intervalToWebullType("1wk"), "w1");
});

test("rangeToWebullCount grows monotonically with range and is capped at 2000", () => {
  assert.ok(rangeToWebullCount("3mo", "1d") > rangeToWebullCount("1mo", "1d"));
  assert.ok(rangeToWebullCount("5y", "1d") > rangeToWebullCount("1y", "1d"));
  assert.equal(rangeToWebullCount("max", "5m"), 2000);
  assert.ok(rangeToWebullCount("1d", "1d") >= 1);
});

test("parseWebullBars converts bars to Candle[], sorted ascending by time", () => {
  const json = {
    data: [
      { timestamp: 200, open: 2, high: 4, low: 1.5, close: 3, volume: 200 },
      { timestamp: 100, open: 1, high: 3, low: 0.5, close: 2, volume: 100 },
    ],
  };
  const resp = parseWebullBars(json, "AAPL", "1d", "5m");
  assert.equal(resp.symbol, "AAPL");
  assert.equal(resp.candles.length, 2);
  assert.deepEqual(resp.candles[0], { t: 100, o: 1, h: 3, l: 0.5, c: 2, v: 100 });
  assert.equal(resp.price, 3); // last (latest-timestamp) close after sort
});

test("parseWebullBars drops extended-hours bars so output is RTH-only", () => {
  const json = {
    data: [
      { timestamp: 100, open: 1, high: 3, low: 0.5, close: 2, volume: 100, isExtendedHours: false },
      { timestamp: 200, open: 2, high: 4, low: 1.5, close: 3, volume: 200, isExtendedHours: true },
    ],
  };
  const resp = parseWebullBars(json, "AAPL", "1d", "5m");
  assert.equal(resp.candles.length, 1);
  assert.equal(resp.candles[0].t, 100);
});

test("parseWebullBars throws on empty or all-extended-hours bars (so the router can fall back)", () => {
  assert.throws(() => parseWebullBars({ data: [] }, "AAPL", "1d", "5m"));
  assert.throws(() => parseWebullBars({}, "AAPL", "1d", "5m"));
  assert.throws(() => parseWebullBars({ data: [{ timestamp: 1, open: 1, high: 1, low: 1, close: 1, volume: 1, isExtendedHours: true }] }, "AAPL", "1d", "5m"));
});

test("fetchWebullCandles throws when no API key is configured", async () => {
  const prevKey = process.env.WEBULL_APP_KEY;
  const prevSecret = process.env.WEBULL_APP_SECRET;
  delete process.env.WEBULL_APP_KEY;
  delete process.env.WEBULL_APP_SECRET;
  try {
    await assert.rejects(() => fetchWebullCandles("AAPL", "1d", "5m"), /WEBULL_APP_KEY/);
  } finally {
    if (prevKey !== undefined) process.env.WEBULL_APP_KEY = prevKey;
    if (prevSecret !== undefined) process.env.WEBULL_APP_SECRET = prevSecret;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/webull.test.ts`
Expected: FAIL — `./webull` module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/lib/webull.ts`:

```ts
// Webull market-data provider — same CandleResponse shape as alpaca.ts/
// yahoo.ts so the router is provider-agnostic. Data-only: never touches
// Webull's PaperTrade order APIs (see webull/paperTrade.ts for that).
import type { Candle } from "./indicators";
import type { CandleResponse, Range, Interval } from "./yahoo";
import { signedFetch } from "./webull/auth";
import { getTickerId } from "./webull/symbols";

/** Map our Interval to Webull's bar-history "type" parameter (confirm the
 *  exact enum values against the live API reference before the first
 *  sandbox call). */
export function intervalToWebullType(interval: Interval): string {
  switch (interval) {
    case "5m": return "m5";
    case "15m": return "m15";
    case "30m": return "m30";
    case "60m": return "m60";
    case "1h": return "m60";
    case "1d": return "d1";
    case "1wk": return "w1";
    default: {
      const _exhaustive: never = interval;
      throw new Error(`webull: unsupported interval ${_exhaustive}`);
    }
  }
}

/** Bar count to request for a Range at a given Interval — same day-count/
 *  bars-per-day model as mt5.ts's rangeToBarCount, capped at 2000. */
export function rangeToWebullCount(range: Range, interval: Interval): number {
  const days: Record<Range, number> = {
    "1d": 1, "5d": 5, "1mo": 31, "3mo": 93, "6mo": 186,
    "1y": 366, "2y": 731, "5y": 1827, "max": 7305,
  };
  const barsPerDay: Record<Interval, number> = {
    "5m": 78, "15m": 26, "30m": 13, "60m": 7, "1h": 7, "1d": 1, "1wk": 1 / 7,
  };
  return Math.min(2000, Math.max(1, Math.ceil(days[range] * barsPerDay[interval])));
}

interface WebullBar { timestamp: number; open: number; high: number; low: number; close: number; volume: number; isExtendedHours?: boolean }

/** Pure transform from a Webull bar-history response to CandleResponse.
 *  Drops any bar flagged extended-hours so the output is RTH-only regardless
 *  of what the request parameters achieved, and sorts ascending by time.
 *  Throws when there are no RTH bars so the router can fall back. */
export function parseWebullBars(json: unknown, symbol: string, range: Range, interval: Interval): CandleResponse {
  const raw = (json as { data?: WebullBar[] })?.data ?? [];
  const rth = raw.filter((b) => !b.isExtendedHours);
  if (rth.length === 0) throw new Error("webull: no RTH bars for symbol");
  const candles: Candle[] = rth
    .map((b) => ({ t: Math.floor(b.timestamp), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume ?? 0 }))
    .sort((a, b) => a.t - b.t);
  return { symbol, range, interval, price: candles.at(-1)?.c, candles };
}

const DATA_HOST = () => process.env.WEBULL_BASE_URL || "https://quotes-api.webullbroker.com"; // confirm host against the live API reference

/** Fetch candles from Webull. Throws on missing credentials, non-OK status,
 *  or an empty RTH bar set — callers fall back to Alpaca/Yahoo. */
export async function fetchWebullCandles(symbol: string, range: Range = "1mo", interval: Interval = "1h"): Promise<CandleResponse> {
  if (!process.env.WEBULL_APP_KEY || !process.env.WEBULL_APP_SECRET) {
    throw new Error("webull: missing WEBULL_APP_KEY / WEBULL_APP_SECRET");
  }
  const tickerId = await getTickerId(symbol);
  const res = await signedFetch("/api/openapi/quote/kline", {
    baseUrl: DATA_HOST(),
    method: "GET",
    params: {
      tickerId: String(tickerId),
      type: intervalToWebullType(interval),
      count: String(rangeToWebullCount(range, interval)),
      // Adjusted, RTH-only bars — matches the convention Alpaca/Yahoo already
      // return; exact param names need confirming against the live docs.
      extendTrading: "0",
      adjustType: "1",
    },
  });
  if (!res.ok) throw new Error(`webull upstream ${res.status}`);
  return parseWebullBars(await res.json(), symbol, range, interval);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/webull.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/webull.ts src/lib/webull.test.ts
git commit -m "feat: add Webull candle data provider"
```

---

### Task 5: `src/lib/marketData.ts` — insert Webull into the provider router

**Files:**
- Modify: `src/lib/marketData.ts:1-153` (add import, `shouldTryWebull`, insert into `fetchCandles` and `fetchCandlesBatch`)
- Test: `src/lib/marketData.test.ts:1-41` (extend)

**Interfaces:**
- Consumes: `fetchWebullCandles` from `./webull` (Task 4).
- Produces: `shouldTryWebull(env: { WEBULL_APP_KEY?: string; WEBULL_APP_SECRET?: string }): boolean`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/marketData.test.ts` (after the existing `shouldTryAlpaca` test):

```ts
import { shouldTryWebull } from "./marketData";

test("shouldTryWebull is true only when both key and secret are present", () => {
  assert.equal(shouldTryWebull({ WEBULL_APP_KEY: "k", WEBULL_APP_SECRET: "s" }), true);
  assert.equal(shouldTryWebull({ WEBULL_APP_KEY: "k" }), false);
  assert.equal(shouldTryWebull({ WEBULL_APP_SECRET: "s" }), false);
  assert.equal(shouldTryWebull({}), false);
});
```

(Add `shouldTryWebull` to the existing top-of-file import list instead of a second `import` line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/marketData.test.ts`
Expected: FAIL — `shouldTryWebull` is not exported yet.

- [ ] **Step 3: Implement `shouldTryWebull` and insert Webull into `fetchCandles`**

In `src/lib/marketData.ts`, add the import (after the existing `fetchAlpacaCandles` import on line 6):

```ts
import { fetchWebullCandles } from "./webull";
```

Add the decision function right after `shouldTryAlpaca` (after line 13):

```ts
/** Pure decision: try Webull only when both credentials are present. */
export function shouldTryWebull(env: { WEBULL_APP_KEY?: string; WEBULL_APP_SECRET?: string }): boolean {
  return Boolean(env.WEBULL_APP_KEY && env.WEBULL_APP_SECRET);
}
```

In `fetchCandles` (currently lines 85-122), insert a Webull attempt between the MT5 block and the Alpaca block:

```ts
  const fallbackTicker = toFallbackTicker(symbol, mt5Ticker);

  const webullEnv = { WEBULL_APP_KEY: process.env.WEBULL_APP_KEY, WEBULL_APP_SECRET: process.env.WEBULL_APP_SECRET };
  if (shouldTryWebull(webullEnv)) {
    try {
      return await fetchWebullCandles(fallbackTicker, range, interval);
    } catch (e) {
      console.warn(`marketData: Webull miss for ${symbol} (${e instanceof Error ? e.message : e}); using Alpaca/Yahoo`);
    }
  }

  const env = {
    ALPACA_KEY: process.env.ALPACA_KEY,
    ALPACA_SECRET: process.env.ALPACA_SECRET,
  };
```

(This replaces the existing `const env = {...}` block that previously came right after `const fallbackTicker = ...` — the rest of `fetchCandles` is unchanged.)

- [ ] **Step 4: Add concurrency-limited Webull fetching to `fetchCandlesBatch`**

Webull has no documented multi-symbol batch endpoint (unlike Alpaca), so a cold `WebullTickerCache` plus a 30-50 symbol universe scan would otherwise issue ~100 requests in a few seconds and hit Webull's ~60 req/60s limit. Add a small concurrency-limited pool helper above `fetchCandlesBatch` (before line 130):

```ts
/** Runs `fn` over `items` with at most `limit` concurrent in-flight calls.
 *  A failed item resolves to undefined rather than rejecting the whole pool. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { results[i] = await fn(items[i]); } catch { results[i] = undefined; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const WEBULL_BATCH_CONCURRENCY = 8;
```

Then, in `fetchCandlesBatch` (currently lines 130-152), insert a Webull pass before the existing Alpaca block:

```ts
export async function fetchCandlesBatch(
  symbols: string[],
  range: Range = "1mo",
  interval: Interval = "1d",
): Promise<Map<string, CandleResponse>> {
  const out = new Map<string, CandleResponse>();

  const webullEnv = { WEBULL_APP_KEY: process.env.WEBULL_APP_KEY, WEBULL_APP_SECRET: process.env.WEBULL_APP_SECRET };
  if (shouldTryWebull(webullEnv)) {
    const fetched = await mapWithConcurrency(symbols, WEBULL_BATCH_CONCURRENCY, (sym) => fetchWebullCandles(sym, range, interval));
    fetched.forEach((resp, i) => { if (resp) out.set(symbols[i], resp); });
  }

  const env = { ALPACA_KEY: process.env.ALPACA_KEY, ALPACA_SECRET: process.env.ALPACA_SECRET };
  if (shouldTryAlpaca(env)) {
    try {
      const remaining = symbols.filter((s) => !out.has(s));
      for (const [sym, resp] of await fetchAlpacaCandlesBatch(remaining, range, interval)) out.set(sym, resp);
    } catch (e) {
      console.warn(`marketData: Alpaca batch failed (${e instanceof Error ? e.message : e}); using Yahoo per-symbol`);
    }
  }

  // Fill whatever Webull/Alpaca didn't return (non-equities, gaps) one at a time via Yahoo.
  for (const sym of symbols) {
    if (out.has(sym)) continue;
    try { out.set(sym, await fetchYahooCandles(sym, range, interval)); } catch { /* skip */ }
  }
  return out;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test src/lib/marketData.test.ts`
Expected: PASS, all tests (existing + new `shouldTryWebull` test).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck` — expect PASS.

```bash
git add src/lib/marketData.ts src/lib/marketData.test.ts
git commit -m "feat: insert Webull into the market-data provider router"
```

---

### Task 6: `src/lib/webull/paperTrade.ts` — PaperTrade order client

**Files:**
- Create: `src/lib/webull/paperTrade.ts`
- Test: `src/lib/webull/paperTrade.test.ts`

**Interfaces:**
- Consumes: `signedFetch` from `./auth` (Task 2), `getTickerId` from `./symbols` (Task 3).
- Produces: `floorQty(qty: number): number | null`, `isRegularTradingHours(now: Date): boolean`, `buildBracketOrderPayload(input): object`, `deriveExitFromChildOrder(child, entryFilledQty): ExitDerivation`, `placeWebullBracketOrder(input: BracketOrderInput): Promise<PlaceShadowOrderResult>`, `getWebullOrderStatus(ids: WebullBracketOrderIds): Promise<WebullBracketStatus>`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/webull/paperTrade.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { floorQty, isRegularTradingHours, buildBracketOrderPayload, deriveExitFromChildOrder, placeWebullBracketOrder } from "./paperTrade";

test("floorQty floors to a whole share, and returns null (skip) when < 1", () => {
  assert.equal(floorQty(7.027), 7);
  assert.equal(floorQty(1.99), 1);
  assert.equal(floorQty(0.9), null);
  assert.equal(floorQty(0), null);
});

test("isRegularTradingHours: true for a Tuesday 10:00 ET instant, false for 8:00 ET and weekends", () => {
  // 2026-06-16 is a Tuesday. 14:00 UTC = 10:00 ET (June, EDT = UTC-4).
  assert.equal(isRegularTradingHours(new Date("2026-06-16T14:00:00Z")), true);
  // 12:00 UTC = 08:00 ET — before the 09:30 open.
  assert.equal(isRegularTradingHours(new Date("2026-06-16T12:00:00Z")), false);
  // 2026-06-20 is a Saturday, same 14:00 UTC / 10:00 ET wall-clock time.
  assert.equal(isRegularTradingHours(new Date("2026-06-20T14:00:00Z")), false);
});

test("buildBracketOrderPayload: parent is always MARKET, TIF is always GTC, qty is floored", () => {
  const payload = buildBracketOrderPayload({
    symbol: "AAPL", side: "long", qty: 7.9, entry: 150, sl: 145, tp: 160,
    accountId: "acct-1", tickerId: 913256135,
  });
  assert.equal(payload.orderType, "MARKET");
  assert.equal(payload.timeInForce, "GTC");
  assert.equal(payload.quantity, 7);
  assert.equal(payload.action, "BUY");
  assert.equal(payload.bracket.stopLoss.stopPrice, 145);
  assert.equal(payload.bracket.takeProfit.limitPrice, 160);
});

test("buildBracketOrderPayload: short side maps to SELL", () => {
  const payload = buildBracketOrderPayload({ symbol: "AAPL", side: "short", qty: 2, entry: 150, sl: 155, tp: 140, accountId: "a", tickerId: 1 });
  assert.equal(payload.action, "SELL");
});

test("buildBracketOrderPayload: throws when the floored quantity is < 1 (caller must check floorQty first)", () => {
  assert.throws(() => buildBracketOrderPayload({ symbol: "AAPL", side: "long", qty: 0.5, entry: 1, sl: 1, tp: 1, accountId: "a", tickerId: 1 }), /qty < 1/);
});

test("deriveExitFromChildOrder: null/no-executions child -> not closed, no exit data", () => {
  const d = deriveExitFromChildOrder(null, 10);
  assert.deepEqual(d, { exitPrice: null, exitFilledQty: 0, exitReason: null, isClosed: false });
});

test("deriveExitFromChildOrder: partial fill (qty < entryFilledQty, non-terminal status) stays open, VWAP over executions so far", () => {
  const child = { status: "PARTIALLY_FILLED", executions: [{ qty: 4, price: 150 }], kind: "TAKE_PROFIT" as const };
  const d = deriveExitFromChildOrder(child, 10);
  assert.equal(d.exitPrice, 150);
  assert.equal(d.exitFilledQty, 4);
  assert.equal(d.isClosed, false, "must stay non-closed while exitFilledQty < entryFilledQty");
});

test("deriveExitFromChildOrder: multiple partial executions produce the volume-weighted average price", () => {
  const child = { status: "PARTIALLY_FILLED", executions: [{ qty: 4, price: 150 }, { qty: 6, price: 152 }], kind: "STOP_LOSS" as const };
  const d = deriveExitFromChildOrder(child, 10);
  // VWAP = (4*150 + 6*152) / 10 = 151.2
  assert.ok(Math.abs(d.exitPrice! - 151.2) < 1e-9);
  assert.equal(d.exitFilledQty, 10);
  assert.equal(d.isClosed, true, "exitFilledQty === entryFilledQty -> closed");
  assert.equal(d.exitReason, "STOP_LOSS");
});

test("deriveExitFromChildOrder: closed once the child order itself reports FILLED, even before qty check", () => {
  const child = { status: "FILLED", executions: [{ qty: 10, price: 150 }], kind: "TAKE_PROFIT" as const };
  const d = deriveExitFromChildOrder(child, 10);
  assert.equal(d.isClosed, true);
});

test("placeWebullBracketOrder: skips (does not call the network) outside RTH", async () => {
  const result = await placeWebullBracketOrder(
    { symbol: "AAPL", side: "long", qty: 5, entry: 150, sl: 145, tp: 160, accountId: "a" },
    { now: new Date("2026-06-16T12:00:00Z") }, // 08:00 ET, before open
  );
  assert.deepEqual(result, { kind: "skipped", reason: "outside-rth" });
});

test("placeWebullBracketOrder: skips (does not call the network) when qty floors under 1 share", async () => {
  const result = await placeWebullBracketOrder(
    { symbol: "AAPL", side: "long", qty: 0.4, entry: 150, sl: 145, tp: 160, accountId: "a" },
    { now: new Date("2026-06-16T14:00:00Z") }, // 10:00 ET, within RTH
  );
  assert.deepEqual(result, { kind: "skipped", reason: "qty-under-1" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/webull/paperTrade.test.ts`
Expected: FAIL — `./paperTrade` module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/lib/webull/paperTrade.ts`:

```ts
// Webull PaperTrade order client — places/checks risk-free bracket orders.
// Isolated on top of the shared auth.ts so a later live-trading phase can
// reuse the request-building logic behind a different base URL/account
// without touching this module.
import { signedFetch } from "./auth";
import { getTickerId } from "./symbols";

/** Pure: floors `qty` to a whole share (PaperTrade bracket orders reject
 *  fractional shares, unlike NEXMIND's own risk-based sizing). Returns null
 *  when the floored quantity is < 1 — the caller must skip, not send. */
export function floorQty(qty: number): number | null {
  const floored = Math.floor(qty);
  return floored < 1 ? null : floored;
}

/** Pure (given `now`): true during 09:30-16:00 ET on a weekday. Bracket
 *  orders are typically rejected outside regular trading hours. */
export function isRegularTradingHours(now: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export interface BracketOrderInput {
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry: number;
  sl: number;
  tp: number;
  accountId: string;
}

/** Pure: constructs the bracket-order request body. Parent is always
 *  MARKET (not LIMIT) — a LIMIT parent could gap-open unfilled and desync
 *  from the Trade NEXMIND's simulation already recorded as entered; the
 *  point of shadow execution is to observe real fills/slippage. TIF is
 *  always GTC — NEXMIND's swing trades are multi-day, and a DAY order's
 *  unfilled entry or armed SL/TP would be auto-cancelled at the close.
 *  Throws if qty floors under 1 — callers must check floorQty() first. */
export function buildBracketOrderPayload(input: BracketOrderInput & { tickerId: number }) {
  const quantity = floorQty(input.qty);
  if (quantity == null) throw new Error("webull: qty < 1 share, cannot build order payload");
  return {
    accountId: input.accountId,
    tickerId: input.tickerId,
    action: input.side === "long" ? "BUY" : "SELL",
    orderType: "MARKET",
    quantity,
    timeInForce: "GTC",
    bracket: {
      stopLoss: { orderType: "STOP", stopPrice: input.sl },
      takeProfit: { orderType: "LIMIT", limitPrice: input.tp },
    },
  };
}

export type PlaceShadowOrderResult =
  | { kind: "placed"; parentOrderId: string; slOrderId: string | null; tpOrderId: string | null }
  | { kind: "skipped"; reason: "outside-rth" | "qty-under-1" }
  | { kind: "error"; message: string };

/** Places a shadow bracket order against Webull's PaperTrade account. Never
 *  throws — always resolves to a PlaceShadowOrderResult so callers can stay
 *  fully fail-open. `opts.now` is injectable for the RTH check (defaults to
 *  the real current time). */
export async function placeWebullBracketOrder(
  input: BracketOrderInput,
  opts: { now?: Date } = {},
): Promise<PlaceShadowOrderResult> {
  const now = opts.now ?? new Date();
  if (!isRegularTradingHours(now)) return { kind: "skipped", reason: "outside-rth" };
  if (floorQty(input.qty) == null) return { kind: "skipped", reason: "qty-under-1" };

  try {
    const tickerId = await getTickerId(input.symbol);
    const payload = buildBracketOrderPayload({ ...input, tickerId });
    const res = await signedFetch("/api/paper/order/place", {
      baseUrl: process.env.WEBULL_PAPER_BASE_URL || "https://act.webulltrade.com",
      method: "POST",
      body: payload,
    });
    if (!res.ok) return { kind: "error", message: `webull paper order upstream ${res.status}` };
    const json = (await res.json()) as { orderId?: string; slOrderId?: string; tpOrderId?: string };
    if (!json.orderId) return { kind: "error", message: "webull paper order: missing orderId in response" };
    return { kind: "placed", parentOrderId: json.orderId, slOrderId: json.slOrderId ?? null, tpOrderId: json.tpOrderId ?? null };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export interface WebullBracketOrderIds {
  parentOrderId: string;
  slOrderId: string | null;
  tpOrderId: string | null;
}

interface WebullExecution { qty: number; price: number }
interface ChildOrderStatus { status: string; executions: WebullExecution[]; kind: "TAKE_PROFIT" | "STOP_LOSS" }

export interface ExitDerivation {
  exitPrice: number | null;
  exitFilledQty: number;
  exitReason: "TAKE_PROFIT" | "STOP_LOSS" | null;
  isClosed: boolean;
}

const CHILD_TERMINAL_STATES = new Set(["FILLED", "CANCELLED"]);

/** Pure: derives exit price/qty/reason from whichever child order (SL or TP)
 *  actually triggered. exitPrice is the volume-weighted average fill price
 *  across that child's (possibly multiple, on thin liquidity) executions —
 *  not just the first or last fill. isClosed only becomes true once the
 *  filled quantity reaches entryFilledQty, or the child order itself
 *  reports a terminal state — never inferred from "a fill was seen." */
export function deriveExitFromChildOrder(child: ChildOrderStatus | null, entryFilledQty: number): ExitDerivation {
  if (!child || child.executions.length === 0) {
    return { exitPrice: null, exitFilledQty: 0, exitReason: null, isClosed: false };
  }
  const totalQty = child.executions.reduce((s, e) => s + e.qty, 0);
  const vwap = child.executions.reduce((s, e) => s + e.qty * e.price, 0) / totalQty;
  const isClosed = totalQty >= entryFilledQty || CHILD_TERMINAL_STATES.has(child.status);
  return { exitPrice: vwap, exitFilledQty: totalQty, exitReason: child.kind, isClosed };
}

export interface WebullBracketStatus {
  entryFillPrice: number | null;
  entryFilledQty: number | null;
  entryFilledAt: Date | null;
  exitPrice: number | null;
  exitFilledQty: number;
  exitReason: "TAKE_PROFIT" | "STOP_LOSS" | null;
  isClosed: boolean;
}

async function fetchChildOrder(orderId: string, kind: "TAKE_PROFIT" | "STOP_LOSS", baseUrl: string): Promise<ChildOrderStatus> {
  const res = await signedFetch(`/api/paper/order/${orderId}`, { baseUrl, method: "GET" });
  if (!res.ok) throw new Error(`webull child order-status upstream ${res.status}`);
  const json = (await res.json()) as { status?: string; executions?: WebullExecution[] };
  return { status: json.status ?? "UNKNOWN", executions: json.executions ?? [], kind };
}

/** Checks the parent AND both child orders — a parent stuck at FILLED
 *  forever would hide the real outcome, since exit price/time/reason live on
 *  whichever child order fired (the other is auto-CANCELLED by the OCO
 *  pair). */
export async function getWebullOrderStatus(ids: WebullBracketOrderIds): Promise<WebullBracketStatus> {
  const baseUrl = process.env.WEBULL_PAPER_BASE_URL || "https://act.webulltrade.com";
  const parentRes = await signedFetch(`/api/paper/order/${ids.parentOrderId}`, { baseUrl, method: "GET" });
  if (!parentRes.ok) throw new Error(`webull order-status upstream ${parentRes.status}`);
  const parent = (await parentRes.json()) as { filledPrice?: number; filledQty?: number; filledAt?: string };
  const entryFilledQty = parent.filledQty ?? 0;

  const slChild = ids.slOrderId ? await fetchChildOrder(ids.slOrderId, "STOP_LOSS", baseUrl) : null;
  const tpChild = ids.tpOrderId ? await fetchChildOrder(ids.tpOrderId, "TAKE_PROFIT", baseUrl) : null;
  const triggered = (slChild && slChild.executions.length > 0) ? slChild : (tpChild && tpChild.executions.length > 0) ? tpChild : null;
  const exit = deriveExitFromChildOrder(triggered, entryFilledQty);

  return {
    entryFillPrice: parent.filledPrice ?? null,
    entryFilledQty: parent.filledQty ?? null,
    entryFilledAt: parent.filledAt ? new Date(parent.filledAt) : null,
    exitPrice: exit.exitPrice,
    exitFilledQty: exit.exitFilledQty,
    exitReason: exit.exitReason,
    isClosed: exit.isClosed,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/webull/paperTrade.test.ts`
Expected: PASS, all 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/webull/paperTrade.ts src/lib/webull/paperTrade.test.ts
git commit -m "feat: add Webull PaperTrade bracket-order client"
```

---

### Task 7: `src/lib/webull/shadowOrderStore.ts` — guarded DB write layer

**Files:**
- Create: `src/lib/webull/shadowOrderStore.ts`
- Test: `src/lib/webull/shadowOrderStore.test.ts`

**Interfaces:**
- Consumes: `prisma.webullShadowOrder` (Task 1).
- Produces: `canTransitionShadowOrderStatus(current: string, next: string): boolean`, `createShadowOrder(tradeId, parentOrderId, slOrderId, tpOrderId): Promise<void>`, `applyShadowOrderUpdate(tradeId: number, update: ShadowOrderStatusUpdate): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/webull/shadowOrderStore.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransitionShadowOrderStatus } from "./shadowOrderStore";

test("canTransitionShadowOrderStatus: non-terminal -> anything is always allowed", () => {
  assert.equal(canTransitionShadowOrderStatus("pending", "open"), true);
  assert.equal(canTransitionShadowOrderStatus("open", "filled"), true);
  assert.equal(canTransitionShadowOrderStatus("filled", "closed"), true);
});

test("canTransitionShadowOrderStatus: terminal -> a different status is rejected (the round-3 monotonicity bug)", () => {
  // An out-of-order cron response marking a row "filled" after it's already
  // "closed" (with exitPrice recorded) must not revert it and lose exit data.
  assert.equal(canTransitionShadowOrderStatus("closed", "filled"), false);
  assert.equal(canTransitionShadowOrderStatus("cancelled", "open"), false);
  assert.equal(canTransitionShadowOrderStatus("rejected", "pending"), false);
});

test("canTransitionShadowOrderStatus: terminal -> the SAME terminal status is allowed (field-only corrections)", () => {
  // e.g. a later, more complete exitPrice report for an already-closed row.
  assert.equal(canTransitionShadowOrderStatus("closed", "closed"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/webull/shadowOrderStore.test.ts`
Expected: FAIL — `./shadowOrderStore` module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/lib/webull/shadowOrderStore.ts`:

```ts
// Every write to WebullShadowOrder goes through this module so an
// out-of-order cron response (the lightweight poll and the swing-scan
// backstop can overlap) can never revert a row out of a terminal status
// once reached, silently losing recorded exit data.
import { prisma } from "@/lib/db";

const TERMINAL_STATUSES = new Set(["closed", "cancelled", "rejected"]);

/** Pure: true when moving from `current` to `next` is allowed. Once a row is
 *  terminal, only staying at the SAME terminal status is allowed (so a
 *  later, more complete field correction can still be written) — moving to
 *  any different status, terminal or not, is rejected. */
export function canTransitionShadowOrderStatus(current: string, next: string): boolean {
  if (!TERMINAL_STATUSES.has(current)) return true;
  return current === next;
}

export interface ShadowOrderStatusUpdate {
  status: string;
  entryFillPrice?: number | null;
  entryFilledQty?: number | null;
  entryFilledAt?: Date | null;
  exitPrice?: number | null;
  exitReason?: string | null;
  exitFilledQty?: number | null;
  closedAt?: Date | null;
  lastError?: string | null;
}

/** Applies `update` to the WebullShadowOrder for `tradeId`, rejecting (no-op)
 *  any write that would move `status` away from a terminal value. Returns
 *  true if the write was applied, false if it was rejected by the guard or
 *  no row exists yet. */
export async function applyShadowOrderUpdate(tradeId: number, update: ShadowOrderStatusUpdate): Promise<boolean> {
  const row = await prisma.webullShadowOrder.findUnique({ where: { tradeId }, select: { status: true } });
  if (!row) return false;
  if (!canTransitionShadowOrderStatus(row.status, update.status)) return false;
  await prisma.webullShadowOrder.update({ where: { tradeId }, data: update });
  return true;
}

/** Creates the WebullShadowOrder row right after a successful placement. */
export async function createShadowOrder(
  tradeId: number,
  parentOrderId: string,
  slOrderId: string | null,
  tpOrderId: string | null,
): Promise<void> {
  await prisma.webullShadowOrder.create({
    data: { tradeId, parentOrderId, slOrderId, tpOrderId, status: "open" },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/webull/shadowOrderStore.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/webull/shadowOrderStore.ts src/lib/webull/shadowOrderStore.test.ts
git commit -m "feat: add guarded WebullShadowOrder write layer with terminal-state monotonicity"
```

---

### Task 8: `settings.ts` helper + `engine.ts` exec-stage hook

**Files:**
- Modify: `src/lib/settings.ts:43-49` (add `isWebullShadowEnabled`)
- Modify: `src/lib/trading/engine.ts:1-21` (imports), `src/lib/trading/engine.ts:280-308` (exec stage + new helper)

**Interfaces:**
- Consumes: `placeWebullBracketOrder` from `@/lib/webull/paperTrade` (Task 6), `createShadowOrder` from `@/lib/webull/shadowOrderStore` (Task 7), `sendDiscordNotification` from `@/lib/notify/discord`.
- Produces: `isWebullShadowEnabled(portfolioId: number): Promise<boolean>` (settings.ts); engine.ts's exec stage now appends a `webull-shadow` `TickStep` when the portfolio has shadow mode on.

- [ ] **Step 1: Add `isWebullShadowEnabled` to `settings.ts`**

In `src/lib/settings.ts`, right after `getKillSwitchReason` (after line 49):

```ts
export async function isWebullShadowEnabled(portfolioId: number): Promise<boolean> {
  return (await getPortfolio(portfolioId)).webullShadowEnabled;
}
```

No new test file — this one-line DB-backed getter follows the exact same untested-wrapper pattern as `isKillSwitchOn` right above it, which also has no dedicated test.

- [ ] **Step 2: Add imports to `engine.ts`**

In `src/lib/trading/engine.ts`, add to the import block (after the existing `getCurrentDrawdownPct, getCurrentEquity` import on line 21):

```ts
import { isWebullShadowEnabled } from "@/lib/settings";
import { placeWebullBracketOrder } from "@/lib/webull/paperTrade";
import { createShadowOrder } from "@/lib/webull/shadowOrderStore";
import { sendDiscordNotification } from "@/lib/notify/discord";
```

(`isWebullShadowEnabled` is a *named* addition to the existing `@/lib/settings` import list on line 13 — merge it into that line rather than adding a duplicate import statement.)

- [ ] **Step 3: Add the `placeWebullShadow` helper**

In `src/lib/trading/engine.ts`, add this function in the `// ---- helpers ----` section (after `fetchDailyReturns`, before the `// ---- mock path ----` comment, i.e. after the current line 332):

```ts
/** Places the Webull shadow order for a just-created Trade, never throwing —
 *  a Webull outage/rate-limit/auth failure must never affect the real
 *  (simulated) Trade. Returns the note appended to decisionLog. */
async function placeWebullShadow(
  tradeId: number, symbol: string, side: "long" | "short", qty: number, entry: number, sl: number, tp: number,
): Promise<string> {
  try {
    const result = await placeWebullBracketOrder({
      symbol, side, qty, entry, sl, tp,
      accountId: process.env.WEBULL_PAPER_ACCOUNT_ID ?? "",
    });

    if (result.kind === "skipped") {
      return `skipped: ${result.reason === "outside-rth" ? "outside RTH" : "qty < 1 share"}`;
    }

    if (result.kind === "error") {
      // INSUFFICIENT_FUNDS is expected once the PaperTrade account's simulated
      // buying power is used up by repeated shadow orders — log it but don't
      // spam Discord; any other failure (bad/revoked key, outage) still alerts.
      if (/insufficient.?funds/i.test(result.message)) {
        console.log(`[webull-shadow] insufficient funds for ${symbol} (trade#${tradeId})`);
      } else {
        await sendDiscordNotification(`Webull shadow order failed for ${symbol} (trade#${tradeId}): ${result.message}`, "warning");
      }
      return `error: ${result.message}`;
    }

    try {
      await createShadowOrder(tradeId, result.parentOrderId, result.slOrderId, result.tpOrderId);
      return `placed: parentOrderId=${result.parentOrderId}`;
    } catch (dbErr) {
      // Orphan-order mitigation: Webull placed the order but the DB write
      // failed — log everything needed for a human to find/cancel it by hand
      // in the Webull UI, since no row will track it.
      await sendDiscordNotification(
        `Webull shadow order placed for ${symbol} (trade#${tradeId}) but the DB write failed — ` +
          `parentOrderId=${result.parentOrderId} slOrderId=${result.slOrderId ?? "?"} tpOrderId=${result.tpOrderId ?? "?"}: ${String(dbErr)}`,
        "critical",
      );
      return `orphaned: parentOrderId=${result.parentOrderId} (DB write failed: ${String(dbErr)})`;
    }
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}
```

- [ ] **Step 4: Hook it into the exec stage**

In `src/lib/trading/engine.ts`, replace the current end of `runTradeTick` (lines 305-308):

```ts
  await prisma.signal.update({ where: { id: signal.id }, data: { status: "executed" } });

  return { symbol, outcome: "executed", steps, tradeId: trade.id, costUsd };
}
```

with:

```ts
  await prisma.signal.update({ where: { id: signal.id }, data: { status: "executed" } });

  // Phase 2: risk-free shadow order into Webull's PaperTrade, purely
  // observational — awaited so it completes before this short-lived process
  // exits, but never throws into this path and never alters `trade`/`steps`
  // beyond appending its own note.
  if (await isWebullShadowEnabled(portfolioId)) {
    const shadowNote = await placeWebullShadow(trade.id, symbol, hawk.side, lot, fillEntry, levels.sl, levels.tp1);
    steps.push({ stage: "webull-shadow", note: shadowNote });
    // decisionLog was already written inside prisma.trade.create above, but
    // trade.id (needed for WebullShadowOrder.tradeId) didn't exist until that
    // call resolved — so the webull-shadow step can only be appended now, via
    // a follow-up update.
    await prisma.trade.update({ where: { id: trade.id }, data: { decisionLog: JSON.stringify(steps) } });
  }

  return { symbol, outcome: "executed", steps, tradeId: trade.id, costUsd };
}
```

- [ ] **Step 5: Run the existing engine tests and typecheck**

Run: `npx tsx --test src/lib/trading/engine.test.ts && npm run typecheck`
Expected: PASS — `engine.test.ts` only imports the pure `resolveExitOverride`/`minRiskRewardFor`/`buildRLState` (unchanged), so this step is a regression check, not new coverage; the new `webull-shadow` wiring is exercised end-to-end by `paperTrade.test.ts` and `shadowOrderStore.test.ts`'s pure-function coverage instead, matching how `rl-shadow`'s wiring is likewise untested directly in `engine.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/settings.ts src/lib/trading/engine.ts
git commit -m "feat: hook Webull shadow-order placement into the exec stage"
```

---

### Task 9: Shadow-order polling — module, script, and GitHub Actions cron

**Files:**
- Create: `src/lib/webull/pollShadowOrders.ts`
- Create: `scripts/poll-webull-shadow-orders.mts`
- Create: `.github/workflows/poll-webull-shadow-orders.yml`

**Interfaces:**
- Consumes: `getWebullOrderStatus` from `./paperTrade` (Task 6), `applyShadowOrderUpdate` from `./shadowOrderStore` (Task 7).
- Produces: `pollOpenShadowOrders(): Promise<PollSummary>` where `PollSummary = { checked: number; updated: number; errors: number }` — consumed by Task 10 (swing-scan backstop).

- [ ] **Step 1: Write `pollShadowOrders.ts`**

No new pure logic to unit-test here beyond what Tasks 6-7 already cover (`deriveExitFromChildOrder`, `canTransitionShadowOrderStatus`) — this module is glue that sweeps rows and calls those already-tested functions, following the same untested-DB-wrapper convention as `getCurrentDrawdownPct` etc.

Create `src/lib/webull/pollShadowOrders.ts`:

```ts
// Sweeps every non-terminal WebullShadowOrder, fetches its live status from
// Webull, and applies the result through the monotonicity-guarded update
// layer. Called by both the dedicated lightweight cron and the swing-scan
// cron (as a backstop) — safe under overlap since applyShadowOrderUpdate
// rejects any write that would move a row's status backward out of terminal.
import { prisma } from "@/lib/db";
import { getWebullOrderStatus } from "./paperTrade";
import { applyShadowOrderUpdate } from "./shadowOrderStore";

export interface PollSummary { checked: number; updated: number; errors: number }

export async function pollOpenShadowOrders(): Promise<PollSummary> {
  const rows = await prisma.webullShadowOrder.findMany({
    where: { status: { in: ["pending", "open", "filled"] } },
  });

  let updated = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      const s = await getWebullOrderStatus({ parentOrderId: row.parentOrderId, slOrderId: row.slOrderId, tpOrderId: row.tpOrderId });
      const nextStatus = s.isClosed ? "closed" : s.entryFilledQty != null ? "filled" : "open";
      const applied = await applyShadowOrderUpdate(row.tradeId, {
        status: nextStatus,
        entryFillPrice: s.entryFillPrice,
        entryFilledQty: s.entryFilledQty,
        entryFilledAt: s.entryFilledAt,
        exitPrice: s.exitPrice,
        exitReason: s.exitReason,
        exitFilledQty: s.exitFilledQty,
        closedAt: s.isClosed ? new Date() : null,
      });
      if (applied) updated++;
    } catch (e) {
      errors++;
      await prisma.webullShadowOrder
        .update({ where: { id: row.id }, data: { lastError: e instanceof Error ? e.message : String(e) } })
        .catch(() => { /* best-effort — don't let a logging failure mask the original error */ });
    }
  }
  return { checked: rows.length, updated, errors };
}
```

- [ ] **Step 2: Write the CLI script**

Create `scripts/poll-webull-shadow-orders.mts`:

```ts
// Lightweight cron: sweeps WebullShadowOrder rows still pending/open/filled,
// polls Webull for fill/exit status, and applies updates through the
// monotonicity-guarded update layer. Cheap — a handful of GET calls, not a
// scan. Also invoked as a backstop from the swing-scan cron (see runScan.ts).
// Usage: node --import tsx scripts/poll-webull-shadow-orders.mts
import { prisma } from "@/lib/db";
import { pollOpenShadowOrders } from "../src/lib/webull/pollShadowOrders";

pollOpenShadowOrders()
  .then((summary) => console.log(`webull shadow poll: ${summary.checked} checked, ${summary.updated} updated, ${summary.errors} errors`))
  .catch((e) => { console.error(`FATAL ${String(e)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 3: Write the GitHub Actions workflow**

Create `.github/workflows/poll-webull-shadow-orders.yml`:

```yaml
name: Webull shadow-order poll

# Lightweight cron for the risk-free Webull PaperTrade shadow orders placed
# by the exec-stage hook (see engine.ts / docs/superpowers/specs/2026-08-14-
# webull-data-provider-and-papertrade-shadow-design.md). Every 20 minutes
# during (a generous window around) US market hours — GitHub Actions cron
# schedules are not exact and commonly slip late, so polling logic compares
# against each row's own timestamps rather than assuming a fixed cadence.
# No-op (0 rows checked) when WEBULL_APP_KEY isn't set as a repo secret.
on:
  schedule:
    - cron: "*/20 13-21 * * 1-5" # 13:00-21:59 UTC ~= 09:00-17:59 ET, weekdays
  workflow_dispatch: {}

jobs:
  poll:
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
      WEBULL_APP_KEY: ${{ secrets.WEBULL_APP_KEY }}
      WEBULL_APP_SECRET: ${{ secrets.WEBULL_APP_SECRET }}
      WEBULL_PAPER_BASE_URL: ${{ secrets.WEBULL_PAPER_BASE_URL }}
      WEBULL_PAPER_ACCOUNT_ID: ${{ secrets.WEBULL_PAPER_ACCOUNT_ID }}
      DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Poll Webull shadow orders
        run: node --import tsx scripts/poll-webull-shadow-orders.mts
```

- [ ] **Step 4: Typecheck and commit**

Run: `npm run typecheck` — expect PASS.

```bash
git add src/lib/webull/pollShadowOrders.ts scripts/poll-webull-shadow-orders.mts .github/workflows/poll-webull-shadow-orders.yml
git commit -m "feat: add Webull shadow-order polling module, script, and cron"
```

---

### Task 10: Swing-scan cron backstop

**Files:**
- Modify: `src/lib/trading/runScan.ts:1-19` (imports), `src/lib/trading/runScan.ts:84-113` (`runScheduledScan`)

**Interfaces:**
- Consumes: `pollOpenShadowOrders` from `@/lib/webull/pollShadowOrders` (Task 9).

- [ ] **Step 1: Add the import**

In `src/lib/trading/runScan.ts`, add to the import block (after the existing `sendDiscordNotification` import on line 18):

```ts
import { pollOpenShadowOrders } from "@/lib/webull/pollShadowOrders";
```

- [ ] **Step 2: Call it once per scan, as a backstop**

In `src/lib/trading/runScan.ts`, in `runScheduledScan` (currently lines 84-113), change the end of the function from:

```ts
    for (const sp of SECONDARY_PASSES.filter((s) => s.portfolioId === p.id)) {
      await scanWatchlist(p, tf, log, { strategy: sp.strategy, interval: sp.interval as Interval, range: sp.range as Range, label: sp.label });
    }
  }
  return persistAndReturn(lines);
}
```

to:

```ts
    for (const sp of SECONDARY_PASSES.filter((s) => s.portfolioId === p.id)) {
      await scanWatchlist(p, tf, log, { strategy: sp.strategy, interval: sp.interval as Interval, range: sp.range as Range, label: sp.label });
    }
  }

  await pollWebullShadowBackstop(log);
  return persistAndReturn(lines);
}

/** Backstop pass over WebullShadowOrder rows, in case the dedicated
 *  poll-webull-shadow-orders.mts cron is missed or delayed — same sweep,
 *  safe under overlap (see pollShadowOrders.ts). No-ops when Webull isn't
 *  configured. */
async function pollWebullShadowBackstop(log: (m: string) => void): Promise<void> {
  if (!process.env.WEBULL_APP_KEY) return;
  try {
    const summary = await pollOpenShadowOrders();
    if (summary.checked > 0) log(`webull shadow backstop: ${summary.checked} checked, ${summary.updated} updated, ${summary.errors} errors`);
  } catch (e) {
    log(`webull shadow backstop ERROR ${String(e)}`);
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` — expect PASS. (`runScan.ts` has no dedicated test file today — `runScheduledScan` is DB/network-heavy end-to-end orchestration, consistent with why it isn't unit tested elsewhere in this file either.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/trading/runScan.ts
git commit -m "feat: poll Webull shadow orders as a backstop on every swing-scan cron run"
```

---

### Task 11: `scripts/seed-webull-ticker-cache.mts` — cold-start mitigation

**Files:**
- Create: `scripts/seed-webull-ticker-cache.mts`

**Interfaces:**
- Consumes: `getTickerId` from `@/lib/webull/symbols` (Task 3), `UNIVERSES` from `@/lib/trading/universe`, `getWatchlist` from `@/lib/trading/watchlist`.

- [ ] **Step 1: Write the script**

Create `scripts/seed-webull-ticker-cache.mts`:

```ts
// One-off/rerunnable: pre-warms WebullTickerCache for the equities universe
// so a fresh deploy or cache wipe doesn't hit Webull's ~60 req/60s rate
// limit cold during the first live scan (see docs/superpowers/specs/
// 2026-08-14-webull-data-provider-and-papertrade-shadow-design.md §3c).
// Usage:
//   node --import tsx scripts/seed-webull-ticker-cache.mts            # every watchlist symbol across all swing portfolios
//   node --import tsx scripts/seed-webull-ticker-cache.mts dow30      # a specific universe key from src/lib/trading/universe.ts
import { prisma } from "@/lib/db";
import { getTickerId } from "../src/lib/webull/symbols";
import { UNIVERSES } from "../src/lib/trading/universe";
import { getWatchlist } from "../src/lib/trading/watchlist";

const CONCURRENCY = 5; // stay well under Webull's ~60 req/60s ceiling

async function resolveSymbols(universeKey: string | undefined): Promise<string[]> {
  if (universeKey) {
    const uni = UNIVERSES[universeKey];
    if (!uni) throw new Error(`unknown universe "${universeKey}"`);
    return uni.symbols;
  }
  const portfolios = await prisma.portfolio.findMany({ where: { kind: "swing" } });
  const sets = await Promise.all(portfolios.map((p) => getWatchlist(p.id)));
  return [...new Set(sets.flat().map((w) => w.symbol))];
}

async function main() {
  const symbols = await resolveSymbols(process.argv[2]);
  console.log(`seeding WebullTickerCache for ${symbols.length} symbols (concurrency ${CONCURRENCY})...`);

  let ok = 0;
  let failed = 0;
  let next = 0;
  async function worker() {
    while (next < symbols.length) {
      const sym = symbols[next++];
      try {
        await getTickerId(sym);
        ok++;
      } catch (e) {
        failed++;
        console.warn(`  ${sym}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, worker));
  console.log(`done: ${ok} cached, ${failed} failed`);
}

main()
  .catch((e) => { console.error(`FATAL ${String(e)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` — expect PASS. (Manual operational script per the spec's Testing section — not part of the automated `npm test` suite, since it makes real Webull API calls.)

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-webull-ticker-cache.mts
git commit -m "feat: add Webull ticker-cache seed script for cold-start mitigation"
```

---

### Task 12: `scripts/webull-sandbox-smoke-test.mts` — manual sandbox smoke test

**Files:**
- Create: `scripts/webull-sandbox-smoke-test.mts`

**Interfaces:**
- Consumes: `fetchWebullCandles` (Task 4), `getTickerId` (Task 3), `placeWebullBracketOrder` + `getWebullOrderStatus` (Task 6).

- [ ] **Step 1: Write the script**

Create `scripts/webull-sandbox-smoke-test.mts`:

```ts
// Manual smoke test against the real Webull sandbox — NOT part of the
// automated test suite (no automated test hits the live/sandbox Webull
// network per the design doc's Testing section). Run by hand once
// WEBULL_APP_KEY/WEBULL_APP_SECRET/WEBULL_PAPER_ACCOUNT_ID are set, to
// sanity-check signing + a real candle fetch + a real (paper, risk-free)
// bracket order before relying on any of this in production.
// Usage: node --import tsx scripts/webull-sandbox-smoke-test.mts [SYMBOL]
import { fetchWebullCandles } from "../src/lib/webull";
import { getTickerId } from "../src/lib/webull/symbols";
import { placeWebullBracketOrder, getWebullOrderStatus } from "../src/lib/webull/paperTrade";

async function main() {
  const symbol = process.argv[2] ?? "AAPL";

  console.log(`1) resolving tickerId for ${symbol}...`);
  const tickerId = await getTickerId(symbol);
  console.log(`   tickerId=${tickerId}`);

  console.log(`2) fetching candles for ${symbol}...`);
  const candles = await fetchWebullCandles(symbol, "1mo", "1d");
  console.log(`   ${candles.candles.length} candles, last close=${candles.price}`);

  console.log(`3) placing a 1-share MARKET bracket order for ${symbol} (paper account, risk-free)...`);
  const entry = candles.price ?? 0;
  const result = await placeWebullBracketOrder({
    symbol, side: "long", qty: 1, entry, sl: entry * 0.95, tp: entry * 1.05,
    accountId: process.env.WEBULL_PAPER_ACCOUNT_ID ?? "",
  });
  console.log("   result:", result);

  if (result.kind === "placed") {
    console.log("4) checking order status immediately (parent likely still pending)...");
    const status = await getWebullOrderStatus({ parentOrderId: result.parentOrderId, slOrderId: result.slOrderId, tpOrderId: result.tpOrderId });
    console.log("   status:", status);
  }
}

main().catch((e) => { console.error(`FATAL ${String(e)}`); process.exitCode = 1; });
```

- [ ] **Step 2: Typecheck and commit**

Run: `npm run typecheck` — expect PASS.

```bash
git add scripts/webull-sandbox-smoke-test.mts
git commit -m "feat: add manual Webull sandbox smoke-test script"
```

---

### Task 13: Documentation — `.env.example` and `README.md`

**Files:**
- Modify: `.env.example` (append after the existing Alpaca block)
- Modify: `README.md:47-53` (Market data section)

**Interfaces:** None — documentation only.

- [ ] **Step 1: Extend `.env.example`**

In `.env.example`, add after the existing `ALPACA_SECRET=` line:

```bash
# Webull market data (optional, tried before Alpaca when set) + PaperTrade
# shadow execution (optional, opt-in per portfolio via webullShadowEnabled).
# Requires a Webull developer account with OpenAPI access. When
# WEBULL_APP_KEY/WEBULL_APP_SECRET are unset, NEXMIND falls back to
# Alpaca/Yahoo exactly as today and shadow mode simply never activates.
WEBULL_APP_KEY=
WEBULL_APP_SECRET=
# Data host (defaults to Webull's production data host if unset).
WEBULL_BASE_URL=
# PaperTrade host (defaults to Webull's sandbox/paper host if unset) and the
# specific PaperTrade account id shadow orders are placed against.
WEBULL_PAPER_BASE_URL=
WEBULL_PAPER_ACCOUNT_ID=
```

- [ ] **Step 2: Extend `README.md`**

In `README.md`, replace the existing "### Market data" section (lines 47-53):

```markdown
### Market data

NEXMIND reads candles and prices through a provider router
(`src/lib/marketData.ts`). By default it uses Yahoo Finance (no key needed).
If you set `ALPACA_KEY` and `ALPACA_SECRET` in `.env.local`, it uses Alpaca's
free IEX feed instead and falls back to Yahoo automatically on any error.
This is data-only; NEXMIND does not place orders through Alpaca.
```

with:

```markdown
### Market data

NEXMIND reads candles and prices through a provider router
(`src/lib/marketData.ts`). By default it uses Yahoo Finance (no key needed).
If you set `WEBULL_APP_KEY`/`WEBULL_APP_SECRET`, Webull is tried first; if you
set `ALPACA_KEY`/`ALPACA_SECRET`, Alpaca is tried next; Yahoo is always the
final fallback. Any provider failure (missing key, bad response, empty bars)
falls through to the next one automatically.

### Webull shadow execution (optional)

When a portfolio has `webullShadowEnabled` set (per-portfolio, opt-in), every
executed paper trade also places a real, risk-free bracket order into your
Webull PaperTrade account (`WEBULL_PAPER_ACCOUNT_ID`), purely to observe
realistic fills/slippage alongside NEXMIND's own simulation — it never feeds
back into grading, sizing, or `manage.ts`. Requires `WEBULL_APP_KEY`/
`WEBULL_APP_SECRET`/`WEBULL_PAPER_ACCOUNT_ID`. Shadow orders are polled by
`.github/workflows/poll-webull-shadow-orders.yml` (every ~20 min during
market hours) and, as a backstop, by every swing-scan cron run. See
`docs/superpowers/specs/2026-08-14-webull-data-provider-and-papertrade-shadow-design.md`
for the full design.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: document Webull data provider and PaperTrade shadow execution"
```

---

## Self-Review

**Spec coverage** — every component maps to a task:
- §1 `webull.ts` → Task 4. §2 `marketData.ts` extension → Task 5. §3a `auth.ts` → Task 2. §3b `paperTrade.ts` → Task 6. §3c `symbols.ts` + cold-start mitigations (seed script + concurrency limiter) → Task 3 + Task 11 + Task 5 Step 4. §4 Prisma schema → Task 1. §5 `engine.ts` hook → Task 8. §6 polling (both cadences + monotonicity guard) → Task 7 + Task 9 + Task 10.
- Data flow & error handling: fail-open shadow orders → Task 8 Step 3 (`placeWebullShadow` never throws); Discord alerting incl. `INSUFFICIENT_FUNDS` low-priority handling → Task 8 Step 3; orphan-order mitigation → Task 8 Step 3; signature/timestamp-expired retry-once → Task 2 Step 3 (`doSignedFetch`'s clock-skew retry).
- Configuration/env vars → Task 13. Testing section's every listed test file → Tasks 2, 3, 4, 5, 6, 7, plus the two manual scripts in Tasks 11-12.

**Placeholder scan** — no "TBD"/"TODO"/"add error handling" left in any step; every code block above is complete, runnable TypeScript/YAML with real logic. The few spots where an exact Webull field/endpoint name is genuinely unconfirmed (host URLs, param names) are implemented with a concrete, working default and a one-line comment pointing at "confirm against the live API reference" — never an unimplemented gap — exactly mirroring how the spec itself flagged those same points as non-blocking TBDs.

**Type/signature consistency** — checked across tasks: `CandleResponse`/`Range`/`Interval` (from `yahoo.ts`) used identically in Tasks 4-5; `WebullBracketOrderIds`/`PlaceShadowOrderResult`/`WebullBracketStatus` defined once in Task 6 and consumed unchanged by Tasks 8-9; `ShadowOrderStatusUpdate` defined once in Task 7 and consumed unchanged by Task 9; `PollSummary` defined once in Task 9 and consumed unchanged by Task 10; `tradeId: number` used consistently everywhere (Tasks 1, 6-10), matching `Trade.id: Int`.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-14-webull-data-provider-and-papertrade-shadow.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
