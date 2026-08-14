# Webull Data Provider + PaperTrade Shadow Execution — Design

**Date:** 2026-08-14
**Status:** Approved (design), pending implementation plan
**Scope:** Add Webull as a market-data source for NEXMIND equities (ahead of
Alpaca in the provider chain), and add an opt-in per-portfolio "shadow" mode
that mirrors approved signals into Webull's PaperTrade OpenAPI as real
bracket orders, purely to observe realistic fills/exits alongside NEXMIND's
own simulation.
**Explicitly out of scope:** live/real-money order execution (tracked as a
separate future design — "Phase 3" — once Webull's live API access, auth
process, and Thailand account eligibility are confirmed), options/crypto/
futures shadow trading, websocket streaming, a UI provider picker, and any
change to how NEXMIND grades or manages its own simulated trades.

## Motivation

NEXMIND currently prices US equities via Alpaca (with Yahoo as fallback), but
Alpaca's account-opening process is difficult for a Thai-resident user to
complete, which blocks getting an `ALPACA_KEY`. The user already holds a
regular Webull brokerage account. Webull's OpenAPI (including a July 2026
addition giving OpenAPI access specifically to PaperTrade — six asset
classes, App Key/Secret auth, a dedicated sandbox host) offers both a
market-data source and, uniquely, a way to run *real order-matching* against
a risk-free simulated account — something NEXMIND's own hand-rolled fill
simulation can't provide.

This is split into two additive layers so neither risks the existing,
already-validated ([[nexmind-blind-test-before-approve]]) simulation
pipeline:

- **Data layer** (this design, Phase 1): purely swaps/adds a price source.
  No behavior change to trading logic.
- **Shadow-execution layer** (this design, Phase 2): purely observational.
  NEXMIND's own `Trade` row stays the graded, authoritative record exactly as
  today; Webull's fills are logged alongside it for comparison, never fed
  back into `manage.ts`.

Real-money execution is deliberately deferred to its own future design once
Webull's live-API terms are confirmed — that phase carries fund-safety
requirements (kill switches, position limits, secret handling under far
higher stakes) that don't belong in this lower-risk change.

## Architecture

```
Phase 1 (data):
  marketData.fetchCandles(symbol, range, interval)
        │
        ├─ MT5 bridge (gold/forex, unchanged)
        ├─ WEBULL_APP_KEY present? ──► webull.fetchWebullCandles ──┐ (success → return)
        │                                                            │ (error/empty)
        ├─ ALPACA_KEY present?    ──► alpaca.fetchAlpacaCandles ───┤ (kept as fallback)
        └─ Yahoo (final fallback) ◄─────────────────────────────────┘

Phase 2 (shadow execution):
  engine.ts exec stage (unchanged) creates the authoritative simulated Trade
        │
        └─ portfolio.webullShadowEnabled? ──► awaited, non-throwing ──► placeWebullBracketOrder
                                               (tickerId lookup, qty floor,        │
                                                RTH check, TIF=GTC)                │
                                                                       WebullShadowOrder row (parent +
                                                                       SL/TP child order ids, separate table)
                                                                                   │
                                                     15–30min cron (market hours, jitter-tolerant)
                                                     + scan-cron backstop
                                                     poll parent+child status/fill/exit, update row
```

## Components

### 1. `src/lib/webull.ts` (new) — Webull market-data provider

- **`fetchWebullCandles(symbol, range, interval): Promise<CandleResponse>`**
  Same `CandleResponse` shape as `alpaca.ts`/`yahoo.ts` (reuse, don't
  redefine). Maps `Interval`/`Range` to Webull's bar-history request
  parameters. Reads `WEBULL_APP_KEY`/`WEBULL_APP_SECRET` from `process.env`,
  builds the signed request via the shared signing module (see §3a), targets
  `WEBULL_BASE_URL` (defaults to their production data host; sandbox host
  used automatically when `WEBULL_BASE_URL` is set to it). Explicitly
  requests **split/dividend-adjusted, regular-trading-hours-only bars** (the
  same convention Alpaca/Yahoo already return) — the exact request
  parameter names need confirming against Webull's live API reference during
  implementation, but the requirement itself (adjusted, RTH-only, matching
  what indicators are computed against today) is not optional: unadjusted
  data or leaked pre/post-market bars would silently corrupt EMA/RSI/ATR
  the moment a stock splits or a signal fires near the open/close. Throws on
  missing credentials, non-OK status, or an empty bar set, so the router
  falls back.
