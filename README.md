# NEXMIND — AI Trading Guild

A multi-agent "AI guild" web app: a personal Secretary routes your commands to the
right team, and an AI trading desk makes team-based decisions on live market data —
all in **paper mode** (no broker, no money at risk). NEXMIND trades **US stocks
only**; the gold/forex/crypto/options desks were removed in the stocks-only pivot.

## The trading desk (paper)

```
SCANNER (no AI)  →  HAWK ×3 (vote 2/3)  →  SAGE (risk veto)  →  Iron Rules (pure code)  →  paper fill
   indicators        3 analysts             may VETO/tighten      R:R, spread, lot,         staged TP
   on Yahoo data     trend/structure/        SL & TP              daily-loss cap            + decision log
                     counter-trend
```

- **SCANNER** computes MA/RSI/MACD/ATR/ADX + swing detection on free Yahoo candles. No AI — wakes the team only on a setup.
- **HAWK ×3** — three analyst personas reason independently; 2-of-3 must agree on a direction.
  All three read the *same* facts sheet (`src/lib/trading/context.ts`) and differ only by lens,
  so a disagreement is a disagreement about the read, not about who got which numbers.
- **SAGE** — independent risk review with VETO power; may tighten SL/TP. Uses the most capable model.
- **Iron Rules** — pure, deterministic gate (`src/lib/trading/ironRules.ts`). Never an LLM. Hard-clamps every value.
- **Executor** — simulates a fill and logs the full decision trail to the DB.

## The agent pipeline (Command Bridge)

ARIA (the Secretary) plans an ordered set of steps across the 20+ guild agents
(dev / design / content / intelligence / trading / finance / systems), runs each,
and reports back — e.g. *"design a dashboard"* → LUNA (UX) → NOVA (frontend) → summary.

## Stack

Next.js 16 (App Router) · Prisma 7 + Postgres (Neon) · Anthropic SDK · Tailwind v4 · TypeScript.
Indicator/Yahoo/swing libs are reused from the sibling `stock-tracker` project.

## Setup

```bash
npm install
cp .env.example .env          # set DATABASE_URL; AI backend is optional (see below)
npm run db:push               # push the schema to the Postgres in DATABASE_URL
npm run db:seed               # seed the agent roster + demo trades
npm run dev                   # http://localhost:3275
```

### Which AI actually decides

`src/lib/anthropic.ts` resolves one backend, in this order:

| # | Condition | Backend | `aiBackend()` |
|---|---|---|---|
| 1 | `ANTHROPIC_API_KEY` set | Anthropic SDK, pay per token | `"api"` |
| 2 | Claude Code CLI on PATH | `claude -p` headless, subscription auth | `"cli"` |
| 3 | neither, or the chosen one can't authenticate | deterministic **mock path** | `"mock"` |

Path 3 is a legitimate mode — the desk keeps trading on rules alone rather than
500ing — but it is never disguised as analysis. Every trade stores which backend
produced its votes (`Trade.aiBackend`), the War Room badges mock trades, and an
outage banner says so at the top of the page.

For ephemeral runners with no persisted `claude login` (GitHub Actions), set
`CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`. It is injected into the
spawned CLI child only, so resolution still picks path 2.

### Market data

NEXMIND reads candles and prices through a provider router
(`src/lib/marketData.ts`). By default it uses Yahoo Finance (no key needed).
If you set `ALPACA_KEY`/`ALPACA_SECRET`, Alpaca is tried first; if you set
`WEBULL_BASE_URL` + `WEBULL_APP_KEY`/`WEBULL_APP_SECRET` **and** seed an access
token (below), Webull is tried next; Yahoo is always the final fallback. Any
provider failure (missing key, bad response, empty bars, a series that has
stopped updating, or a Webull call slower than 5s) falls through to the next one
automatically, and the response reports which provider actually answered.

Webull led until 2026-08-30, when it was measured against Alpaca and Yahoo on
the same symbols and dates: its closes disagreed on 99.4% of SPY bars and 86.6%
of AAPL's, and its SPY series turned out to be spliced from two instruments.
Because it never threw, Alpaca was never reached. See `providerOrder()` for the
full measurement.

