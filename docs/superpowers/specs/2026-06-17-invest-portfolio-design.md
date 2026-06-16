# Long-term Invest Portfolio (Phase 1) — Design

**Date:** 2026-06-17
**Status:** Approved (design), pending implementation plan
**Scope:** Turn NEXMIND's analysis-only `/invest` surface into a *managed,
advisory* buy-and-hold portfolio on top of the multi-portfolio foundation. A
portfolio with `kind="invest"` holds positions (`Holding` rows), is valued
mark-to-market, and is rebalanced through an **advisory plan**: the engine
proposes BUY/ADD/TRIM/SELL actions from the existing investment committee, and
the user approves them (one-by-one or all at once) to execute on paper.
**Explicitly out of scope:** autonomous execution, dividends, detailed tax-lot
accounting (avg-cost is used), multi-currency, broker/live execution, and drift
rebalancing for swing portfolios.

## Motivation

This is Phase 1 of the AI multi-portfolio roadmap. Phase 0 built the
`Portfolio` foundation; every later phase is a *type* of portfolio. Today
`/invest` only analyzes a single symbol (committee verdict, accumulation zone,
fundamentals) and explicitly buys nothing. Phase 1 makes an `invest` portfolio
actually hold and manage positions — the first use of `kind` to drive behavior
(in Phase 0 `kind` was a label only).

The execution model is **advisory**: the engine never trades on its own. It
computes a rebalance *plan* the user reviews and approves. This matches the
user's intent (approve each move) while still doing the analytical heavy lifting.

## Architecture

An `invest` portfolio reuses the `Portfolio` row but is driven by a separate,
advisory **rebalance engine** instead of the swing trade engine:

- The **swing engine** (scan/tick/manage) runs on non-`invest` portfolios and is
  rejected for `kind="invest"`.
- The **invest rebalance engine** runs only on `kind="invest"` portfolios and is
  rejected for other kinds.

The engine has three layers:
1. A **pure planner** — given holdings, committee analyses, current prices, and
   the target allocation, returns a list of proposed actions. No I/O.
2. An **orchestrator** (API `plan` route) — fetches committee analyses
   (`analyzeLongTerm`) and prices for the portfolio's watchlist + held names,
   then calls the pure planner and returns the plan plus current stats.
3. An **executor** (API `execute` route) — applies one approved action,
   mutating `Holding` rows and the portfolio's `cash`.

## Components

### 1. Data model (`prisma/schema.prisma`)

**New `Holding` model:**
```prisma
model Holding {
  id          Int       @id @default(autoincrement())
  portfolio   Portfolio @relation(fields: [portfolioId], references: [id])
  portfolioId Int
  symbol      String
  shares      Float
  avgCost     Float                     // weighted-average cost basis per share
  status      String    @default("held") // held | sold
  realizedPnl Float     @default(0)      // accumulated realized P/L on this name
  openedAt    DateTime  @default(now())
  closedAt    DateTime?
  updatedAt   DateTime  @updatedAt
}
```
`Portfolio` gains:
- `cash Float @default(0)` — uninvested cash. For an `invest` portfolio this is
  initialized to `startingBalance` at creation; the swing portfolios ignore it.
- `rebalanceBandPct Float @default(5)` — drift tolerance (%) before TRIM/ADD.
- a `holdings Holding[]` back-relation.

### 2. Pure valuation helper (`src/lib/invest/investStats.ts`)

`computeInvestStats(holdings, priceOf, cash)` where `holdings` is **all** the
portfolio's holdings (held + sold) and `priceOf` maps symbol→current price. The
market-value math uses only `status==="held"` rows; `realizedPnl` sums every row:
```
held          = holdings.filter(status === "held")
marketValue   = Σ_held shares × priceOf(symbol)
costBasis     = Σ_held shares × avgCost
unrealizedPnl = marketValue − costBasis
equity        = cash + marketValue
realizedPnl   = Σ_holdings holding.realizedPnl   (held + sold)
```
Pure, no DB/network — the primary unit-test surface. A holding with no available
price contributes its cost basis (so a missing price never silently zeroes the
position) and is flagged so the UI can show "price unavailable."

### 3. Pure rebalance planner (`src/lib/invest/rebalance.ts`)

`planRebalance(input)` is pure. Input: open holdings (with current prices),
per-symbol committee results (`rating` + accumulation `entryHigh`), the target
position count (`maxPositions`), `rebalanceBandPct`, available `cash`, and total
`equity`. Output: an ordered `RebalanceAction[]`, each
`{ kind: "buy"|"add"|"trim"|"sell", symbol, shares, estPrice, reason }`.

