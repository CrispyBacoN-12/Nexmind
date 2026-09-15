# Risk Sentry: an unattended daily risk-monitoring cron

**Date:** 2026-09-16
**Status:** Draft — pending user review
**Scope:** Pillar 2 of a 4-pillar automation proposal for NEXMIND. This spec covers only Risk Sentry. Pillars 1 (Lifecycle & Exit Manager), 3 (Chart Hygiene via CDP), and 4 (Execution & Friction Audit) are each a separate subsystem and each needs its own brainstorm → spec → plan cycle; they are out of scope here and nothing in this design depends on them.

## 0. Why this exists

NEXMIND pivoted on 2026-09-15 from an alpha-seeking autonomous desk to an "Execution & Risk Copilot" centered on `/advisor` (`docs/STATE.md`). The pivot's own language is explicit that the *autonomous* machinery — the scheduled scan/manage/research jobs, the panel research loop — is paused and must not be re-enabled or re-tuned.

Risk Sentry is not that machinery. It automates nothing about entries, sizing, or exits — it computes the same three read-only checks `/advisor` already computes for a single on-demand request (market gate, earnings proximity, portfolio correlation) and reports them once a day, unattended, for whatever the owner is currently holding. Nothing it does is a re-enable of the paused desk:

- The paused jobs decided **what to trade**. Risk Sentry decides nothing — it has no entry rule, no exit rule, no size, and no fill path.
- The paused jobs ran the trend-pullback rule through HAWK/SAGE and executed. Risk Sentry runs three pure functions that already exist (or are trivial variations of code that already exists) and posts a Discord message.
- STATE.md's "do not resume panel-v1 research rounds" and "do not spend effort tuning it further" refer to the exit-geometry and entry-rule research axes, both explicitly closed (`[[nexmind-exit-alone-is-long-drift]]`, `[[nexmind-entry-is-late]]`). Risk Sentry makes no edge claim, backtests nothing, and tunes no parameter — it is presentation of already-computed, already-trusted numbers on a schedule instead of on a page load.

This distinction matters enough to restate at the top because a `vercel.json` cron entry is exactly the kind of artifact that, read out of context six months from now, looks like "a scheduled job was re-enabled." It was not. This one exists under the Copilot pivot, for risk *monitoring*, not the old alpha-seeking pipeline.

The three checks:

1. **Earnings watchdog** — does any held name report earnings in the next N days?
2. **Market gate monitor** — did the SPY-vs-SMA200 regime flip since the last check?
3. **Correlation alert** — does any pair of held names exceed a correlation threshold?

All three are already partially or fully computed inside `advise()` for a single ticker against a typed-in holdings list on every `/advisor` request. What Risk Sentry adds is *unattended* — running them once a day against the owner's *actual* holdings without the owner opening the page — which requires knowing what the owner holds without being told in the request body.

## 1. Architecture

```
src/lib/riskSentry/
  holdings.ts           — get/set the holdings list (Setting-row wrapper)
  earningsWatchdog.ts    — pure: which holdings report earnings soon
  correlationAlert.ts    — pure: which pairs of holdings are too correlated
  marketGateAlert.ts     — pure: did the gate reading flip since last time
  runRiskSentry.ts       — composes the three checks + one Discord message
  *.test.ts              — unit tests for each pure module

src/app/api/cron/risk-sentry/
  route.ts               — the only I/O boundary: auth, fetch, call runRiskSentry, notify

src/app/settings/ (existing page)
  + a small "Risk Sentry holdings" editor — the one new UI surface
```

**Boundary rule, matching `/advisor`'s own:** everything under `src/lib/riskSentry/` is pure or DB-trivial — no direct `fetch()` to a market-data provider, no Discord call from inside a check. `runRiskSentry.ts` composes pure results into one message; `route.ts` is the only place that touches the network, Prisma, and the clock together.

### 1.1 Reused as-is, no edits to existing code

