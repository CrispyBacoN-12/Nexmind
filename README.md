# NEXMIND — AI Trading Guild

A multi-agent "AI guild" web app: a personal Secretary routes your commands to the
right team, and an AI trading desk makes team-based decisions on live market data —
all in **paper mode** (no broker, no money at risk).

## The trading desk (paper)

```
SCANNER (no AI)  →  HAWK ×3 (vote 2/3)  →  SAGE (risk veto)  →  Iron Rules (pure code)  →  paper fill
   indicators        3 analysts             may VETO/tighten      R:R, spread, lot,         staged TP
   on Yahoo data     trend/structure/        SL & TP              daily-loss cap            + decision log
                     counter-trend
```

- **SCANNER** computes MA/RSI/MACD/ATR/ADX + swing detection on free Yahoo candles. No AI — wakes the team only on a setup.
- **HAWK ×3** — three analyst personas reason independently; 2-of-3 must agree on a direction.
- **SAGE** — independent risk review with VETO power; may tighten SL/TP. Uses the most capable model.
- **Iron Rules** — pure, deterministic gate (`src/lib/trading/ironRules.ts`). Never an LLM. Hard-clamps every value.
- **Executor** — simulates a fill and logs the full decision trail to the DB.

## The agent pipeline (Command Bridge)

ARIA (the Secretary) plans an ordered set of steps across the 20+ guild agents
(dev / design / content / intelligence / trading / finance / systems), runs each,
and reports back — e.g. *"design a dashboard"* → LUNA (UX) → NOVA (frontend) → summary.

## Stack

Next.js 16 (App Router) · Prisma 7 + SQLite · Anthropic SDK · Tailwind v4 · TypeScript.
Indicator/Yahoo/swing libs are reused from the sibling `stock-tracker` project.

## Setup

```bash
npm install
cp .env.example .env          # add ANTHROPIC_API_KEY to enable real AI (optional)
npm run db:push -- --url "file:./dev.db"   # create the SQLite schema
npm run db:seed               # seed the 28-agent roster + demo trades
npm run dev                   # http://localhost:3000
```

**Without an `ANTHROPIC_API_KEY`** the app still runs: HAWK/SAGE and the Secretary use a
deterministic **mock path**, so you can demo the full pipeline before paying for tokens.
Add the key to switch on real Claude analysis (model tiers: Haiku/Sonnet/Opus per agent).

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

## Pages

| Route | What |
|---|---|
| `/` | **War Room** — live trade feed, decision trails, SAGE vetoes, SCOUT intel |
| `/command` | **Command Bridge** — dispatch a command to ARIA; run a paper trade tick |
| `/roster` | **Agent Roster** — the 20+ guild cards, filterable by team |
| `/graph` | **Team Graph** — the org tree (CEO → Secretary → leads → specialists) |
| `/reports` | **Reports** — win rate, expectancy, drawdown by period + lessons learned |

## API

- `POST /api/trade-tick` `{ symbol }` — run the desk once (e.g. `GC=F`, `BTC-USD`, `EURUSD=X`).
- `POST /api/pipeline` `{ command }` → `{ pipelineId }`; `GET /api/pipeline?id=N` to read steps + summary.

## Tests

```bash
npm test          # node --test over src/**/*.test.ts (Iron Rules covered)
```

## Roadmap status

M0–M5 are built (scaffold, data model + War Room, agent pipeline, paper trading engine,
SCOUT intel surface, reports + lessons scaffold). **Go-Live is deferred**: a Python/FastAPI
MT5 bridge replaces the paper `executor` behind the same interface once ≥1 month of demo
metrics clear thresholds. See `../../.claude/plans/ai-peaceful-falcon.md`.