That measurement was against Webull's **sandbox** host, which is what the code
signed against at the time and which serves a partially refreshed fixture set —
15 of 50 large caps came back frozen (nine at 2026-07-15, five since 2024), with
price errors up to 39.8%. `webull.ts` now signs against production, which
matched Alpaca to the cent on every one of those symbols. Two guards stand
behind that: `sanitizeResponse()` drops frozen `o=h=l=c` placeholder bars and
re-quotes from what survives, and `isStale()` rejects a series whose newest bar
is too old — `coversDays()` measures span, not recency, so every one of those
frozen series passed it.

**Webull access token.** Production market data needs an `x-access-token`, and
minting one needs a tap in the Webull mobile app — once. Run:

```bash
node --env-file=.env --import tsx scripts/webull-seed-token.mts
```

and approve within ~6 minutes. The token lives 15 days and refreshes without a
second approval, so `ensureWebullTokenFresh()` (called once per scan tick, since
Alpaca leads and Webull is otherwise rarely reached) rolls it forward on its
own. If a refresh starts failing, the War Room shows a banner with the days left
before a human is needed again. The token is stored in `Setting` and never
logged.

**Webull is data-only.** The PaperTrade shadow-execution path was removed on
2026-08-22 — orders are manual. `/openapi/trade/*` may well be reachable with a
NORMAL token, but that is untested and deliberately out of scope.

### Measuring whether the analysts help

Two mechanisms exist so the desk can be judged instead of admired:

- **Counterfactual arms** (`src/lib/trading/counterfactual.ts`) — every tick where the
  scanner fired *and* a real backend was live records both what the team decided and
  what pure rules would have done with the same candles, scored per **opportunity**
  rather than per trade, so a veto costs exactly 0R instead of vanishing from the
  sample. `/scoreboard` shows both arms; `scripts/ai-arm-report.mts` prints them.
- **Confluence filters** (`src/lib/trading/scanner.ts`) are pure vetoes, inert until
  switched on, and `scripts/setup-filter-sweep.mts` sweeps them one factor at a time
  with an IS/OOS split fixed by calendar (2023-01-01) before any result is seen.

## Scheduling

| Workflow | Cadence | What |
|---|---|---|
| `.github/workflows/swing-scan.yml` | every 15 min | the real trade-tick pipeline for every active swing portfolio |
| `.github/workflows/research-round.yml` | daily | QUANT research round |
| `.github/workflows/cleanup-signals.yml` | daily | prune stale signals |
| `.github/workflows/ci.yml` | on push | typecheck + tests |

The scan runs on the runner (`scripts/scan.mts`), not on Vercel — a serverless
function can't host a `claude login` session, so a Vercel-side scan would silently
fall back to the mock path.

## Pages

| Route | What |
|---|---|
| `/` | **War Room** — live trade feed, decision trails, SAGE vetoes, AI-backend status |
| `/command` | **Command Bridge** — dispatch a command to ARIA; run a paper trade tick |
| `/analyze` | **Analyst** — run the three lenses on any symbol, no trade written |
| `/scoreboard` | **Scoreboard** — do the analysts add money? both arms, side by side |
| `/backtest` | **Backtest** — replay a strategy over history with the disclosed cost model |
| `/research` | **Research** — QUANT proposals awaiting review |
| `/activity` | **Activity** — recent runs, scans, and errors |
| `/reports` | **Reports** — win rate, expectancy, drawdown by period + lessons learned |
| `/roster` | **Agent Roster** — the 20+ guild cards, filterable by team |
| `/graph` | **Team Graph** — the org tree (CEO → Secretary → leads → specialists) |
| `/build` | **Builder** — codegen scratchpad |

## API

- `POST /api/trade-tick` `{ symbol }` — run the desk once (e.g. `AAPL`, `NVDA`).
- `POST /api/scan-all` — one tick for every active swing portfolio.
- `POST /api/pipeline` `{ command }` → `{ pipelineId }`; `GET /api/pipeline?id=N` to read steps + summary.
- `POST /api/analyze` `{ symbol }` — the three lenses, no trade written.

## Tests

```bash
npm test          # tsx --test over src/**/*.test.ts
npm run typecheck # tsc --noEmit
```

## Roadmap status

M0–M5 are built (scaffold, data model + War Room, agent pipeline, paper trading engine,
SCOUT intel surface, reports + lessons). **Go-Live is deferred and unscheduled**: the
old plan routed fills through an MT5 bridge, which died with the forex/gold desks; the
current broker (Webull) exposes no unattended order API, so live orders would be manual.
Until an arm comparison shows the analysts adding money over the rule-only baseline,
there is nothing worth going live with.
