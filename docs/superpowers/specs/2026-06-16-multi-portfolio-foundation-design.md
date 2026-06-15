# Multi-Portfolio Foundation (Phase 0) — Design

**Date:** 2026-06-16
**Status:** Approved (design), pending implementation plan
**Scope:** Introduce a `Portfolio` entity so NEXMIND can run several independent
paper portfolios at once — each with its own balance, risk settings, watchlist,
and kill switch — plus a global emergency trading halt, per-portfolio
active/archived status, a lean UI to switch between them, and an overview strip.
**Explicitly out of scope:** portfolio *deletion* (archiving is in scope),
per-`kind` strategy logic (all portfolios use the current swing engine),
options, leverage/margin, broker/live execution, automatic cross-portfolio risk
aggregation (the global halt is a manual switch, not a computed limit).

## Motivation

This is Phase 0 of a larger roadmap toward an AI multi-portfolio manager
(long-term invest, medium/short swing, options, leverage). Every later phase is
a *type* of portfolio; none can be built cleanly until the core data model
understands "a portfolio" as a first-class thing.

Today NEXMIND has exactly one implicit portfolio: the `Trade` table has no
portfolio scoping, and all risk settings (`startingBalance`, `riskPctPerTrade`,
`maxOpenPositions`, `killSwitch`, `killSwitchReason`, `drawdownHaltPct`) live in
a flat global `Setting` key-value table. Trades are read in seven places
(engine, manage, circuitBreaker, War Room `/`, reports, roster, agent route).
Phase 0 makes all of this portfolio-aware.

## Architecture

A new `Portfolio` row owns the risk configuration that is currently global.
Trades, signals, and watchlist entries each gain a required `portfolioId`. The
trading core (engine, manage, circuitBreaker) takes a `portfolioId` and scopes
every query and every kill-switch/drawdown decision to that one portfolio. The
UI gains a portfolio switcher (selected portfolio flows through pages via a
query param) and an overview strip showing each portfolio's live stats. All
portfolios share the existing swing engine in Phase 0 — they differ only by
configuration and watchlist, not behavior.

## Components

### 1. Data model (`prisma/schema.prisma`)

**New `Portfolio` model:**
```
model Portfolio {
  id               Int      @id @default(autoincrement())
  name             String                       // "Default", "Swing US", …
  kind             String   @default("swing")   // strategy label only in Phase 0
  status           String   @default("active")  // active | archived (enforced)
  startingBalance  Float    @default(10000)
  riskPctPerTrade  Float    @default(1)
  maxOpenPositions Int      @default(5)
  drawdownHaltPct  Float    @default(10)
  killSwitch       Boolean  @default(false)
  killSwitchReason String   @default("")
  sort             Int      @default(0)
  createdAt        DateTime @default(now())
  trades           Trade[]
  signals          Signal[]
  watchlist        Watchlist[]
}
```

`status` is **enforced**, not a reserved label: an `archived` portfolio is
hidden from the switcher and overview strip and is skipped by scan/tick. It is
distinct from `killSwitch` (a risk halt that keeps the portfolio visible/active
but blocks new entries) — `archived` means "retired from view." Note `kind`
(strategy type) and `status` (lifecycle) are independent axes.

```text
GLOBAL EMERGENCY HALT (global Setting, not a Portfolio column):
  globalTradingHalt: "true" | "false"  (default "false")
```

**Modified models:**
- `Trade` — add `portfolioId Int` + `portfolio Portfolio @relation(...)`.
- `Signal` — add `portfolioId Int` + relation. The scanner runs per portfolio,
  so each candidate records the portfolio it was scanned for; the resulting
  trade inherits it.
- `Watchlist` — add `portfolioId Int` + relation; replace `symbol @unique`
  with `@@unique([portfolioId, symbol])` so each portfolio has its own list.

**Migration / backfill** (this project uses `prisma db push`, not migrations):
1. Add the `Portfolio` model and add the new FK columns as nullable.
2. Run a one-time backfill: create a `Default` portfolio seeded from the current
   global `Setting` values (startingBalance, riskPctPerTrade, maxOpenPositions,
   drawdownHaltPct, killSwitch, killSwitchReason); set every existing
   `Trade`, `Signal`, and `Watchlist` row's `portfolioId` to it.
3. Make the three `portfolioId` columns required after backfill.
The `db:seed` script is updated to create the `Default` portfolio and attach
seeded demo trades/watchlist to it, so a fresh DB also works.

### 2. Settings refactor (`src/lib/settings.ts`)

The per-portfolio getters (`getStartingBalance`, `getRiskPctPerTrade`,
`getMaxOpenPositions`, `getDrawdownHaltPct`, `isKillSwitchOn`,
`getKillSwitchReason`) change to take a `portfolioId` and read from the
`Portfolio` row instead of the global `Setting` table. The corresponding writes
(`setSetting("killSwitch", …)` etc. in manage.ts) become `Portfolio` updates.
The global `Setting` table and its helpers (`getSetting`/`setSetting`) remain
for genuinely global state (`fearGreed` cache, and the new `globalTradingHalt`
flag with a typed `isGlobalTradingHalt()` getter defaulting to false). The old
per-portfolio keys are migrated into the Default portfolio and no longer read
from `Setting`.

### 3. Trading core scoping

- `src/lib/trading/circuitBreaker.ts` — `getCurrentDrawdownPct(portfolioId)`
  filters closed trades by `portfolioId` and uses that portfolio's
  `startingBalance`.