- **`parseWebullBars(json, symbol, range, interval): CandleResponse`** (pure,
  exported for testing) — same role as `parseAlpacaBars`. Converts Webull's
  bar timestamps to the `Candle.t` unix-seconds-UTC convention used
  elsewhere, and drops/rejects any extended-hours bar that slips through so
  the output is RTH-only regardless of what the request parameters achieved.

### 2. `src/lib/marketData.ts` (extend) — provider router

Insert Webull between MT5 and Alpaca in `fetchCandles`'s fallback chain for
non-MT5 symbols: try Webull first if `WEBULL_APP_KEY` is configured, then
Alpaca if configured, then Yahoo. Existing MT5 routing for gold/forex is
unchanged. Alpaca is kept, not removed — either provider working is enough,
and a user with only an Alpaca key still functions exactly as today.

### 3a. `src/lib/webull/auth.ts` (new) — shared request signing

- **`signedFetch(path, params, opts): Promise<Response>`** — single module
  used by both `webull.ts` and `paperTrade.ts` so signing logic (and any
  token handling) exists exactly once.
- Webull's docs describe App Key/Secret with request signing and
  token-based 2FA; the concrete flow (per-request HMAC vs. exchange for a
  short-lived Bearer token) needs confirming against the actual API
  reference during implementation. If it is token-based, this module owns a
  single in-memory cached token plus a lock (e.g. a shared in-flight
  promise) so the data client and the shadow-order poller — which can fire
  around the same time — never race to mint two tokens or sign with a
  stale one.
- Every signed call sets its timestamp from server time at call time (not
  cached), since Webull's signing is timestamp-based and rejects requests
  outside its clock-skew window (typically tens of seconds) with a
  `401 Unauthorized` / request-expired error. `signedFetch` classifies that
  specific failure distinctly from other 401s (bad key vs. clock drift) so
  callers/alerts can tell "your GitHub Actions runner's clock is off" apart
  from "your key is wrong."
