# NEXMIND Autopilot — Design Spec

Date: 2026-06-11
Status: approved by user (chat), implementing

## Goal

Close the gap between NEXMIND and the target architecture diagram (orchestrator bot +
hard risk gate + live intel + position management), while staying **paper-mode only**
(no broker, MT5 deferred per existing roadmap).

Four features, in build order:

1. Bot Loop (standalone orchestrator script)
2. Kill switch + max open positions (Iron Rules extension)
3. Real news feed + Fear & Greed index (SCOUT goes live)
4. Partial close at TP1 + breakeven trailing SL (manage.ts upgrade)

Out of scope: MT5/broker bridge, Windows service/auto-start, new UI pages
(reuse Command Bridge), per-symbol exposure limits.

## 1. Bot Loop — `scripts/bot.ts`

Standalone Node script (run via `npm run bot`, tsx). Talks to the running Next.js
app over HTTP — it owns scheduling only; all logic stays in the app.

- Base URL: `process.env.NEXMIND_URL ?? "http://localhost:3000"`.
- Cadence (single `setInterval` tick every 60s, with per-job elapsed counters):
  - every **5 min** → `POST /api/manage` (always runs, even when kill switch is on,
    so open positions still close at SL/TP).
  - every **15 min** → `POST /api/scan-all` (skipped while kill switch is on).
  - every **30 min** → `POST /api/intel/refresh` (news + Fear & Greed).
- Reads kill switch via `GET /api/settings` before each scan cycle.
- Console log per cycle: timestamp, job, summary (e.g. closed/checked counts,
  setups found, news inserted) or error. Errors never crash the loop —
  catch, log, continue.
- Graceful shutdown on SIGINT.

`package.json`: add `"bot": "tsx scripts/bot.ts"` script; add `tsx` devDependency
(if not already present).

## 2. Kill switch + max open positions

### Schema

New Prisma model (the only schema change in this project):

```prisma
/// App-wide key-value settings (kill switch, limits, cached intel).
model Setting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

Keys used: `killSwitch` ("true"/"false", default false),
`maxOpenPositions` (int as string, default "5"),
`fearGreed` (JSON `{value, label, fetchedAt}` — written by intel refresh, §3).

`lib/settings.ts`: `getSetting(key, fallback)`, `setSetting(key, value)`,
plus typed helpers `isKillSwitchOn()`, `getMaxOpenPositions()`.

### Iron Rules (`lib/trading/ironRules.ts`)

Extend `AccountState`:

```ts
killSwitch?: boolean;        // default false
openPositions?: number;      // current open trade count
maxOpenPositions?: number;   // cap; only enforced when both provided
```

New failures (TDD — tests first in `ironRules.test.ts`):
- `killSwitch === true` → "kill switch engaged — trading halted"
- `openPositions >= maxOpenPositions` → "max open positions reached (N/N)"

### Engine

`engine.ts` builds `AccountState` from DB: `prisma.trade.count({status:"open"})`
+ settings. No behavior change when settings are absent (defaults apply).

### API + UI

- `GET /api/settings` → `{killSwitch, maxOpenPositions, fearGreed}`.
- `POST /api/settings` body `{killSwitch?, maxOpenPositions?}` → updates.
- Command Bridge: red **EMERGENCY STOP** toggle card (shows current state,
  flips killSwitch via the API) + maxOpenPositions number input.

## 3. Real news + Fear & Greed — `lib/intel/news.ts`

### Finnhub general news

- `fetchFinnhubNews()`: `GET https://finnhub.io/api/v1/news?category=general&token=FINNHUB_API_KEY`.
- Map to `NewsItem`: source="Finnhub", title=headline, summary, url, createdAt.
- Dedupe: skip items whose `url` already exists in NewsItem (query existing urls
  for the batch first). Insert at most 10 newest per refresh.
- No key configured → return `{inserted: 0, error: "FINNHUB_API_KEY not set"}`
  without throwing. Copy the key from stock-tracker's `.env` into nexmind `.env`.

### Fear & Greed

- `fetchFearGreed()`: `GET https://api.alternative.me/fng/` (free, no key, crypto F&G).
- Store as Setting `fearGreed` = `{value: 0-100, label: "Extreme Fear"…, fetchedAt}`.

### Wiring into the brains

`engine.ts` and `analyze.ts` `latestNewsDigest()`: prepend one line
`Fear & Greed: 25 (Extreme Fear)` from the cached setting when present.
HAWK and SAGE see it on every call with zero extra fetch latency.

### API

`POST /api/intel/refresh` → runs both fetches, returns
`{news: {inserted, skipped}, fearGreed: {value, label} | null}`.
Called by the bot every 30 min; can also be hit manually.

## 4. Partial close + breakeven SL — `lib/trading/manage.ts`

### Pure decision core (new, TDD)

`lib/trading/positionRules.ts`:

```ts
type LadderState = { tp1Hit?: boolean; partialPnl?: number };
type Action =
  | { kind: "hold" }
  | { kind: "close"; outcome: "win" | "loss" | "breakeven" }
  | { kind: "partial-tp1" };  // close half, SL → entry

decideAction(trade: {side, entry, sl, tp1, tp2?}, ladder: LadderState, price): Action
```

Rules (side-aware):
- No `tp2` on the trade → legacy behavior: full close at TP1 (win) or SL (loss).
- With `tp2`, before TP1 hit: price ≥ TP1 (long) → `partial-tp1`; price ≤ SL → full loss.
- After TP1 hit: price ≥ TP2 → full close win; price ≤ entry (the new breakeven SL)
  → close remaining as breakeven.

Tests in `positionRules.test.ts`: long & short × {SL hit, TP1 partial, TP2 after
partial, breakeven after partial, hold, legacy no-tp2}.

### manage.ts changes

- Ladder state persists in the existing `Trade.stagedTp` JSON column
  (**no Trade schema change**).
- `partial-tp1`: realized half-lot P/L accumulates into `stagedTp.partialPnl`,
  set `stagedTp.tp1Hit=true`, update `sl = entry`. Trade stays `open`.
- Final close: `pnl = partialPnl + remaining-lot P/L` (POINT_VALUE=1 as today,
  half lot = `lot/2`), set outcome/closedAt/rMultiple as today.
- Summary return gains `partials: number`.

## Testing & verification

- `npm test` (node:test): ironRules new rules + positionRules suite.
- Live: `prisma db push` (Setting model) → restart dev server (Prisma client
  caching gotcha) → toggle kill switch in UI → scan blocked with reason →
  toggle off → `POST /api/intel/refresh` inserts real news →
  `npm run bot` and observe one full cycle in console.

## Build order

2 (Iron Rules + settings, TDD) → 3 (intel) → 4 (manage, TDD) → 1 (bot script ties
it together) → UI toggle → live verification.