| Piece | From | Used for |
|---|---|---|
| `gateSlots(benchmark, freeSlots, cfg)` | `src/lib/market/marketGate.ts` | the market-gate leg — same SPY-vs-SMA200 computation `/advisor` uses |
| `fetchNextEarnings(ticker)` | `src/lib/market/earnings.ts` | the earnings leg — same Finnhub call, same fail-soft `EarningsInfo` shape |
| `dailyReturns`, `pearsonCorrelation` | `src/lib/trading/correlation.ts` | the correlation leg's underlying math |
| `fetchCandlesBatch(symbols, range, interval)`, `fetchCandles(symbol, range, interval, minDays)` | `src/lib/marketData.ts` | fetching holdings' and the benchmark's candles |
| `sendDiscordNotification(message, level)` | `src/lib/notify/discord.ts` | the single consolidated alert; fail-soft exactly as `cron/scan` already relies on |
| `assertCronAuth(req)` | `src/lib/cronAuth.ts` | same Bearer-`CRON_SECRET` guard every `/api/cron/*` route already uses |
| `getSetting(key, fallback)` / `setSetting(key, value)` | `src/lib/settings.ts` | the holdings list and the last-gate-reading, both stored as `Setting` rows — no new Prisma model |
| cron-route shape (`assertCronAuth` → business logic in try/catch → `sendDiscordNotification(..., "critical")` on failure) | `src/app/api/cron/scan/route.ts` | the exact pattern `risk-sentry/route.ts` follows |

### 1.2 Deliberately not reused

- **`advise()` itself is not called.** It is built around a single asked-about ticker plus a holdings list supplied in the request; Risk Sentry has no "asked-about ticker" — every holding is a peer, not a candidate. Calling `advise()` once per holding would also compute sizing, an R-ladder, and cost-in-R for names nobody is entering today, none of which Risk Sentry needs or should print.
- **`advise()`'s correlation is ticker-vs-holding, not holding-vs-holding.** `advise.ts` pairs the *asked-about* ticker's returns against each holding's returns; it never compares two holdings to each other. Risk Sentry's correlation alert needs the full pairwise matrix across N holdings, which is new (small) code built on the same `pearsonCorrelation` primitive — see §2.3.
- **No new Prisma model.** See §1.3.

### 1.3 Holdings storage — the one real fork

No holdings-persistence model exists anywhere in the schema. `/advisor`'s holdings are parsed fresh from the POST body on every request (`readHoldings` in `route.ts`) and never written anywhere; `Watchlist` is a portfolio's *scan-candidate* list, not the owner's real positions, and is scoped to a `portfolioId` that has nothing to do with what the owner actually holds at Webull.

An unattended cron cannot ask the owner what they hold, so it needs *some* small persistence. Decision: reuse the existing `Setting` key-value table rather than add a dedicated Prisma model.

- `riskSentry:holdings` → JSON array of ticker strings (mirrors the shape `/advisor` already accepts, just persisted instead of typed).
- `riskSentry:lastGate` → `"above" | "below" | "unknown"`, the previous run's `benchAbove` reading, used to detect a flip (§2.2).

This is a YAGNI call, not a permanent architecture decision: only a plain ticker list is needed for these three checks, and a fuller `Holding` model (with cost basis, share count, entry date) would exist to serve Pillars 1 and 4, which are not approved yet. If either of those pillars is designed later and needs richer per-holding data, that is the point to revisit this, not before.

`src/lib/riskSentry/holdings.ts` wraps this:

```ts
export async function getRiskSentryHoldings(): Promise<string[]>
export async function setRiskSentryHoldings(tickers: string[]): Promise<void>
```

validating/deduping/uppercasing on write with the same `TICKER_RE` and cap (20) `route.ts` already uses for `/advisor`, so the two lists can never silently diverge in what counts as a valid ticker.

### 1.4 The one new UI surface

A small section on the existing `/settings` page: a text list (comma- or newline-separated tickers). `src/app/api/settings/route.ts` already reads/writes a fixed set of named `Setting` keys through typed fields on its `GET`/`POST` (`globalTradingHalt`, `fearGreed`) rather than accepting an arbitrary key — Risk Sentry's holdings list is added the same way: a `riskSentryHoldings: string[]` field on that route's existing snapshot/POST body, going through `getRiskSentryHoldings`/`setRiskSentryHoldings` (§1.3) for the validation. No new route. This is the only place the owner interacts with Risk Sentry; everything else is unattended.