- **Signature construction specifics** (per Webull's OpenAPI signing spec —
  to be confirmed field-for-field against the live reference during
  implementation, but the shape below is not optional, unlike the
  request-parameter-name TBDs noted elsewhere in this doc):
  - A fresh `x-signature-nonce` (random UUID, new per request) is generated
    and sent as a header, and — critically — is also folded into the
    signature string itself alongside `host` and every query
    param/header, all sorted alphabetically before hashing. A stale or
    reused nonce, or a nonce header present but omitted from the sorted
    string (or vice versa), produces a signature that verifies internally
    consistent but is rejected by Webull — the kind of bug that's silent
    until it hits the real API, so `signedFetch` builds the sorted string
    from one single source list shared between "what gets hashed" and
    "what gets sent," never two independently-maintained lists that could
    drift apart.
  - For `POST` requests carrying a body (order placement), the body is
    hashed as `toUpper(SHA256(body))` and appended to the signed string.
    For `GET` requests with no body, this segment is **omitted entirely** —
    not replaced with the hash of an empty string, which is a different
    value and would produce a signature Webull rejects.
  - The HMAC key is not the raw `WEBULL_APP_SECRET` — Webull requires
    `app_secret + "&"` (secret with a literal trailing ampersand) as the
    HMAC-SHA256 key.
  - Because these three details are each individually easy to get subtly
    wrong and each produces the same generic signature-invalid rejection,
    `auth.test.ts` unit-tests the string-building function against one or
    more known-good request/signature fixture pairs (once available from
    Webull's docs or a sandbox call), not just "it returns some string."

### 3b. `src/lib/webull/paperTrade.ts` (new) — PaperTrade order client

- **`placeWebullBracketOrder(symbol, side, qty, entry, sl, tp): Promise<WebullBracketOrderIds>`**
  Resolves `symbol` to Webull's internal `tickerId` first (see §3c — Webull's
  order and bar-history endpoints reference instruments by numeric id, not
  ticker string). Rounds `qty` down to a whole share with **`Math.floor`**
  (PaperTrade bracket orders don't accept fractional shares, unlike
  NEXMIND's own risk-based sizing which can compute e.g. `7.027`); if the
  floored quantity is `< 1`, the order is **skipped** — logged as
  `"skipped: qty < 1 share"`, not sent. Places the bracket order against the
  PaperTrade endpoint using the account configured by
  `WEBULL_PAPER_ACCOUNT_ID`, via `signedFetch`. Always sets **`TIF = GTC`**
  — NEXMIND's swing trades are multi-day; a `DAY` order's unfilled entry or
  armed SL/TP would be auto-cancelled at the close, silently desyncing
  `WebullShadowOrder` from reality. Before placing, checks the current
  market session; if it's outside regular trading hours (bracket orders are
  typically rejected pre/post-market), the placement is **skipped** — logged
  as a `webull-shadow` step noting `"skipped: outside RTH,"` not an error —
  rather than sent and rejected.
  Returns `{ parentOrderId, slOrderId?, tpOrderId? }` — Webull's bracket
  orders are commonly a parent (entry) order plus two OCO child orders
  (stop-loss/take-profit) that only exist once the parent fills, so the
  child ids may be null until then; whether Webull's create-order response
  returns child ids immediately or only via a follow-up fetch is unconfirmed
  from public docs and must be verified against the live API during
  implementation.
  The **parent order type is `MARKET`**, not `LIMIT` — this is a deliberate
  choice, not a TBD: a `LIMIT` parent at the signal price would sit
  `PENDING` and never fill on a gap-open past that price, silently
  desyncing the shadow order from a `Trade` that NEXMIND's simulation
  already recorded as entered; the entire point of shadow execution
  (§Motivation) is to observe *real* fill behavior including its slippage,
  which a guaranteed-fill `MARKET` order captures honestly instead of
  hiding behind an order type that can simply not fill.
- **`getWebullOrderStatus(ids: WebullBracketOrderIds): Promise<WebullBracketStatus>`**
  — checks the **parent and both child orders**, not just the parent: a
  parent stuck at `FILLED` forever would hide the real outcome, since the
  parent only reflects entry — exit price/time/reason live on whichever
  child order fired (the other child is auto-`CANCELLED` by the OCO pair).
  Returns entry fill price/qty/time, and — once one child order fills —
  exit price/qty/time plus `exitReason` (`TAKE_PROFIT` | `STOP_LOSS` |
  `MANUAL_CANCEL`).
  **Partial fills**: a triggered SL/TP child can match in more than one
  execution if liquidity is thin (e.g. 10 shares ordered, 4 fill at $150,
  the rest fills later or at a different price). `exitPrice` is therefore
  the **volume-weighted average fill price (VWAP)** across that child
  order's individual executions, not just the first or last fill seen —
  and `exitFilledQty` is reported as the true cumulative filled quantity
  so far, even when it's less than the entry quantity. The bracket is only
  considered fully closed (`status = closed`) once `exitFilledQty` equals
  `entryFilledQty` *or* the triggered child order itself reports a
  terminal state (fully filled/cancelled) — never inferred from "a fill was
  seen," since a partial fill is a real, distinct state.
- Isolated in its own module (on top of the shared `auth.ts`) so Phase 3
  (live) can later reuse the request-building logic behind a different base
  URL/account without touching Phase 1/2 code.

### 3c. `src/lib/webull/symbols.ts` (new) — symbol → tickerId resolution