Decision rules (target weight per name = `1 / maxPositions` of equity):
- **SELL**: a held name whose committee `rating` is `avoid` → sell all shares.
- **BUY**: a watchlist name not held, `rating` ∈ {buy, strong-buy}, price ≤
  `entryHigh` (in the accumulation zone; if no zone, rating alone qualifies),
  while held-count < `maxPositions` and cash allows → buy ~one target-weight slice.
- **TRIM**: a held name whose current weight > target + band → sell the excess
  back to target.
- **ADD**: a held name whose current weight < target − band and rating ≠ avoid →
  buy up to target (cash permitting).

Ordering: SELL and TRIM first (free up cash), then BUY and ADD. Buys are capped
by available cash after sells/trims (the planner assumes sells/trims execute
first when computing buy affordability, and each action carries an `estPrice` so
the executor re-prices at approval time).

### 4. Executor (`src/lib/invest/execute.ts`)

`executeAction(portfolioId, action)` re-fetches the live price, then:
- **BUY/ADD**: `cost = shares × price`; if `cost > cash` clamp shares to cash;
  decrement `cash`; upsert the `Holding` (new → create; existing → new
  `avgCost = (oldShares·oldAvg + shares·price)/(oldShares+shares)`, `shares +=`).
- **TRIM/SELL**: `proceeds = shares × price`; increment `cash`;
  `realizedPnl += shares × (price − avgCost)`; reduce `shares` (SELL or a TRIM to
  zero sets `status="sold"`, `closedAt=now`).
All within the action; avg-cost is unchanged on trims/sells (only shares + cash +
realizedPnl move).

### 5. API

- `POST /api/invest/plan` `{ portfolioId }` → validates the portfolio exists and
  is `kind="invest"` (else 400/409); runs `analyzeLongTerm` for each watchlist
  symbol + each held name; prices each; returns `{ stats, actions }`. This is
  AI-cost-heavy, so it is on-demand and user-triggered (mock path is free).
- `POST /api/invest/execute` `{ portfolioId, action }` → validates kind; applies
  one approved action; returns updated `{ stats, holdings }`.
- `POST /api/invest/execute-all` `{ portfolioId, actions }` → convenience batch:
  applies each action in plan order (SELL/TRIM before BUY/ADD), re-pricing each.
- `GET /api/invest/holdings?portfolioId` → open holdings + `computeInvestStats`.

The swing routes (`trade-tick`, `scan-all`, `scan-universe`) reject
`kind="invest"` portfolios with 409; `invest/*` rejects non-invest with 409.

### 6. UI (`src/app/invest/page.tsx`)

The page gains a **portfolio mode** alongside the existing single-symbol research
tool (which stays):
- An invest-portfolio switcher (lists `kind="invest"` portfolios; offers "create
  invest portfolio" if none).
- A **holdings table**: symbol, shares, avgCost, current price, market value,
  unrealized P/L, current weight vs target weight; header shows cash, equity,
  realized + unrealized P/L.
- A **"Generate rebalance plan"** button → calls `/api/invest/plan`, renders the
  proposed actions (kind, symbol, shares, est price, reason) each with an
  **Approve** button (calls `execute`), plus an **Approve all** button (calls
  `execute-all`). After execution the holdings/stats refresh.

## Data flow

Pick invest portfolio → "Generate plan" → committee analyzes watchlist + holdings
→ pure planner returns actions → user approves (one or all) → executor mutates
holdings + cash at live prices → holdings table + equity refresh.

## Error handling

- `plan`/`execute` on a non-`invest` portfolio → 409; unknown portfolio → 404.
- A symbol whose price/analysis fetch fails is skipped in the plan (logged), so
  one bad symbol never blocks the rest.
- BUY/ADD clamps to available cash; a zero/clamped share count yields no-op
  rather than negative cash.
- `computeInvestStats` treats a missing price as cost-basis value (never zero)
  and flags it.

## Testing

`node:test` co-located files:
- `investStats.test.ts`: equity = cash + MTM; unrealized/realized P/L; missing
  price falls back to cost basis.
- `rebalance.test.ts`: SELL on avoid; BUY a new in-zone name up to maxPositions;
  no BUY when out of zone or at capacity; TRIM when overweight beyond band; ADD
  when underweight beyond band; SELL/TRIM ordered before BUY/ADD.
- executor avg-cost math: ADD recomputes weighted avg; TRIM/SELL accrues
  realizedPnl and leaves avgCost unchanged; BUY/ADD clamp to cash.
- `kind` guard: invest routes reject non-invest; swing routes reject invest
  (pure helper `isInvestPortfolio(kind)` or reuse existing guards).

## Out of scope (for now)

- Autonomous (non-advisory) execution.
- Dividends, splits, fees/commissions.
- Tax-lot / FIFO accounting — avg-cost only.
- Multi-currency.
- Broker / live execution.
- Drift rebalancing for swing portfolios.
