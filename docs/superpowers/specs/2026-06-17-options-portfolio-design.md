# Options Portfolio (Phase 2) — Design

**Date:** 2026-06-17
**Status:** Approved (design), pending implementation plan
**Scope:** A new `kind="options"` portfolio that **autonomously** trades long
single-leg options (calls/puts) on the multi-portfolio foundation. Option-chain
data comes from Yahoo; greeks are computed via Black-Scholes. Unlike the invest
portfolio (advisory), the options desk **executes its own decisions** when run —
gated by the Phase 0 safety controls (per-portfolio kill switch + global trading
halt + archived status). Paper only, no broker.
**Explicitly out of scope:** spreads / multi-leg, short/naked options, early
(American) exercise, dividends, historical settlement pricing, and per-portfolio
option settings (constants in Phase 2).

## Motivation

Phase 2 of the AI multi-portfolio roadmap. Options is the largest instrument
jump: positions have a strike, an expiry, a premium, and greeks; they expire;
and their P/L is non-linear in the underlying. The user wants the options desk
to act like the swing desk — **autonomous execution on demand** — not advisory.
Scope is deliberately tight (long single-leg, defined risk = premium paid) so it
fits one spec.

There are now **three portfolio kinds**: `swing` (the autonomous trade desk),
`invest` (advisory buy-and-hold), and `options` (autonomous options desk). Each
engine runs only on its own kind.

## Architecture

The options desk mirrors the swing desk's autonomous shape, not the invest
advisory shape. A single orchestrator `runOptions(portfolioId)` does, in order:
1. **Settle** any expired positions (mechanical, automatic).
2. **Close** open positions whose committee view flipped against them or that are
   near expiry.
3. **Open** new long calls/puts from the committee's directional read on each
   watchlist underlying.

`runOptions` executes each action immediately through an executor, but only when
the portfolio is allowed to trade: not archived, its `killSwitch` is off, and
`globalTradingHalt` is off. The decision logic (which option to pick, when to
close) is factored into **pure** functions; only the orchestrator and executor
touch the DB / network.

## Components

### 1. Black-Scholes (`src/lib/options/blackScholes.ts`, pure)

- `bsPrice(type, S, K, T, r, sigma)` — European option theoretical price.
- `greeks(type, S, K, T, r, sigma)` → `{ delta, gamma, theta, vega }`.
- `S`=underlying price, `K`=strike, `T`=years to expiry, `r`=risk-free rate
  (constant `RISK_FREE_RATE = 0.04` in Phase 2), `sigma`=implied volatility.
- Pure and heavily unit-tested against known textbook values (ATM call delta ≈
  0.5+, put delta negative, deep-ITM/OTM limits, T→0 behavior).

### 2. Option chain (`src/lib/options/chain.ts`)

- `parseOptionChain(json)` (pure) → `{ underlyingPrice, expiries: number[],
  calls: OptionQuote[], puts: OptionQuote[] }` for the expiry the response
  carries. `OptionQuote = { type: "call"|"put", strike, expiry (unix sec), bid,
  ask, lastPrice, impliedVolatility }`. Pure parser is the unit-test surface.
- `fetchOptionChain(underlying, expiryUnix?)` — fetches Yahoo
  `query2.finance.yahoo.com/v7/finance/options/{symbol}` (`?date=<expiryUnix>`
  for a specific expiry). Returns the parsed chain. Throws on non-OK / empty so
  callers skip the symbol. Short `revalidate` cache like the candle fetchers.
- `fetchExpirations(underlying)` — returns the list of available expiry unix
  timestamps (the no-`date` response carries `expirationDates`), used to choose
  the target expiry before fetching that expiry's chain.
- Yahoo's options endpoint is unofficial and may be unavailable for some symbols;
  a failed fetch skips that underlying (graceful degrade). The Black-Scholes
  module is already available as a synthetic-chain fallback if Yahoo ever breaks
  (not built in Phase 2).

### 3. Kind guards (`src/lib/portfolioGuards.ts`)

- Add `isOptionsKind(kind) = kind === "options"` and `isSwingKind(kind) =
  kind === "swing"`.