## 2. The three checks

### 2.1 Earnings watchdog

For each held ticker, call `fetchNextEarnings(ticker)`. Flag any holding whose `date` falls within `EARNINGS_WATCHDOG_DAYS` (proposed: 3 calendar days) of the run date. `fetchNextEarnings` already never throws and always carries a reason when `date` is null, so "no earnings data" and "no earnings scheduled" render as distinct, already-correct lines — the watchdog does not need to invent that distinction.

```ts
export function earningsWatchdog(
  results: { ticker: string; earnings: EarningsInfo }[],
  today: Date,
  windowDays = EARNINGS_WATCHDOG_DAYS,
): { ticker: string; date: string; hour: string | null; daysAway: number }[]
```

Pure: takes already-fetched `EarningsInfo` per ticker plus the clock, returns the flagged subset. `route.ts` does the `fetchNextEarnings` calls (one per holding, same as `/advisor` does one for the asked-about ticker).

### 2.2 Market gate monitor

Fetch the benchmark exactly as `/advisor` does (`fetchCandles(BENCHMARK, "2y", "1d", 300)`) and call `gateSlots(benchmark, 0)` — `0` because Risk Sentry has no slot count of its own to report; only `benchAbove` and `note` are read from the result, and `slots` is discarded.

The alert fires **only on a flip**, not every run: compare `gate.benchAbove` against the persisted `riskSentry:lastGate` Setting. Three states (`"above" | "below" | "unknown"`) so a BLIND reading is distinguishable from a genuine crossing and never itself counts as a flip. After each run, persist the new reading.

```ts
export function marketGateAlert(
  gate: GateDecision,
  lastReading: "above" | "below" | "unknown",
): { flipped: boolean; from: typeof lastReading; to: "above" | "below" | "unknown"; note: string }
```

Fire-on-condition, not fire-every-run, is the deliberate design point here: a daily "SPY is still above SMA200" message is noise the owner will start ignoring within a week, which defeats the point of an alert channel. STATE.md's own market-gate section already treats the crossing, not the level, as the informative event.

### 2.3 Correlation alert (pairwise — the one genuinely new computation)

For every unordered pair of holdings `(a, b)`, compute `pearsonCorrelation(dailyReturns(a.candles), dailyReturns(b.candles))` and flag pairs at or above `CORRELATION_ALERT_THRESHOLD` (0.75, per the original proposal — deliberately looser than `corrMultiplierFor`'s 0.8 sizing cutoff in `positionSizing.ts`, since this is a heads-up, not a sizing decision, and the two numbers are allowed to differ for that reason).

```ts
export function correlationAlert(
  holdings: { ticker: string; candles: Candle[] | null }[],
  threshold = CORRELATION_ALERT_THRESHOLD,
): { a: string; b: string; correlation: number }[]
```

Pure, O(n²) over holdings (n ≤ 20 → ≤190 pairs, trivial). A holding with unfetchable or too-short candles is skipped for every pair it would appear in — `pearsonCorrelation` already returns `null` for that case and `null` is filtered out, matching how `advise.ts` already treats an unfetchable holding (renders as "unknown", never as 0 or a false alarm).

## 3. The route and the message

`src/app/api/cron/risk-sentry/route.ts`, mirroring `cron/scan/route.ts`:

```ts
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const unauthorized = assertCronAuth(req);
  if (unauthorized) return unauthorized;

  try {
    const summary = await runRiskSentry();       // fetch + compose, in src/lib/riskSentry/runRiskSentry.ts
    if (summary.message) await sendDiscordNotification(summary.message, "warning");
    return Response.json({ ok: true, ...summary });
  } catch (e) {
    await sendDiscordNotification(`/api/cron/risk-sentry failed: ${String(e)}`, "critical");
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
```

`runRiskSentry()` does the I/O (`getRiskSentryHoldings`, `fetchCandlesBatch` for holdings, `fetchCandles` for the benchmark, `fetchNextEarnings` per holding, `getSetting`/`setSetting` for the gate flip) and hands the results to the three pure checks, then composes **one consolidated Discord embed** (not three separate messages) — an earnings section, a gate-flip line if any, a correlation-pairs section if any. If all three checks come back empty, `summary.message` is `null` and nothing is posted: a "nothing to report" ping every morning is exactly the alert fatigue §2.2 already argues against.

No holdings configured (`getRiskSentryHoldings()` returns `[]`) → `runRiskSentry()` returns immediately with `summary.message = null` and a `skipped: true` field, rather than erroring. An owner who has not yet used the `/settings` editor should see silence, not a nightly failure notification.

## 4. Scheduling

One new entry in `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/risk-sentry", "schedule": "0 12 * * 1-5" }
  ]
}
```

Once daily, pre-market, weekdays only: `0 12 * * 1-5` is 12:00 UTC, 7am ET (8am during EST) — early enough to land before the US open with margin either side of the DST boundary, and within Vercel Hobby's once-daily-per-path cron limit (the same limit `cron/scan`'s own comment documents). This is the first entry `vercel.json` will hold — it is currently `{"crons": []}`, i.e. nothing is scheduled at all today, so this is a net-new scheduled job, not a resumption of a suspended one. As noted in §0, this is a deliberate distinction from the old Task Scheduler jobs STATE.md says not to re-enable: those ran the paused trading pipeline; this runs three read-only checks against whatever the owner typed into `/settings`.