- **`getTickerId(symbol): Promise<number>`** — Webull's data and order
  endpoints reference instruments by an internal numeric `tickerId`, not the
  ticker string, so every candle fetch and order placement needs a
  resolution step first. Since `tickerId` is effectively static per symbol,
  this is backed by a small persistent cache — **`WebullTickerCache`**
  (Prisma model: `symbol`, `tickerId`, `updatedAt`) — not just an in-memory
  `Map`, because both the exec-stage hook and the polling cron run as
  fresh, short-lived processes (Next.js request handlers / GitHub Actions
  jobs) that don't share memory between invocations; an in-memory-only
  cache would re-resolve every symbol on every run and double request
  volume/latency for no benefit. Lookup checks the DB cache first, falls
  back to Webull's symbol-search endpoint on a miss, and upserts the result.
- **Cold-start rate-limit risk:** Webull's market-data API is rate-limited
  around 60 requests/60s. A first run (or a wiped `WebullTickerCache`)
  against NEXMIND's 30–50 symbol equities swing-scan universe would issue
  30–50 `getTickerId` misses plus 30–50 candle fetches back-to-back —
  nearly 100 requests in a few seconds — and hit `429 Too Many Requests`
  well before finishing. Two mitigations, both required:
  - **`scripts/seed-webull-ticker-cache.mts`** (style of
    `scripts/validate-approved-gold-strategies.mts`): a one-off/rerunnable
    dev script that resolves and upserts `tickerId` for the full equities
    universe ahead of time, so a fresh deploy or cache wipe doesn't hit the
    cold-start case during a live scan.
  - **Concurrency limiting in `marketData.ts`**: Webull lookups/candle
    fetches across a scan batch are throttled to a small concurrent window
    (5–10 in flight, not `Promise.all` over the whole universe), regardless
    of whether the cache is warm — the cache reduces load but must not be
    the only thing standing between a normal scan and a 429.

### 4. Prisma schema additions

- `Portfolio.webullShadowEnabled Boolean @default(false)` — same
  opt-in-per-portfolio pattern as the existing `killSwitch` column.
- New model `WebullShadowOrder`, redesigned to track the parent/child order
  structure and full exit analytics needed to compare against NEXMIND's own
  simulated fill:

  ```prisma
  model WebullShadowOrder {
    id             String    @id @default(cuid())
    tradeId        String    @unique
    parentOrderId  String
    slOrderId      String?
    tpOrderId      String?
    status         String    // pending | open | filled | closed | cancelled | rejected
    entryFillPrice Float?
    entryFilledQty Float?
    entryFilledAt  DateTime?
    exitPrice      Float?
    exitReason     String?   // TAKE_PROFIT | STOP_LOSS | MANUAL_CANCEL
    exitFilledQty  Float?
    closedAt       DateTime?
    lastError      String?
    createdAt      DateTime  @default(now())
  }
  ```

  `exitPrice`/`exitReason` are what actually make the "compare NEXMIND's
  simulated fill against Webull's real fill" motivation (§Motivation)
  possible — without them the row can say an order closed but not what it
  closed at or why, which was a gap in the first draft of this schema.
- New model `WebullTickerCache` (`symbol`, `tickerId`, `updatedAt`) per §3c.

### 5. `engine.ts` exec-stage hook

Immediately after the existing paper `Trade` is created (unchanged), if
`portfolio.webullShadowEnabled`: **`await`** `placeWebullBracketOrder` wrapped
in its own `try/catch` that never rethrows into the main exec path — not a
true un-awaited fire-and-forget. The engine runs inside short-lived
processes (Next.js API route handlers, and the GitHub Actions swing-scan
script), either of which can terminate immediately once the outer function
returns; an un-awaited call risks the HTTP request or the DB write being cut
off mid-flight with no trace. Awaiting adds a bounded amount of latency to
the exec step but guarantees the shadow attempt actually completes (or
fails cleanly and is logged) before the process exits. Appends a
`webull-shadow` step to `decisionLog` with either the returned
`parentOrderId`, a "skipped: outside RTH" / "skipped: qty < 1 share" note,
or the error — mirroring the existing
`rl-shadow` step pattern already used for the RL-sizing comparison.