- The swing routes (`trade-tick`, `scan-all`, `scan-universe`, `manage`) change
  their guard from "reject invest" to **require swing** (`if
  (!isSwingKind(portfolio.kind)) → 409`), which now rejects both invest and
  options. Invest routes keep rejecting non-invest. Options routes reject
  non-options.

### 4. Data model (`prisma/schema.prisma`)

**New `OptionHolding` model:**
```prisma
model OptionHolding {
  id          Int       @id @default(autoincrement())
  portfolio   Portfolio @relation(fields: [portfolioId], references: [id])
  portfolioId Int
  underlying  String                    // e.g. AAPL
  type        String                    // call | put
  strike      Float
  expiry      DateTime
  contracts   Int                       // 1 contract = 100 shares
  premiumPaid Float                     // entry premium per share
  status      String    @default("open") // open | closed | expired
  realizedPnl Float     @default(0)
  openedAt    DateTime  @default(now())
  closedAt    DateTime?
  updatedAt   DateTime  @updatedAt
}
```
Plus a `optionHoldings OptionHolding[]` back-relation on `Portfolio`. Reuses the
existing `cash` (initialized to `startingBalance` for `options` kind on create,
same as invest) and `maxOpenPositions` (max concurrent option positions).
**Contract multiplier = 100** (US standard): position cost = `contracts × 100 ×
premium`.

Phase-2 constants (in `src/lib/options/`, not per-portfolio settings yet):
`CONTRACT_MULTIPLIER = 100`, `RISK_FREE_RATE = 0.04`, `MIN_DAYS_TO_EXPIRY = 30`,
`TARGET_DELTA = 0.50`, `NEAR_EXPIRY_DAYS = 7` (close/roll threshold).

### 5. Valuation + expiry settlement

- **Pure `computeOptionStats(positions, premiumOf, cash)`** (`optionStats.ts`):
  `marketValue = Σ open contracts × 100 × premiumOf(position)`; `equity = cash +
  marketValue`; `unrealizedPnl = marketValue − Σ cost`; `realizedPnl = Σ over all
  positions`. A position whose live premium is unavailable falls back to its
  `premiumPaid` (never zero) and is flagged.
- **Pure `settlementValue(type, strike, underlyingPrice)`** → intrinsic per
  share: call `max(0, S−K)`, put `max(0, K−S)`. Used by expiry settlement.
- Expiry settlement (in the executor, automatic): for each open position past
  `expiry`, value at intrinsic × contracts × 100 using the **current** underlying
  price (paper approximation), credit `cash`, set `realizedPnl`,
  `status="expired"`, `closedAt`.

### 6. Option selection (`src/lib/options/select.ts`, pure)

- `chooseExpiry(expiries, now, minDays)` → the nearest expiry ≥ `minDays` out
  (or null).
- `chooseStrike(quotes, underlyingPrice, type, targetDelta, r)` → the quote whose
  Black-Scholes delta is closest to `targetDelta` (calls use +delta, puts use the
  absolute value). Returns the chosen `OptionQuote` or null.
- `directionToType(rating)` → `"call"` for buy/strong-buy, `"put"` for avoid,
  `null` for watch/hold.
- `sizeContracts(budget, premium)` → `floor(budget / (100 × premium))`.
These compose into the orchestrator's "open" step; each is unit-tested.

### 7. Engine + executor (`src/lib/options/engine.ts`, `execute.ts`)

- **Executor (`execute.ts`)** — pure helpers where possible + DB ops, each write
  atomic (`$transaction`):
  - `buyOption(portfolioId, { underlying, type, strike, expiry, contracts, premium })`
    — `cost = contracts × 100 × premium`; clamp contracts to cash; create
    `OptionHolding`; debit cash.
  - `closeOption(positionId, premium)` — proceeds = `contracts × 100 × premium`;
    `realizedPnl = contracts × 100 × (premium − premiumPaid)`; credit cash;
    `status="closed"`, `closedAt`.
  - `settleOption(positionId, underlyingPrice)` — intrinsic settlement as above.