- `src/lib/trading/manage.ts` — `manageOpenTrades(portfolioId)` manages only
  that portfolio's open trades and, on drawdown breach, sets that portfolio's
  `killSwitch` + `killSwitchReason`.
- `src/lib/trading/engine.ts` — the trade tick takes `portfolioId`; Iron Rules
  read that portfolio's `killSwitch` and count *its* open trades for the
  `maxOpenPositions` gate; new trades are created with that `portfolioId`.
- The scanner scans the selected portfolio's watchlist.

**Two global guards layered above per-portfolio risk:**
- `globalTradingHalt` (manual emergency brake) — when true, *every* portfolio's
  tick/scan blocks new entries immediately, regardless of per-portfolio state.
  Checked in the same gate as `killSwitch`: a new entry is allowed only when
  `!globalTradingHalt && !portfolio.killSwitch`.
- `status === "archived"` — an archived portfolio is skipped entirely by
  scan/tick (no scanning, no new entries; existing open trades are left as-is
  for `manageOpenTrades` to close normally if invoked, but archived portfolios
  are not auto-ticked).

### 4. API

- `GET /api/portfolios` — list portfolios with live computed stats: `equity`
  (startingBalance + realized P/L), `openCount`, `realizedPnl`,
  `currentDrawdownPct`, plus stored settings, `status`, and killSwitch state.
  Defaults to active portfolios; `?includeArchived=1` returns archived too.
- `POST /api/portfolios` — create a portfolio (name, kind, startingBalance,
  riskPctPerTrade, maxOpenPositions, drawdownHaltPct).
- `PATCH /api/portfolios/[id]` — update settings, killSwitch/reason, and
  `status` (archive/unarchive) for one portfolio (replaces the per-portfolio
  half of the old `/api/settings` POST).
- Trade-tick / scan endpoints accept a `portfolioId` and operate on it; they
  reject when the portfolio is archived or when `globalTradingHalt` is on.
- `/api/settings` is slimmed to global-only state (`fearGreed`,
  `globalTradingHalt`); its POST toggles `globalTradingHalt`.

### 5. UI (lean)

- **Global halt control** — a prominent toggle (above the switcher) bound to
  `globalTradingHalt` via `/api/settings`; when on, the UI shows a clear
  "all trading halted" banner.
- **Portfolio switcher** — a dropdown listing active portfolios; the choice is
  carried through War Room (`/`), Reports, and the Safety panel via a
  `?portfolio=<id>` query param. Absent param defaults to the lowest-`sort`
  active portfolio. Archived portfolios are excluded.
- **Overview strip** — a row of compact cards (one per portfolio) at the top of
  the War Room (`/`): name, kind, equity, realized P/L, open positions, current
  drawdown, and kill-switch status. Lets the user see all portfolios at a glance
  and click a card to select it (sets `?portfolio=<id>`).
- **Safety panel** — edits the *selected* portfolio's settings via
  `PATCH /api/portfolios/[id]` (drawdown halt %, risk %, max open, kill switch),
  plus an archive/unarchive action.
- **New-portfolio form** — minimal create form (name, kind, startingBalance,
  riskPctPerTrade, maxOpenPositions, drawdownHaltPct) posting to
  `POST /api/portfolios`.

## Data flow

Select a portfolio → every scoped view filters by `portfolioId` → a tick/scan
targets that portfolio → resulting trades/signals are tagged with it → the
overview strip aggregates stats per portfolio (with a combined total).

## Error handling

- An unknown or missing `portfolioId` on a scoped API call returns 404 (unknown)
  or falls back to the default portfolio (missing query param on a page).
- Creating a portfolio validates numeric fields (`startingBalance > 0`,
  `riskPctPerTrade > 0`, `maxOpenPositions > 0`, `drawdownHaltPct > 0`) and a
  non-empty `name`; invalid input returns 400.
- The trading core reads only one global flag (`globalTradingHalt`); all
  *per-portfolio* risk values come from the `Portfolio` row. If a portfolio row
  is absent for a given id, the operation errors rather than silently using
  global defaults.

## Testing

`node:test` co-located files, run via `npm test`:
- A pure portfolio-stats helper (compute `equity`, `realizedPnl`,
  `currentDrawdownPct`, `openCount` from a portfolio's trades) — unit-tested
  with crafted trade arrays, reusing `currentDrawdownPct` from circuitBreaker.
- Settings getters resolve from a `Portfolio` row (typed, with the documented
  numeric fallbacks preserved).
- Iron Rules `maxOpenPositions` gate counts only the target portfolio's open
  trades (a portfolio at its cap does not block a different portfolio).
- The entry gate blocks when `globalTradingHalt` is on even if the portfolio's
  own `killSwitch` is off (global guard wins).
- Scan/tick skips an `archived` portfolio (no new entries) while a different
  active portfolio still trades.
- The backfill logic assigns a deterministic Default portfolio id and leaves no
  trade/signal/watchlist row with a null `portfolioId`.

## Out of scope (for now)

- Deleting portfolios — Phase 0 supports create, edit, and archive (no hard
  delete; archived rows are retained).
- Per-`kind` strategy behavior — `kind` is a label; all portfolios run the
  current swing engine.
- Options, leverage/margin, futures instruments.
- Broker / live execution.
- *Automatic* cross-portfolio aggregate risk limits (computed thresholds that
  trip on their own). The `globalTradingHalt` switch is a *manual* brake and is
  in scope; auto-computed aggregate limits are not.