### 6. Shadow-order polling

Two cadences, since shadow data is observational but stale-for-hours data
defeats the point of testing realistic fills:

- **New lightweight cron** (GitHub Actions, e.g. every 15–30 min during
  09:30–16:00 ET on trading days): sweeps `WebullShadowOrder` rows still
  `open`/`pending`, calls `getWebullOrderStatus`, updates fill
  price/quantity (partial fills recorded as-is, not coerced to "filled")
  and close status. Cheap — it's a handful of GET calls, not a scan.
- **Existing swing-scan cron**: keeps its own pass over the same rows as a
  backstop, so a missed lightweight run isn't the only chance to catch up.
- GitHub Actions cron schedules are **not** exact — runs commonly slip
  3–15 minutes late (worse around US market open, when many workflows
  queue at once). Polling logic must not assume a fixed time-delta between
  runs (e.g. "last run was exactly 15 min ago, so anything unfilled after
  30 min is stale"); it should instead compare against each row's own
  `createdAt`/`updatedAt` timestamps. This is a non-issue for correctness
  (the sweep just catches up whenever it runs) but matters if any
  future logic tries to alert on "no update in N minutes."
- **Terminal-state guard (monotonicity):** the two cadences above can
  overlap — the lightweight cron and the swing-scan cron can be in flight
  at the same time, or their Webull responses can arrive out of send
  order. If cron A's response marks a row `closed` (child order filled,
  `exitPrice` recorded) before cron B's earlier, slower request finally
  resolves as `filled` (parent-only status, requested before the exit
  happened), a naive last-write-wins update would revert the row from
  `closed` back to `filled` and lose the exit data. The update layer
  therefore **rejects writes that would move a row's `status` away from a
  terminal value** (`closed`, `cancelled`, `rejected`) — once a row reaches
  one of those, only fields consistent with staying terminal (e.g. a
  correction to `exitPrice` from a later, more complete fill report) may
  still apply; the `status` itself is one-way.

## Data flow & error handling

- Phase 1 data: identical fallback semantics to the Alpaca design — any
  provider failure (missing key, bad response, empty bars) falls through to
  the next provider; if all fail, the router throws exactly as today.
- Phase 2 shadow orders: fully fail-open. A Webull outage, rate limit, auth
  failure, or a symbol PaperTrade won't accept never blocks or alters the
  real (simulated) `Trade` row — it only prevents that one shadow order from
  being placed, logged as `lastError` on the (not-yet-created, so logged in
  `decisionLog` instead) shadow attempt.
