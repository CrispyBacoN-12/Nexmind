# Risk Sentry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an unattended daily cron that runs three read-only risk checks (earnings proximity, market-gate flip, pairwise holdings correlation) against the owner's actual holdings and posts one consolidated Discord alert when something needs attention.

**Architecture:** Four pure/DB-trivial modules under `src/lib/riskSentry/` (holdings storage, earnings watchdog, correlation alert, market-gate-flip alert), composed by a fifth I/O-performing module (`runRiskSentry.ts`, deps-injected like `readMarketGate`) that a thin cron route calls. Holdings persist as a JSON-encoded `Setting` row — no new Prisma model. The one new UI surface is a small holdings editor added to the existing `safety-panel.tsx` (which already owns the `/api/settings` client calls), not a `/settings` page, which does not exist in this codebase.

**Tech Stack:** Next.js 16.2.7 (App Router route handlers), TypeScript ^5, Prisma 7.8.0 (existing `Setting` model, no migration), `node:test` + `assert/strict` via `tsx --test "src/**/*.test.ts"`, React 19.2.4 client component for the UI task.

**Spec:** [docs/superpowers/specs/2026-09-16-risk-sentry-design.md](../specs/2026-09-16-risk-sentry-design.md)

## Global Constraints

- No new Prisma model — holdings and the last gate reading are `Setting` rows (`riskSentry:holdings`, `riskSentry:lastGate`), reusing `getSetting`/`setSetting` from `src/lib/settings.ts`.
- No per-holding threshold configuration — `EARNINGS_WATCHDOG_DAYS` (3) and `CORRELATION_ALERT_THRESHOLD` (0.75) are constants, not form fields.
- Discord only, via the existing `sendDiscordNotification` webhook — no mobile push, email, or SMS.
- No auth beyond `Authorization: Bearer $CRON_SECRET` (`assertCronAuth`) on the cron route. The holdings editor is unauthenticated, like every other page in this app today.
- No backtest of Risk Sentry itself — it predicts nothing and trades nothing.
- No lifecycle/exit automation, stop-line drawing, or execution/friction tracking. Those are Pillars 1, 3, and 4 — separate specs, out of scope here.
- The market-gate leg alerts only on a flip (`benchAbove` changing since the last run), never every run — a daily "still above SMA200" ping is alert fatigue the spec explicitly rejects.
- Empty/no holdings configured → the cron returns `skipped: true` with `message: null` and posts nothing. Silence, not a nightly failure notification.
- All three checks compose into **one** consolidated Discord message per run, never three separate posts. `message` is `null` (nothing posted) when all three checks come back clean.
- `src/lib/riskSentry/holdings.ts`, `earningsWatchdog.ts`, `correlationAlert.ts`, and `marketGateAlert.ts` stay pure or DB-trivial — no direct `fetch()` to a market-data provider and no Discord call from inside any of them. `runRiskSentry.ts` is the one module in that directory that performs I/O (mirrors `readMarketGate`'s own injected-deps shape); `route.ts` wires it to the real implementations.

---

## File Structure

```
src/lib/riskSentry/
  holdings.ts              — Setting-backed get/set + pure ticker validation (Task 1)
  holdings.test.ts
  earningsWatchdog.ts       — pure: which holdings report earnings soon (Task 2)
  earningsWatchdog.test.ts
  correlationAlert.ts       — pure: pairwise holdings correlation (Task 3)
  correlationAlert.test.ts
  marketGateAlert.ts        — pure: did the gate reading flip since last run (Task 4)
  marketGateAlert.test.ts
  runRiskSentry.ts          — I/O composition + one Discord message (Task 5)
  runRiskSentry.test.ts

src/app/api/cron/risk-sentry/
  route.ts                  — auth + wire runRiskSentry to real deps + notify (Task 6)

vercel.json                 — + one cron entry (Task 7)

src/app/api/settings/route.ts   — + riskSentryHoldings field (Task 8)

src/app/command/safety-panel.tsx — + holdings editor section (Task 9)
```

---

### Task 1: Holdings storage

**Files:**
- Create: `src/lib/riskSentry/holdings.ts`
- Test: `src/lib/riskSentry/holdings.test.ts`

**Interfaces:**
- Consumes: `getSetting(key: string, fallback: string): Promise<string>`, `setSetting(key: string, value: string): Promise<void>` from `src/lib/settings.ts`
- Produces: `normalizeHoldingTickers(raw: unknown): string[]`, `getRiskSentryHoldings(): Promise<string[]>`, `setRiskSentryHoldings(tickers: string[]): Promise<void>`, `RISK_SENTRY_HOLDINGS_SETTING = "riskSentry:holdings"`, `RISK_SENTRY_MAX_HOLDINGS = 20` — consumed by Task 5 (`runRiskSentry.ts`), Task 6 (`route.ts`), and Task 8 (`api/settings/route.ts`)

`getRiskSentryHoldings`/`setRiskSentryHoldings` call `getSetting`/`setSetting` directly (no injected deps) — same DB-trivial shape as `settings.ts`'s own exports, which this codebase does not unit-test (no `settings.test.ts` exists; `DATABASE_URL` is not available in the test environment). The test file below covers the pure `normalizeHoldingTickers` function only, including a JSON round-trip check that proves what `setRiskSentryHoldings` would persist is exactly what `getRiskSentryHoldings` would read back.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/riskSentry/holdings.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHoldingTickers, RISK_SENTRY_MAX_HOLDINGS } from "./holdings";

test("valid tickers pass through, uppercased and trimmed", () => {
  assert.deepEqual(normalizeHoldingTickers(["aapl", "MSFT", " nvda "]), ["AAPL", "MSFT", "NVDA"]);
});

test("invalid tokens are dropped, not thrown", () => {
  assert.deepEqual(normalizeHoldingTickers(["AAPL", "", "not a ticker!", "123"]), ["AAPL"]);
});

test("duplicates collapse to the first occurrence", () => {
  assert.deepEqual(normalizeHoldingTickers(["AAPL", "aapl", "AAPL"]), ["AAPL"]);
});

test("caps at RISK_SENTRY_MAX_HOLDINGS", () => {
  const many = Array.from({ length: RISK_SENTRY_MAX_HOLDINGS + 5 }, (_, i) => `T${i}`);
  assert.equal(normalizeHoldingTickers(many).length, RISK_SENTRY_MAX_HOLDINGS);
});

test("non-array input returns an empty list", () => {
  assert.deepEqual(normalizeHoldingTickers(null), []);
  assert.deepEqual(normalizeHoldingTickers("AAPL"), []);
});

test("round-trips through JSON exactly as setRiskSentryHoldings/getRiskSentryHoldings would", () => {
  const input = ["tsla", "AAPL", "tsla", "  msft "];
  const stored = JSON.stringify(normalizeHoldingTickers(input));
  const readBack = normalizeHoldingTickers(JSON.parse(stored));
  assert.deepEqual(readBack, ["TSLA", "AAPL", "MSFT"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/riskSentry/holdings.test.ts`
Expected: FAIL with "Cannot find module './holdings'" (the file does not exist yet)

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/riskSentry/holdings.ts
// Holdings persistence for Risk Sentry. No dedicated Prisma model exists for
// "what the owner actually holds" — an unattended cron cannot ask, so this
// reuses the generic Setting key-value table rather than adding one. See
// docs/superpowers/specs/2026-09-16-risk-sentry-design.md §1.3.

import { getSetting, setSetting } from "@/lib/settings";

export const RISK_SENTRY_HOLDINGS_SETTING = "riskSentry:holdings";
export const RISK_SENTRY_MAX_HOLDINGS = 20;

/** No /g flag, so .test() is stateless — the same regex src/app/api/advisor/route.ts's
 *  readHoldings uses, so the two lists can never silently diverge on what counts
 *  as a valid ticker. */
const TICKER_RE = /^[A-Z][A-Z.\-]{0,9}$/;

/** Pure: validate/dedupe/uppercase/cap a raw ticker list. */
export function normalizeHoldingTickers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const tickers: string[] = [];
  const seen = new Set<string>();
  for (const h of raw) {
    const t = String(h ?? "").trim().toUpperCase();
    if (t === "" || !TICKER_RE.test(t)) continue;
    if (seen.has(t)) continue;
    if (tickers.length >= RISK_SENTRY_MAX_HOLDINGS) break;
    seen.add(t);
    tickers.push(t);
  }
  return tickers;
}

export async function getRiskSentryHoldings(): Promise<string[]> {
  const raw = await getSetting(RISK_SENTRY_HOLDINGS_SETTING, "[]");
  try {
    return normalizeHoldingTickers(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export async function setRiskSentryHoldings(tickers: string[]): Promise<void> {
  await setSetting(RISK_SENTRY_HOLDINGS_SETTING, JSON.stringify(normalizeHoldingTickers(tickers)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/riskSentry/holdings.test.ts`
Expected: PASS, 6/6 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/riskSentry/holdings.ts src/lib/riskSentry/holdings.test.ts
git commit -m "feat(risk-sentry): add holdings storage on the Setting table"
```

---

### Task 2: Earnings watchdog

**Files:**
- Create: `src/lib/riskSentry/earningsWatchdog.ts`
- Test: `src/lib/riskSentry/earningsWatchdog.test.ts`

**Interfaces:**
- Consumes: `EarningsInfo` type (`{ date: string | null; hour: string | null; note?: string }`) from `src/lib/advisor/types.ts`
- Produces: `EARNINGS_WATCHDOG_DAYS = 3`, `EarningsWatchdogHit { ticker: string; date: string; hour: string | null; daysAway: number }`, `earningsWatchdog(results: { ticker: string; earnings: EarningsInfo }[], today: Date, windowDays?: number): EarningsWatchdogHit[]` — consumed by Task 5 (`runRiskSentry.ts`)

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/riskSentry/earningsWatchdog.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { earningsWatchdog, EARNINGS_WATCHDOG_DAYS } from "./earningsWatchdog";

const TODAY = new Date("2026-09-16T12:00:00Z");
const MS_PER_DAY = 86_400_000;

test("a holding inside the window is flagged", () => {
  const hits = earningsWatchdog(
    [{ ticker: "AAPL", earnings: { date: "2026-09-18", hour: "amc" } }],
    TODAY,
  );
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0], { ticker: "AAPL", date: "2026-09-18", hour: "amc", daysAway: 2 });
});

test("a holding outside the window is not flagged", () => {
  const hits = earningsWatchdog(
    [{ ticker: "MSFT", earnings: { date: "2026-09-25", hour: null } }],
    TODAY,
  );
  assert.equal(hits.length, 0);
});

test("a null-date EarningsInfo is never flagged, whatever the reason", () => {
  const hits = earningsWatchdog(
    [
      { ticker: "NVDA", earnings: { date: null, hour: null, note: "no report scheduled in the next 120 days" } },
      { ticker: "TSLA", earnings: { date: null, hour: null, note: "FINNHUB_API_KEY not set" } },
    ],
    TODAY,
  );
  assert.equal(hits.length, 0);
});

test("the boundary day itself is included", () => {
  const boundaryDate = new Date(TODAY.getTime() + EARNINGS_WATCHDOG_DAYS * MS_PER_DAY).toISOString().slice(0, 10);
  const hits = earningsWatchdog([{ ticker: "KO", earnings: { date: boundaryDate, hour: "bmo" } }], TODAY);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].daysAway, EARNINGS_WATCHDOG_DAYS);
});

test("a report today (daysAway 0) is included, not treated as already past", () => {
  const hits = earningsWatchdog([{ ticker: "KO", earnings: { date: "2026-09-16", hour: "bmo" } }], TODAY);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].daysAway, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/riskSentry/earningsWatchdog.test.ts`
Expected: FAIL with "Cannot find module './earningsWatchdog'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/riskSentry/earningsWatchdog.ts
// Pure: which held tickers report earnings within the watch window. The clock
// and the per-ticker EarningsInfo are both supplied by the caller (route.ts /
// runRiskSentry.ts), same boundary as the rest of src/lib/riskSentry/.

import type { EarningsInfo } from "@/lib/advisor/types";

/** Proposed in the design spec §2.1: 3 calendar days. */
export const EARNINGS_WATCHDOG_DAYS = 3;

export interface EarningsWatchdogHit {
  ticker: string;
  date: string;
  hour: string | null;
  daysAway: number;
}

const MS_PER_DAY = 86_400_000;
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

export function earningsWatchdog(
  results: { ticker: string; earnings: EarningsInfo }[],
  today: Date,
  windowDays: number = EARNINGS_WATCHDOG_DAYS,
): EarningsWatchdogHit[] {
  const todayMs = Date.parse(isoDay(today));
  const hits: EarningsWatchdogHit[] = [];
  for (const { ticker, earnings } of results) {
    if (!earnings.date) continue;
    const daysAway = Math.round((Date.parse(earnings.date) - todayMs) / MS_PER_DAY);
    if (daysAway < 0 || daysAway > windowDays) continue;
    hits.push({ ticker, date: earnings.date, hour: earnings.hour, daysAway });
  }
  return hits;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/riskSentry/earningsWatchdog.test.ts`
Expected: PASS, 5/5 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/riskSentry/earningsWatchdog.ts src/lib/riskSentry/earningsWatchdog.test.ts
git commit -m "feat(risk-sentry): add the earnings watchdog check"
```

---

### Task 3: Correlation alert

**Files:**
- Create: `src/lib/riskSentry/correlationAlert.ts`
- Test: `src/lib/riskSentry/correlationAlert.test.ts`

**Interfaces:**
- Consumes: `Candle` type from `src/lib/indicators.ts` (`{ t: number; o: number; h: number; l: number; c: number; v: number }`), `dailyReturns(candles: Candle[]): number[]` and `pearsonCorrelation(xs: number[], ys: number[]): number | null` from `src/lib/trading/correlation.ts`
- Produces: `CORRELATION_ALERT_THRESHOLD = 0.75`, `CorrelationAlertPair { a: string; b: string; correlation: number }`, `correlationAlert(holdings: { ticker: string; candles: Candle[] | null }[], threshold?: number): CorrelationAlertPair[]` — consumed by Task 5 (`runRiskSentry.ts`)

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/riskSentry/correlationAlert.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { correlationAlert } from "./correlationAlert";

const T0 = Date.parse("2020-01-01T00:00:00Z") / 1000;
const DAY = 86_400;

/** Builds a candle series whose dailyReturns() is exactly `returns`, so the
 *  resulting Pearson correlation is fully controllable in a test. */
function candlesFromReturns(returns: number[]): Candle[] {
  let price = 100;
  const closes = [price];
  for (const r of returns) {
    price *= 1 + r;
    closes.push(price);
  }
  return closes.map((c, i) => ({ t: T0 + i * DAY, o: c, h: c + 1, l: c - 1, c, v: 1000 }));
}

const RETURNS_A = [0.01, -0.02, 0.015, 0.03, -0.01, 0.02, -0.015, 0.025, 0.01, -0.005];

test("a pair at/above threshold is flagged", () => {
  const holdings = [
    { ticker: "AAA", candles: candlesFromReturns(RETURNS_A) },
    { ticker: "BBB", candles: candlesFromReturns(RETURNS_A) }, // identical returns -> correlation 1
  ];
  const pairs = correlationAlert(holdings);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a, "AAA");
  assert.equal(pairs[0].b, "BBB");
  assert.ok(pairs[0].correlation > 0.999);
});

test("a pair below threshold is not flagged", () => {
  const holdings = [
    { ticker: "AAA", candles: candlesFromReturns(RETURNS_A) },
    { ticker: "CCC", candles: candlesFromReturns(RETURNS_A.map((r) => -r)) }, // exact inverse -> correlation -1
  ];
  assert.equal(correlationAlert(holdings).length, 0);
});

test("a holding with null or too-short candles is skipped, not a false flag", () => {
  const holdings = [
    { ticker: "AAA", candles: candlesFromReturns(RETURNS_A) },
    { ticker: "NULLCO", candles: null },
    { ticker: "SHORT", candles: candlesFromReturns([0.01, 0.02]) }, // 2 returns, below pearsonCorrelation's n>=5 floor
  ];
  assert.equal(correlationAlert(holdings).length, 0, "skipped holdings produce no pairs, not spurious ones");
});

test("no self-pairs and no duplicate (a,b)/(b,a) pairs", () => {
  const same = candlesFromReturns(RETURNS_A);
  const holdings = [
    { ticker: "A", candles: same },
    { ticker: "B", candles: same },
    { ticker: "C", candles: same },
  ];
  const pairs = correlationAlert(holdings);
  assert.equal(pairs.length, 3, "3 holdings -> exactly 3 unordered pairs");
  const keys = pairs.map((p) => `${p.a}-${p.b}`).sort();
  assert.deepEqual(keys, ["A-B", "A-C", "B-C"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/riskSentry/correlationAlert.test.ts`
Expected: FAIL with "Cannot find module './correlationAlert'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/riskSentry/correlationAlert.ts
// Pure: the pairwise holdings-vs-holdings correlation matrix. Deliberately not
// advise()'s correlation leg, which is ticker-vs-holding, not holding-vs-holding
// — see docs/superpowers/specs/2026-09-16-risk-sentry-design.md §1.2.

import type { Candle } from "@/lib/indicators";
import { dailyReturns, pearsonCorrelation } from "@/lib/trading/correlation";

/** Deliberately looser than positionSizing.ts's corrMultiplierFor 0.8 sizing
 *  cutoff — this is a heads-up, not a sizing decision. */
export const CORRELATION_ALERT_THRESHOLD = 0.75;

export interface CorrelationAlertPair {
  a: string;
  b: string;
  correlation: number;
}

export function correlationAlert(
  holdings: { ticker: string; candles: Candle[] | null }[],
  threshold: number = CORRELATION_ALERT_THRESHOLD,
): CorrelationAlertPair[] {
  const returns = holdings.map((h) => (h.candles ? dailyReturns(h.candles) : null));
  const pairs: CorrelationAlertPair[] = [];
  for (let i = 0; i < holdings.length; i++) {
    const ri = returns[i];
    if (!ri) continue;
    for (let j = i + 1; j < holdings.length; j++) {
      const rj = returns[j];
      if (!rj) continue;
      const corr = pearsonCorrelation(ri, rj);
      if (corr != null && corr >= threshold) {
        pairs.push({ a: holdings[i].ticker, b: holdings[j].ticker, correlation: corr });
      }
    }
  }
  return pairs;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/riskSentry/correlationAlert.test.ts`
Expected: PASS, 4/4 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/riskSentry/correlationAlert.ts src/lib/riskSentry/correlationAlert.test.ts
git commit -m "feat(risk-sentry): add the pairwise correlation alert"
```

---

### Task 4: Market gate alert

**Files:**
- Create: `src/lib/riskSentry/marketGateAlert.ts`
- Test: `src/lib/riskSentry/marketGateAlert.test.ts`

**Interfaces:**
- Consumes: `GateDecision { slots: number; benchAbove: boolean | null; shortsAllowed: boolean; note: string }` from `src/lib/market/marketGate.ts`
- Produces: `GateReading = "above" | "below" | "unknown"`, `MarketGateAlertResult { flipped: boolean; from: GateReading; to: GateReading; note: string }`, `marketGateAlert(gate: GateDecision, lastReading: GateReading): MarketGateAlertResult` — consumed by Task 5 (`runRiskSentry.ts`)

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/riskSentry/marketGateAlert.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GateDecision } from "@/lib/market/marketGate";
import { marketGateAlert } from "./marketGateAlert";

function gate(benchAbove: boolean | null): GateDecision {
  return { slots: 0, benchAbove, shortsAllowed: true, note: "test gate" };
}

test("above to below is a flip", () => {
  const r = marketGateAlert(gate(false), "above");
  assert.equal(r.flipped, true);
  assert.equal(r.from, "above");
  assert.equal(r.to, "below");
});

test("below to above is a flip", () => {
  const r = marketGateAlert(gate(true), "below");
  assert.equal(r.flipped, true);
  assert.equal(r.from, "below");
  assert.equal(r.to, "above");
});

test("above to above is not a flip", () => {
  assert.equal(marketGateAlert(gate(true), "above").flipped, false);
});

test("below to below is not a flip", () => {
  assert.equal(marketGateAlert(gate(false), "below").flipped, false);
});

test("unknown on either side never counts as a flip", () => {
  assert.equal(marketGateAlert(gate(null), "above").flipped, false, "reading BLIND is not a flip away from above");
  assert.equal(marketGateAlert(gate(true), "unknown").flipped, false, "a first-ever reading is not a flip from unknown");
  assert.equal(marketGateAlert(gate(null), "unknown").flipped, false);
});

test("a fresh install does not fire on its first run", () => {
  const r = marketGateAlert(gate(true), "unknown");
  assert.equal(r.flipped, false);
  assert.equal(r.to, "above");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/riskSentry/marketGateAlert.test.ts`
Expected: FAIL with "Cannot find module './marketGateAlert'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/riskSentry/marketGateAlert.ts
// Pure: does the market-gate reading differ from the last recorded one? Fires
// on a flip only, never every run — see design spec §2.2 on why a daily
// "still above SMA200" ping is alert fatigue, not a useful signal.

import type { GateDecision } from "@/lib/market/marketGate";

export type GateReading = "above" | "below" | "unknown";

export interface MarketGateAlertResult {
  flipped: boolean;
  from: GateReading;
  to: GateReading;
  note: string;
}

function toReading(benchAbove: boolean | null): GateReading {
  return benchAbove == null ? "unknown" : benchAbove ? "above" : "below";
}

export function marketGateAlert(gate: GateDecision, lastReading: GateReading): MarketGateAlertResult {
  const to = toReading(gate.benchAbove);
  const flipped = lastReading !== "unknown" && to !== "unknown" && lastReading !== to;
  const note = flipped
    ? `market gate flipped ${lastReading} -> ${to}`
    : `market gate reading ${to} (was ${lastReading}) — no flip`;
  return { flipped, from: lastReading, to, note };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/riskSentry/marketGateAlert.test.ts`
Expected: PASS, 6/6 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/riskSentry/marketGateAlert.ts src/lib/riskSentry/marketGateAlert.test.ts
git commit -m "feat(risk-sentry): add the market-gate flip alert"
```

---

### Task 5: Run Risk Sentry (composition + I/O)

**Files:**
- Create: `src/lib/riskSentry/runRiskSentry.ts`
- Test: `src/lib/riskSentry/runRiskSentry.test.ts`

**Interfaces:**
- Consumes: `earningsWatchdog` (Task 2), `correlationAlert` (Task 3), `marketGateAlert`/`GateReading` (Task 4), `gateSlots(benchmark: Candle[], freeSlots: number): GateDecision` from `src/lib/market/marketGate.ts`, `BENCHMARK = "SPY"` from `src/lib/market/regime.ts`, `Candle` from `src/lib/indicators.ts`, `EarningsInfo` from `src/lib/advisor/types.ts`
- Produces: `RISK_SENTRY_LAST_GATE_SETTING = "riskSentry:lastGate"`, `RunRiskSentryDeps` interface, `RunRiskSentrySummary { skipped: boolean; message: string | null; earnings: EarningsWatchdogHit[]; gate: MarketGateAlertResult; correlations: CorrelationAlertPair[] }`, `runRiskSentry(deps: RunRiskSentryDeps, today?: Date): Promise<RunRiskSentrySummary>` — consumed by Task 6 (`route.ts`)

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/riskSentry/runRiskSentry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import type { EarningsInfo } from "@/lib/advisor/types";
import { runRiskSentry, RISK_SENTRY_LAST_GATE_SETTING, type RunRiskSentryDeps } from "./runRiskSentry";

const TODAY = new Date("2026-09-16T12:00:00Z");
const DAY_SEC = 86_400;
const DAY_MS = 86_400_000;
const T0 = Date.parse("2020-01-01T00:00:00Z") / 1000;

function bars(n: number, closeAt: (i: number) => number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = closeAt(i);
    return { t: T0 + i * DAY_SEC, o: c, h: c + 1, l: c - 1, c, v: 1000 };
  });
}
const uptrend = (n = 300) => bars(n, (i) => 100 + i);
const downtrend = (n = 300) => bars(n, (i) => 1000 - i);

function candlesFromReturns(returns: number[]): Candle[] {
  let price = 100;
  const closes = [price];
  for (const r of returns) {
    price *= 1 + r;
    closes.push(price);
  }
  return closes.map((c, i) => ({ t: T0 + i * DAY_SEC, o: c, h: c + 1, l: c - 1, c, v: 1000 }));
}

const NO_EARNINGS: EarningsInfo = { date: null, hour: null, note: "no report scheduled in the next 120 days" };

function baseDeps(overrides: Partial<RunRiskSentryDeps> = {}): RunRiskSentryDeps {
  return {
    getRiskSentryHoldings: async () => [],
    setRiskSentryHoldings: async () => {},
    fetchCandlesBatch: async () => new Map(),
    fetchCandles: async () => ({ candles: uptrend() }),
    fetchNextEarnings: async () => NO_EARNINGS,
    getSetting: async (_k: string, fallback: string) => fallback,
    setSetting: async () => {},
    ...overrides,
  };
}

test("no holdings configured returns skipped with no message", async () => {
  const summary = await runRiskSentry(baseDeps(), TODAY);
  assert.equal(summary.skipped, true);
  assert.equal(summary.message, null);
});

test("all-clear holdings produce a null message", async () => {
  const candles = uptrend();
  const deps = baseDeps({
    getRiskSentryHoldings: async () => ["AAPL"],
    fetchCandlesBatch: async () => new Map([["AAPL", { candles }]]),
  });
  const summary = await runRiskSentry(deps, TODAY);
  assert.equal(summary.skipped, false);
  assert.equal(summary.message, null);
});

test("a mix of the three checks composes into one message, not three", async () => {
  const RETURNS = [0.01, -0.02, 0.015, 0.03, -0.01, 0.02, -0.015, 0.025, 0.01, -0.005];
  const sameCandles = candlesFromReturns(RETURNS);
  const soonDate = new Date(TODAY.getTime() + DAY_MS).toISOString().slice(0, 10);

  const deps = baseDeps({
    getRiskSentryHoldings: async () => ["AAA", "BBB"],
    fetchCandlesBatch: async () => new Map([["AAA", { candles: sameCandles }], ["BBB", { candles: sameCandles }]]),
    fetchCandles: async () => ({ candles: downtrend() }), // benchAbove -> false
    fetchNextEarnings: async (ticker: string) => (ticker === "AAA" ? { date: soonDate, hour: "amc" } : NO_EARNINGS),
    getSetting: async () => "above", // last reading was above -> flips to below
  });

  const summary = await runRiskSentry(deps, TODAY);
  assert.match(summary.message ?? "", /Earnings this week/);
  assert.match(summary.message ?? "", /Market gate flipped/);
  assert.match(summary.message ?? "", /Correlated holdings/);
});

test("persists the new gate reading via setSetting", async () => {
  let persisted: [string, string] | null = null;
  const deps = baseDeps({
    getRiskSentryHoldings: async () => ["AAPL"],
    fetchCandlesBatch: async () => new Map([["AAPL", { candles: uptrend() }]]),
    setSetting: async (key: string, value: string) => {
      persisted = [key, value];
    },
  });
  await runRiskSentry(deps, TODAY);
  assert.deepEqual(persisted, [RISK_SENTRY_LAST_GATE_SETTING, "above"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/riskSentry/runRiskSentry.test.ts`
Expected: FAIL with "Cannot find module './runRiskSentry'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/riskSentry/runRiskSentry.ts
// The only module in src/lib/riskSentry/ that touches the network, Prisma, and
// the clock — mirrors readMarketGate's own injected-deps shape (src/lib/market/marketGate.ts)
// so it is testable without DATABASE_URL or a live provider.
// src/app/api/cron/risk-sentry/route.ts calls this with the real implementations.

import type { Candle } from "@/lib/indicators";
import type { EarningsInfo } from "@/lib/advisor/types";
import { gateSlots } from "@/lib/market/marketGate";
import { BENCHMARK } from "@/lib/market/regime";
import { earningsWatchdog, type EarningsWatchdogHit } from "./earningsWatchdog";
import { correlationAlert, type CorrelationAlertPair } from "./correlationAlert";
import { marketGateAlert, type MarketGateAlertResult, type GateReading } from "./marketGateAlert";

export const RISK_SENTRY_LAST_GATE_SETTING = "riskSentry:lastGate";

export interface RunRiskSentryDeps {
  getRiskSentryHoldings: () => Promise<string[]>;
  setRiskSentryHoldings: (tickers: string[]) => Promise<void>;
  fetchCandlesBatch: (symbols: string[], range: "2y", interval: "1d") => Promise<Map<string, { candles: Candle[] }>>;
  fetchCandles: (symbol: string, range: "2y", interval: "1d", minDays: number) => Promise<{ candles: Candle[] }>;
  fetchNextEarnings: (ticker: string) => Promise<EarningsInfo>;
  getSetting: (key: string, fallback: string) => Promise<string>;
  setSetting: (key: string, value: string) => Promise<void>;
}

export interface RunRiskSentrySummary {
  skipped: boolean;
  message: string | null;
  earnings: EarningsWatchdogHit[];
  gate: MarketGateAlertResult;
  correlations: CorrelationAlertPair[];
}

const GATE_READINGS: readonly GateReading[] = ["above", "below", "unknown"];

function composeMessage(
  earnings: EarningsWatchdogHit[],
  gate: MarketGateAlertResult,
  correlations: CorrelationAlertPair[],
): string | null {
  const sections: string[] = [];
  if (earnings.length > 0) {
    sections.push(
      "**Earnings this week**\n" +
        earnings.map((e) => `${e.ticker}: ${e.date}${e.hour ? ` (${e.hour})` : ""} — ${e.daysAway}d away`).join("\n"),
    );
  }
  if (gate.flipped) {
    sections.push(`**Market gate flipped**\n${gate.note}`);
  }
  if (correlations.length > 0) {
    sections.push(
      "**Correlated holdings**\n" +
        correlations.map((c) => `${c.a} / ${c.b}: ${c.correlation.toFixed(2)}`).join("\n"),
    );
  }
  return sections.length > 0 ? sections.join("\n\n") : null;
}

export async function runRiskSentry(
  deps: RunRiskSentryDeps,
  today: Date = new Date(),
): Promise<RunRiskSentrySummary> {
  const holdings = await deps.getRiskSentryHoldings();
  if (holdings.length === 0) {
    return {
      skipped: true,
      message: null,
      earnings: [],
      gate: { flipped: false, from: "unknown", to: "unknown", note: "no holdings configured" },
      correlations: [],
    };
  }

  const [candleMap, benchmarkResp, earningsResults, lastReadingRaw] = await Promise.all([
    deps.fetchCandlesBatch(holdings, "2y", "1d"),
    deps.fetchCandles(BENCHMARK, "2y", "1d", 300),
    Promise.all(holdings.map(async (ticker) => ({ ticker, earnings: await deps.fetchNextEarnings(ticker) }))),
    deps.getSetting(RISK_SENTRY_LAST_GATE_SETTING, "unknown"),
  ]);

  const lastReading: GateReading = GATE_READINGS.includes(lastReadingRaw as GateReading)
    ? (lastReadingRaw as GateReading)
    : "unknown";

  const holdingCandles = holdings.map((ticker) => ({ ticker, candles: candleMap.get(ticker)?.candles ?? null }));

  const earningsHits = earningsWatchdog(earningsResults, today);
  const gateDecision = gateSlots(benchmarkResp.candles, 0);
  const gateResult = marketGateAlert(gateDecision, lastReading);
  const correlationHits = correlationAlert(holdingCandles);

  await deps.setSetting(RISK_SENTRY_LAST_GATE_SETTING, gateResult.to);

  return {
    skipped: false,
    message: composeMessage(earningsHits, gateResult, correlationHits),
    earnings: earningsHits,
    gate: gateResult,
    correlations: correlationHits,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/riskSentry/runRiskSentry.test.ts`
Expected: PASS, 4/4 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/riskSentry/runRiskSentry.ts src/lib/riskSentry/runRiskSentry.test.ts
git commit -m "feat(risk-sentry): compose the three checks into one run"
```

---

### Task 6: Cron route

**Files:**
- Create: `src/app/api/cron/risk-sentry/route.ts`

**Interfaces:**
- Consumes: `runRiskSentry`, `RunRiskSentryDeps` (Task 5); `getRiskSentryHoldings`, `setRiskSentryHoldings` (Task 1); `fetchCandles(symbol: string, range?: Range, interval?: Interval, minDays?: number): Promise<CandleResponse>`, `fetchCandlesBatch(symbols: string[], range?: Range, interval?: Interval): Promise<Map<string, CandleResponse>>` from `src/lib/marketData.ts`; `fetchNextEarnings(symbol: string, today?: Date): Promise<EarningsInfo>` from `src/lib/market/earnings.ts`; `getSetting`, `setSetting` from `src/lib/settings.ts`; `assertCronAuth(req: Request): Response | null` from `src/lib/cronAuth.ts`; `sendDiscordNotification(message: string, level?: NotifyLevel): Promise<void>` from `src/lib/notify/discord.ts`
- Produces: `GET(req: Request): Promise<Response>` — the HTTP boundary; no downstream task consumes this

This is a route file — per this project's own testing convention (`docs/superpowers/specs/2026-09-16-risk-sentry-design.md` §5: "no route/page tests exist anywhere in this project — verified by running the cron manually against a real deployment, same as `cron/scan` is verified today"), it is not unit-tested. `npm run typecheck` is the compile-time check; manual `curl` verification happens at deploy time (see Step 3's note).

- [ ] **Step 1: Write the route**

```ts
// src/app/api/cron/risk-sentry/route.ts
// Cron-triggered Risk Sentry: an unattended daily risk-monitoring check against
// whatever the owner actually holds. Read-only — no entry, exit, size, or fill
// path; see docs/superpowers/specs/2026-09-16-risk-sentry-design.md §0 for why
// this is not a resumption of the paused autonomous desk.
// Auth: requires `Authorization: Bearer $CRON_SECRET`, same as every other
// /api/cron/* route (mirrors src/app/api/cron/scan/route.ts's shape).

import { runRiskSentry } from "@/lib/riskSentry/runRiskSentry";
import { getRiskSentryHoldings, setRiskSentryHoldings } from "@/lib/riskSentry/holdings";
import { fetchCandles, fetchCandlesBatch } from "@/lib/marketData";
import { fetchNextEarnings } from "@/lib/market/earnings";
import { getSetting, setSetting } from "@/lib/settings";
import { assertCronAuth } from "@/lib/cronAuth";
import { sendDiscordNotification } from "@/lib/notify/discord";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const unauthorized = assertCronAuth(req);
  if (unauthorized) return unauthorized;

  try {
    const summary = await runRiskSentry({
      getRiskSentryHoldings,
      setRiskSentryHoldings,
      fetchCandlesBatch,
      fetchCandles,
      fetchNextEarnings,
      getSetting,
      setSetting,
    });
    if (summary.message) await sendDiscordNotification(summary.message, "warning");
    return Response.json({ ok: true, ...summary });
  } catch (e) {
    await sendDiscordNotification(`/api/cron/risk-sentry failed: ${String(e)}`, "critical");
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors introduced by this file. (The wider fetchCandles/fetchCandlesBatch parameter types in `src/lib/marketData.ts` — `Range`/`Interval` unions with defaults — are supertypes of the narrower `"2y"`/`"1d"` literals `RunRiskSentryDeps` declares, so passing the real functions directly type-checks.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/risk-sentry/route.ts
git commit -m "feat(risk-sentry): add the cron route"
```

Manual verification (once deployed, `CRON_SECRET` set): `curl -H "Authorization: Bearer $CRON_SECRET" https://<deploy>/api/cron/risk-sentry` — confirm a 200 with `{ok: true, skipped: true}` before any holdings are configured (Task 8/9), then again with at least one holding configured and a real Discord webhook to confirm the embed renders.

---

### Task 7: Vercel cron schedule

**Files:**
- Modify: `vercel.json`

**Interfaces:**
- Consumes: the route path from Task 6 (`/api/cron/risk-sentry`)
- Produces: nothing consumed by later tasks — this is the scheduling entry point

`vercel.json` is currently `{"crons": []}` — nothing is scheduled today, so this is a net-new entry, not a resumption of a suspended one (design spec §4).

- [ ] **Step 1: Edit the file**

```json
{
  "crons": [
    { "path": "/api/cron/risk-sentry", "schedule": "0 12 * * 1-5" }
  ]
}
```

`0 12 * * 1-5` = 12:00 UTC, weekdays only — 7am ET (8am during EST), pre-market with margin either side of the DST boundary, within Vercel Hobby's once-daily-per-path cron limit.

- [ ] **Step 2: Verify it's valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('ok')"`
Expected: prints `ok`

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat(risk-sentry): schedule the daily cron"
```

---

### Task 8: `/api/settings` route extension

**Files:**
- Modify: `src/app/api/settings/route.ts` (currently 24 lines — full file shown below, replacing it entirely)

**Interfaces:**
- Consumes: `getRiskSentryHoldings`, `setRiskSentryHoldings` (Task 1)
- Produces: `GET /api/settings` response gains a `riskSentryHoldings: string[]` field; `POST /api/settings` accepts an optional `riskSentryHoldings: string[]` body field — consumed by Task 9 (`safety-panel.tsx`)

Per this project's convention (no route/page tests — see Task 6), this task is verified by typecheck plus a manual check.

- [ ] **Step 1: Edit the file**

```ts
// src/app/api/settings/route.ts
import { NextResponse } from "next/server";
import { getSetting, setSetting, getFearGreed } from "@/lib/settings";
import { getRiskSentryHoldings, setRiskSentryHoldings } from "@/lib/riskSentry/holdings";

export const dynamic = "force-dynamic";

async function snapshot() {
  return NextResponse.json({
    globalTradingHalt: (await getSetting("globalTradingHalt", "false")) === "true",
    fearGreed: await getFearGreed(),
    riskSentryHoldings: await getRiskSentryHoldings(),
  });
}

export async function GET() {
  return snapshot();
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    globalTradingHalt?: boolean;
    riskSentryHoldings?: unknown;
  };
  if (typeof body.globalTradingHalt === "boolean") {
    await setSetting("globalTradingHalt", String(body.globalTradingHalt));
  }
  if (Array.isArray(body.riskSentryHoldings)) {
    await setRiskSentryHoldings(body.riskSentryHoldings);
  }
  return snapshot();
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/settings/route.ts
git commit -m "feat(risk-sentry): expose holdings on /api/settings"
```

---

### Task 9: Holdings editor UI

**Files:**
- Modify: `src/app/command/safety-panel.tsx`

**Interfaces:**
- Consumes: `GET /api/settings` (now returns `riskSentryHoldings: string[]`, Task 8), `POST /api/settings` (now accepts `riskSentryHoldings: string[]`, Task 8)
- Produces: nothing consumed by later tasks — this is the UI leaf

This is the "one new UI surface" from the design spec §1.4. The spec's own text says "a small section on the existing `/settings` page" — no such page exists in this codebase (`src/app/settings/**` has no files). The real, existing consumer of `/api/settings` is `SafetyPanel` (`src/app/command/safety-panel.tsx`), rendered inside `src/app/command/page.tsx`'s right-hand column alongside `WatchlistPanel` and `MarketScanPanel`. This task adds the holdings editor there instead, since `SafetyPanel` already owns every `/api/settings` client call in the app.

Client components are not unit-tested in this project (same convention as routes). Verification is `npm run typecheck` plus a manual check in the browser (load `/command`, confirm the new section renders and round-trips a save).

- [ ] **Step 1: Edit the file**

Three changes to `src/app/command/safety-panel.tsx`:

1. Extend the `Global` interface (line 45):

```ts
interface Global { globalTradingHalt: boolean; fearGreed: { value: number; label: string } | null; riskSentryHoldings: string[] }
```

2. Add local state and sync it on every load, add a save handler (inside `SafetyPanel`, after the existing `load`/`patch`/`toggleGlobalHalt` definitions):

```tsx
export function SafetyPanel({ portfolioId, onChanged }: { portfolioId: number; onChanged?: () => void }) {
  const [p, setP] = useState<Portfolio | null>(null);
  const [g, setG] = useState<Global | null>(null);
  const [busy, setBusy] = useState(false);
  const [holdingsText, setHoldingsText] = useState("");

  const load = useCallback(async () => {
    const [list, glob] = await Promise.all([
      fetch("/api/portfolios?includeArchived=1").then((r) => r.json()) as Promise<Portfolio[]>,
      fetch("/api/settings").then((r) => r.json()) as Promise<Global>,
    ]);
    setP(list.find((x) => x.id === portfolioId) ?? null);
    setG(glob);
    setHoldingsText(glob.riskSentryHoldings.join(", "));
  }, [portfolioId]);
  useEffect(() => { void load(); }, [load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/portfolios/${portfolioId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      await load();
      onChanged?.();
    } finally { setBusy(false); }
  }

  async function toggleGlobalHalt(next: boolean) {
    setBusy(true);
    try {
      await fetch("/api/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ globalTradingHalt: next }),
      });
      await load();
      onChanged?.();
    } finally { setBusy(false); }
  }

  async function saveHoldings() {
    setBusy(true);
    try {
      const tickers = holdingsText.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
      await fetch("/api/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ riskSentryHoldings: tickers }),
      });
      await load();
      onChanged?.();
    } finally { setBusy(false); }
  }

  if (!p || !g) return null;
```

3. Add the editor section to the JSX, after the drawdown row (`Current drawdown`, around line 194-197) and before the `Status:` footer row:

```tsx
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-xs text-(--color-muted)">Current drawdown</span>
        <span className="text-xs font-mono">{dd === "0.0" ? "0.0%" : `-${dd}%`}</span>
      </div>

      <div className="mt-3">
        <div className="text-xs text-(--color-muted) mb-1">Risk Sentry holdings (comma or newline separated)</div>
        <textarea
          value={holdingsText}
          onChange={(e) => setHoldingsText(e.target.value)}
          rows={2}
          placeholder="AAPL, MSFT, NVDA"
          className="w-full rounded-md border border-(--color-border) bg-(--color-background) px-3 py-2 text-sm font-mono focus:outline-none focus:border-(--color-accent)/50"
        />
        <Button size="sm" variant="outline" disabled={busy} className="mt-2" onClick={saveHoldings}>
          Save holdings
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2 mt-3">
        <span className="text-xs text-(--color-muted)">Status: {p.status}</span>
```

(The `Status:` row's `<Button>` for archive/unarchive is unchanged — only the new `<div className="mt-3">` block is inserted between the drawdown row and it.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Manual verification**

Start the dev server (`npm run dev:web`), open `/command`, select a portfolio, confirm the "Risk Sentry holdings" textarea renders under Safety, type `AAPL, MSFT`, click "Save holdings", reload, confirm it now reads `AAPL, MSFT` (normalized/deduped by the round trip through `/api/settings`).

- [ ] **Step 4: Commit**

```bash
git add src/app/command/safety-panel.tsx
git commit -m "feat(risk-sentry): add the holdings editor to the safety panel"
```

---

## Self-Review

**1. Spec coverage.**

| Spec section | Task |
|---|---|
| §1.3 holdings storage on `Setting`, no new Prisma model | Task 1 |
| §2.1 earnings watchdog | Task 2 |
| §2.3 correlation alert | Task 3 |
| §2.2 market gate monitor (flip-only) | Task 4 |
| §3 `runRiskSentry()` I/O composition + one consolidated message + `skipped` on no holdings | Task 5 |
| §3 the route (`assertCronAuth` → try/catch → `sendDiscordNotification`) | Task 6 |
| §4 scheduling | Task 7 |
| §1.4 the one new UI surface (corrected to the real `safety-panel.tsx` location — see Task 9's note) | Task 8 (route) + Task 9 (UI) |
| §5 testing table (all five `*.test.ts` files, one row each) | Tasks 1-5 |
| §6 out of scope (no new Prisma model, no per-holding thresholds, Discord-only, `CRON_SECRET`-only auth, no backtest) | Reflected in Global Constraints; nothing in Tasks 1-9 crosses any of these |

Every spec section maps to a task. No gaps found.

**2. Placeholder scan.** Searched every task for "TBD", "TODO", "add appropriate", "handle edge cases", "similar to Task N", and undefined type/function references. None found — every step has real, complete code, and every type referenced (`Candle`, `EarningsInfo`, `GateDecision`, `GateReading`, `EarningsWatchdogHit`, `CorrelationAlertPair`, `MarketGateAlertResult`, `RunRiskSentryDeps`, `RunRiskSentrySummary`) is defined in an earlier task before a later task imports it.

**3. Type consistency across tasks.**
- `EarningsWatchdogHit` (Task 2) → used verbatim in `RunRiskSentrySummary.earnings` (Task 5). ✓
- `CorrelationAlertPair` (Task 3) → used verbatim in `RunRiskSentrySummary.correlations` (Task 5). ✓
- `GateReading`/`MarketGateAlertResult` (Task 4) → used verbatim in `RunRiskSentryDeps`'s lastReading narrowing and `RunRiskSentrySummary.gate` (Task 5). ✓
- `RISK_SENTRY_HOLDINGS_SETTING`/`getRiskSentryHoldings`/`setRiskSentryHoldings` (Task 1) → imported by name, unchanged signature, in Task 5's `RunRiskSentryDeps` shape, Task 6's route, and Task 8's route. ✓
- `RunRiskSentryDeps`/`runRiskSentry`/`RISK_SENTRY_LAST_GATE_SETTING` (Task 5) → imported by name, unchanged signature, in Task 6. ✓
- Task 6 wires the real `fetchCandles`/`fetchCandlesBatch` (from `src/lib/marketData.ts`, wider `Range`/`Interval`-typed parameters with defaults) directly into `RunRiskSentryDeps`'s narrower `"2y"`/`"1d"`-literal parameter types — legal under TypeScript's contravariant function-parameter checking, since the real functions accept a superset of what the deps type requires them to accept. Confirmed no mismatch.
- Task 8's `riskSentryHoldings` field name is identical in the `GET` response, the `POST` body, and Task 9's `Global` interface and `fetch` calls. ✓

No issues found; nothing required fixing.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-16-risk-sentry.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