- **Engine (`engine.ts`)** — `runOptions(portfolioId)`:
  1. Guard: load portfolio; require `isOptionsKind`. Compute a `canTrade` flag =
     not archived AND `killSwitch` off AND `globalTradingHalt` off. Expiry
     settlement (step 2) **always runs** (it is mechanical, not discretionary);
     discretionary opens/closes (steps 3–4) run **only when `canTrade`**.
  2. Settle expired (always, regardless of `canTrade`).
  3. For each open position: re-price via chain; close if committee flipped
     (held call but underlying now bearish, or held put but now bullish) or
     within `NEAR_EXPIRY_DAYS` of expiry.
  4. For each watchlist underlying not already held: run committee
     (`analyzeLongTerm`), map to call/put, choose expiry + strike, size by
     `equity / maxOpenPositions` premium budget, buy — until at `maxOpenPositions`
     and cash permitting.
  Returns a summary `{ settled, closed, opened, errors }` (like `scan-all`). A
  per-underlying chain/committee failure is caught and skipped.

### 8. API

- `POST /api/options/run` `{ portfolioId }` → validates portfolio exists (404)
  and `isOptionsKind` (409); runs `runOptions`; returns the action summary.
  (Settlement runs even when halted; opens/closes respect the guards — the engine
  enforces this, the route just rejects non-options and runs it.)
- `GET /api/options/holdings?portfolioId` → open positions (with current premium,
  market value, greeks) + `computeOptionStats`. Settlement also runs here first
  so the view never shows stale expired positions.
- Swing routes switch to the `isSwingKind` guard (reject invest + options).

### 9. UI (`src/app/options/page.tsx`, new)

- Options-portfolio switcher (lists `kind="options"`).
- Holdings table: underlying, type, strike, expiry (+ days left), contracts,
  premium paid, current premium, market value, unrealized P/L, and greeks
  (delta/theta). Header: equity, cash, unrealized + realized P/L.
- A **"Run options desk"** button → `POST /api/options/run`, then refresh; shows
  the run summary (opened / closed / settled counts + notes). Mirrors the swing
  "Scan all" UX. A global-halt / kill-switch banner when trading is blocked.

## Data flow

Run options desk → settle expired → close flipped/near-expiry → open new from
committee+chain+greeks → executor mutates `OptionHolding` + `cash` atomically →
holdings + equity refresh. All opens/closes gated by archived/killSwitch/
globalTradingHalt; settlement always runs.

## Error handling

- `run`/`holdings` on a non-options portfolio → 409; unknown → 404.
- A symbol whose chain or committee fetch fails is skipped (logged), never 500s
  the whole run.
- `buyOption` clamps contracts to available cash; a zero/clamped count is a no-op.
- Missing live premium in valuation falls back to `premiumPaid` and is flagged.
- Expiry settlement uses the current underlying price; if that fetch fails, the
  position is left open and retried next run (logged).

## Testing

`node:test` co-located files:
- `blackScholes.test.ts`: price + greeks vs known values; call/put delta signs;
  ATM ≈ 0.5; T→0 intrinsic limit.
- `chain.test.ts`: `parseOptionChain` maps a sample Yahoo body to calls/puts +
  expiries + underlyingPrice; empty/missing → throws.
- `select.test.ts`: `chooseExpiry` nearest ≥ minDays; `chooseStrike` picks
  closest-to-target-delta; `directionToType`; `sizeContracts` floor + cash cap.
- `optionStats.test.ts`: equity = cash + MV; unrealized/realized; missing-premium
  fallback; `settlementValue` intrinsic for call/put ITM/OTM.
- executor avg/clamp + realizedPnl math; `kind` guards (`isOptionsKind`,
  `isSwingKind`).

## Out of scope (for now)

- Spreads / multi-leg, short/naked options (undefined risk).
- Early (American-style) exercise; assignment modeling.
- Dividends, splits, fees/commissions.
- Historical settlement pricing (uses current underlying price).
- Per-portfolio option settings — Phase 2 uses module constants.
- Autonomous scheduling (a cron) — `run` is user-triggered, like `scan-all`.