- Shadow failures notify via the existing Discord alert channel (same
  channel used for trade fills/closes/drawdown/cron errors), with one
  exception: `INSUFFICIENT_FUNDS` rejections (expected once the PaperTrade
  account's simulated buying power is used up by repeated shadow orders) are
  logged but sent as a low-priority/rate-limited note rather than a normal
  alert, so a busy scan day doesn't turn the channel into spam. A stale or
  revoked Webull key, by contrast, still alerts normally and immediately.
- **Orphan-order mitigation:** if `placeWebullBracketOrder` succeeds (Webull
  has created the order) but the subsequent `WebullShadowOrder` DB write
  fails (timeout, DB down), the returned `parentOrderId` (and `slOrderId`/
  `tpOrderId` if already known at that point) is still logged to
  `decisionLog` and the Discord alert even though no DB row tracks it — so a
  human can find and manually cancel it in the Webull UI. Full automatic
  reconciliation (periodically diffing Webull's open-order list against the
  DB) is not built in this phase; the shadow account can be swept by hand if
  this occurs, since it holds no real money.
- Signature/timestamp-expired responses (see `auth.ts` above) are retried
  once after resyncing the request timestamp; a second failure is treated as
  a real auth error and alerted, not silently retried forever.
- Because shadow orders are observational only, NEXMIND's Iron
  Rules/backtest grading is untouched — nothing about this design changes
  what a strategy needs to do to get approved or how its live paper track
  record is computed.

## Configuration

- New env vars, server-side only (no `NEXT_PUBLIC_` prefix), following the
  existing graceful-degradation pattern: `WEBULL_APP_KEY`,
  `WEBULL_APP_SECRET`, `WEBULL_BASE_URL` (data; defaults to production data
  host), `WEBULL_PAPER_BASE_URL` (defaults to Webull's sandbox/paperTrade
  host), `WEBULL_PAPER_ACCOUNT_ID`.
- Documented in `README.md` and `.env.example`. Credentials are the user's
  own and are never committed.
- Exact request-signing details, and whether PaperTrade API access requires
  the same approval queue as live trading or is self-serve, are unconfirmed
  from public docs as of this design — first implementation step is
  registering for API access and reading the concrete API reference before
  finalizing `webull.ts`'s request-signing code. If Thai-registered accounts
  turn out to be blocked entirely, Phase 1 (data) degrades gracefully to
  "Webull key absent → Alpaca/Yahoo as today," and Phase 2 simply doesn't
  activate.

## Testing

Co-located `node:test` files (`npm test`), same style as `marketData.test.ts`:

- `src/lib/webull.test.ts`: interval/range mapping, `parseWebullBars` against
  well-formed, empty/malformed, and extended-hours-bar response bodies
  (asserting extended-hours bars are dropped), provider-selection order
  (Webull tried before Alpaca when both keys present).
- `src/lib/webull/auth.test.ts`: token caching returns the same in-flight
  promise for concurrent callers (no duplicate token requests), the
  timestamp-expired vs. bad-key 401 cases are classified correctly, and
  the signature-string builder is checked against known-good
  request/signature fixture pairs — covering the nonce+host inclusion in
  the sorted string, POST-body-hash vs. GET-no-hash branching, and the
  `app_secret + "&"` HMAC key.
- `src/lib/webull/paperTrade.test.ts`: bracket-order request construction
  (pure, mocked fetch — no live/sandbox calls in CI) including `TIF: GTC` is
  always set, the RTH-session gate skips placement outside market hours
  without erroring, quantity is floored to a whole share and placement is
  skipped (not sent) when the floored value is `< 1`, the parent order is
  always constructed as `MARKET`, and order-status response parsing
  correctly derives `exitReason` and a VWAP `exitPrice` from whichever
  child order's (possibly multiple) executions are reported — asserting
  `status` stays non-`closed` while `exitFilledQty < entryFilledQty`.
- `src/lib/webull/symbols.test.ts`: `getTickerId` returns a cached value on
  a second call without hitting the mocked fetch again (cache-hit path),
  and falls back to the mocked symbol-search + upsert on a cache miss.
- Shadow-order update layer (wherever the poller writes `WebullShadowOrder`
  rows): a write attempting to set `status` to a non-terminal value on a
  row already `closed`/`cancelled`/`rejected` is rejected/no-ops, verifying
  the monotonicity guard.
- A manual dev script (style of `scripts/validate-approved-gold-strategies.mts`)
  to smoke-test against the real Webull sandbox once credentials exist —
  not part of the automated test suite.
- `scripts/seed-webull-ticker-cache.mts` (see §3c) is likewise a manual
  operational script, not an automated test, but is run once against the
  real API before a fresh deploy's first live scan.

No test hits the live or sandbox Webull network.

## Out of scope (for now)

- Real-money/live order execution (future "Phase 3" design).
- Options, crypto, futures, bonds, event-contract shadow trading — stocks
  only, matching NEXMIND's current equities scope.
- Websocket/streaming data.
- Feeding shadow-order results back into `manage.ts`, win-rate stats, or
  Iron Rules in any way.
- A UI control for provider selection or a shadow-mode dashboard — status is
  visible via existing `decisionLog`/Discord channels for now.
- Removing Alpaca or Yahoo as fallback providers.