## 5. Testing

Matches the project's existing convention (`tsx --test "src/**/*.test.ts"`, `node:test` + `assert/strict`, e.g. `marketGate.test.ts`). Pure functions get unit tests; the route does not (no route/page tests exist anywhere in this project — verified by running the cron manually against a real deployment, same as `cron/scan` is verified today).

| file | must prove |
|---|---|
| `earningsWatchdog.test.ts` | a holding inside the window is flagged; one outside is not; a null-date `EarningsInfo` (any reason) is never flagged; the boundary day itself is included |
| `correlationAlert.test.ts` | a pair at/above threshold is flagged; below is not; a holding with null/too-short candles is skipped, not treated as 0 or as a false flag; no self-pairs; no duplicate `(a,b)`/`(b,a)` pairs |
| `marketGateAlert.test.ts` | above→below and below→above both flip; above→above and below→below do not; `"unknown"` on either side never counts as a flip; a fresh install (`lastReading` absent) does not fire on its first run |
| `holdings.test.ts` | ticker validation/dedup/cap matches `/advisor`'s own `readHoldings` behavior; round-trips through `getSetting`/`setSetting` |
| `runRiskSentry.test.ts` (with fetch/Setting stubbed) | empty holdings → `skipped: true`, no message; all-clear → `message: null`, nothing posted; a mix of the three checks composes into one message, not three |

Manual verification: `curl -H "Authorization: Bearer $CRON_SECRET" https://<deploy>/api/cron/risk-sentry`, same as the existing cron routes, plus a real Discord webhook check with at least one holding configured to confirm the embed renders as intended.

## 6. Out of scope for this spec

Listed so the implementation plan cannot quietly grow:

- **No lifecycle/exit automation, no stop-line drawing, no execution/friction tracking.** Those are Pillars 1, 3, and 4 — separate specs.
- **No new Prisma model.** See §1.3; revisit only if a later, separately-approved pillar needs richer per-holding data.
- **No per-holding configuration of thresholds.** `EARNINGS_WATCHDOG_DAYS` and `CORRELATION_ALERT_THRESHOLD` are constants, matching how `ADVISOR_COST_BPS` is a constant, not a form field, in the advisor tool.
- **No mobile push, email, or SMS.** Discord only, reusing the existing webhook.
- **No auth beyond `CRON_SECRET`.** The `/settings` holdings editor runs unauthenticated like every other page in this app today.
- **No backtest of Risk Sentry itself.** It predicts nothing and trades nothing, so there is nothing to backtest — same exclusion `/advisor`'s own spec states, for the same reason.
