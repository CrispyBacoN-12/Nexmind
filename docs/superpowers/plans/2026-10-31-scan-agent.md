# Scan Agent (agent #1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/scan` page with a "สแกนตอนนี้" button that ranks today's most active S&P 500 stocks for a day trade, with news tags and a short AI summary per row.

**Architecture:** Pure logic in `src/lib/scanAgent/` (session clock, filters, score, parsers, prompt/guard); thin I/O modules beside it (TradingView screener, TradingView economic calendar, AI call); one orchestrator `runScanAgent` with injected deps, same shape as `runRiskSentry`; one POST route; one client page. Nothing is stored.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before app code), TypeScript, `node:test` via `npm test`, existing `src/lib/anthropic.ts`, `src/lib/market/news.ts`, `src/lib/market/secFilings.ts`, `src/lib/riskSentry/filingWatch.ts`.

**Spec:** `docs/superpowers/specs/2026-10-31-scan-agent-design.md`

## Global Constraints

- Universe: `UNIVERSES.sp500.symbols` from `src/lib/trading/universe.ts` only (owner).
- Data: TradingView `POST https://scanner.tradingview.com/america/scan` (unofficial, 15-min delayed). A failure is an error naming TradingView, never an empty table.
- Fractional shares allowed: no upper price filter. A row whose `close > SCAN_SLOT_BUDGET` (500 = $2,500 / 5, the `/advisor` defaults) is tagged `เศษหุ้น · ตั้ง stop ไม่ได้ ต้องเฝ้าเอง`.
- Qualifying triggers: gap, volume, earnings reported (last night / this morning). "Earnings tonight" and 8-Ks are tags only.
- Order = activity score, never odds. The AI never says buy/sell/best; directional text is stripped with `isDirectional` from `src/lib/advisor/critiqueContext.ts`.
- Every failed source is named on the page (`SourceStatus`). Unknown is never an all-clear.
- UI copy in Thai. Preview with launch config `nexmind-dev-web` only. Nothing under `src/app/` gets tests (repo convention).
- No schedule, no Discord, no DB writes, no desk code re-enabled.

## Review Focus

1. **TradingView covers fewer tickers than the S&P list** (dash vs dot class shares like `BRK-B`/`BRK.B`, renamed or delisted names): expect the page to say "covered N of M" and the missing names listed in the source note. Test in Task 1 (`BRK-B` round-trip) and Task 6 (coverage note).
2. **Null fields** (no pre-market trading → `premarket_*` null; ATR null on a new listing): expect the row to fail the affected trigger quietly, never crash and never show `NaN`. Test in Task 3.
3. **Pressed on a weekend, after the close, or before 04:00 ET**: expect phase `closed`, the last session's numbers, and earnings tags dated to that session. Test in Task 2 (Saturday) and Task 3.
4. **AI misbehaves** (directional words, malformed JSON, skips a ticker, backend is `mock` on Vercel): expect a null note with a visible reason per row and an `AI` source marked failed, never raw model text. Test in Task 5.
5. **Secondary sources fail** (Finnhub, EDGAR, economic calendar): expect the table to render with those columns marked unavailable and each failure named in `sources`. Test in Task 6.

US market holidays are not modelled; on a holiday the phase label may read `pre`/`open`. The page footer says so.

---

### Task 1: Types and the TradingView client

**Files:**
- Create: `src/lib/scanAgent/types.ts`
- Create: `src/lib/scanAgent/tradingview.ts`
- Test: `src/lib/scanAgent/tradingview.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - constants `SCAN_MIN_PRICE = 5`, `SCAN_MIN_AVG_VOLUME = 1_000_000`, `SCAN_MIN_ATR_PCT = 1.5`, `SCAN_GAP_TRIGGER_PCT = 2`, `SCAN_RVOL_TRIGGER = 2`, `SCAN_PREMARKET_VOLUME_TRIGGER_PCT = 3`, `SCAN_SLOT_BUDGET = 500`, `SCAN_NEWS_TOP_N = 30`, `SCAN_AI_TOP_N = 30`, `SCAN_AI_BATCH = 10`
  - `type MarketPhase = "pre" | "open" | "closed"`
  - `interface TvRow { ticker: string; exchange: string; type: string; close: number; changePct: number | null; gapPct: number | null; premarketChangePct: number | null; premarketVolume: number | null; rvolIntraday: number | null; rvol10d: number | null; avgVolume10d: number | null; atr: number | null; earningsLastAt: number | null; earningsLastTime: number | null; earningsNextAt: number | null; earningsNextTime: number | null }` (`*At` are epoch seconds; `*Time` is TradingView's -1 before open / 1 after close / 0 unknown)
  - `type EarningsTag = "reported" | "tonight" | null`
  - `type Trigger = "gap" | "volume" | "earnings"`
  - `interface VolumeMetric { kind: "rvol" | "premarketPct"; value: number | null }`
  - `interface SourceStatus { name: string; ok: boolean; note: string }`
  - `interface EconEvent { title: string; at: string; thaiTime: string }`
  - `interface ScanRow { rank: number; ticker: string; price: number; changePct: number | null; gapPct: number | null; volume: VolumeMetric; atrPct: number | null; earnings: EarningsTag; triggers: Trigger[]; filings: FilingHit[]; headlines: NewsHeadline[]; note: string | null; noteReason: string | null; fractional: boolean; score: number }`
  - `type ScanResult = { ok: true; scannedAt: string; phase: MarketPhase; sessionDate: string; universeSize: number; covered: number; passed: number; rows: ScanRow[]; econ: EconEvent[] | null; sources: SourceStatus[]; scoreFormula: string } | { ok: false; error: string }`
- Produces (`tradingview.ts`): `TV_COLUMNS: readonly string[]`, `buildTvRequest(symbols: string[]): Record<string, unknown>`, `parseTvResponse(json: unknown): TvRow[]` (throws on a body with no `data` array), `fetchTradingViewRows(symbols: string[]): Promise<TvRow[]>` (throws `Error("TradingView HTTP <status>")` or the parse error).

- [ ] **Step 1: Write the failing tests** in `tradingview.test.ts`:
  - `buildTvRequest converts class-share dashes to dots`: `buildTvRequest(["BRK-B","KO"])` has a filter `{ left: "name", operation: "in_range", right: ["BRK.B","KO"] }`, a filter on `type` equal `"stock"`, and `range[1] >= 2`.
  - `parseTvResponse maps a row and converts dots back to dashes`: given `{ data: [{ s: "NYSE:BRK.B", d: [...] }] }` built in `TV_COLUMNS` order, returns `ticker: "BRK-B"`, `exchange: "NYSE"`.
  - `parseTvResponse turns non-numbers into null, never NaN`: a `null` `premarket_change` and a string `ATR` give `premarketChangePct === null`, `atr === null`.
  - `parseTvResponse throws on a body without data`: `assert.throws(() => parseTvResponse({ error: "x" }))`.
- [ ] **Step 2: Run** `npx tsx --test src/lib/scanAgent/tradingview.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `types.ts` and `tradingview.ts`. `TV_COLUMNS` = `name, exchange, type, close, change, gap, premarket_change, premarket_volume, relative_volume_intraday|5, relative_volume_10d_calc, average_volume_10d_calc, ATR, earnings_release_date, earnings_release_time, earnings_release_next_date, earnings_release_next_time` (all probed live 2026-10-31). Request: `markets: ["america"]`, filters `name in_range <symbols>` and `type equal "stock"`, `range: [0, symbols.length + 50]`. `ScanRow` imports `FilingHit` from `@/lib/riskSentry/filingWatch` and `NewsHeadline` from `@/lib/market/news` as types only.
- [ ] **Step 4: Run** the test file. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scan): TradingView screener client and scan types`.

### Task 2: Session clock

**Files:**
- Create: `src/lib/scanAgent/session.ts`
- Test: `src/lib/scanAgent/session.test.ts`

**Interfaces:**
- Produces: `marketPhase(nowMs: number): MarketPhase`; `sessionDates(nowMs: number): { session: string; previous: string }` (YYYY-MM-DD in America/New_York); `etDate(epochSec: number): string`; `etSessionCloseMs(date: string): number` (16:00 New York on that date, as epoch ms, DST-correct).

Rules: weekday 04:00 ≤ t < 09:30 ET is `pre`, 09:30 ≤ t < 16:00 is `open`, anything else `closed`. `session` is today on a weekday at/after 04:00 ET, otherwise the most recent earlier weekday. `previous` is the weekday before `session`. Use `Intl.DateTimeFormat` with `timeZone: "America/New_York"`; no date library.

- [ ] **Step 1: Write the failing tests:**
  - `pre-market, open and after-close on a weekday`: 2026-10-30 12:00Z → `pre`; 14:00Z → `open`; 21:00Z → `closed` (EDT, UTC−4).
  - `a Saturday is closed and its session is Friday`: 2026-10-31 15:00Z → `closed`, `sessionDates` → `{ session: "2026-10-30", previous: "2026-10-29" }`.
  - `before 04:00 ET on a Monday the session is the Friday before`: 2026-11-02 07:00Z (EST after 2026-11-01) → `session: "2026-10-30"`.
  - `etSessionCloseMs respects DST`: `etSessionCloseMs("2026-10-30") === Date.parse("2026-10-30T20:00:00Z")` and `etSessionCloseMs("2026-11-02") === Date.parse("2026-11-02T21:00:00Z")`.
- [ ] **Step 2: Run** `npx tsx --test src/lib/scanAgent/session.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `session.ts`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scan): New York session clock`.

### Task 3: Filters, triggers and the activity score

**Files:**
- Create: `src/lib/scanAgent/filter.ts`
- Test: `src/lib/scanAgent/filter.test.ts`

**Interfaces:**
- Consumes: `TvRow`, constants, `MarketPhase`, `EarningsTag`, `Trigger`, `VolumeMetric` (Task 1); `etDate` (Task 2); `FilingHit` from `@/lib/riskSentry/filingWatch`.
- Produces: `atrPct(row: TvRow): number | null`; `passesBase(row: TvRow): boolean`; `earningsTag(row: TvRow, dates: { session: string; previous: string }): EarningsTag`; `gapFor(row: TvRow, phase: MarketPhase): number | null`; `volumeFor(row: TvRow, phase: MarketPhase): VolumeMetric`; `triggersFor(row: TvRow, phase: MarketPhase, tag: EarningsTag): Trigger[]`; `activityScore(gapPct: number | null, volume: VolumeMetric, tag: EarningsTag, filings: FilingHit[]): number`; `SCAN_SCORE_FORMULA: string` (Thai, shown on the page).

Rules (spec §6.2-6.3; thresholds are the Task 1 constants):
- `passesBase`: `type === "stock"`, `close >= SCAN_MIN_PRICE`, `avgVolume10d >= SCAN_MIN_AVG_VOLUME`, `atrPct >= SCAN_MIN_ATR_PCT`. Null in any of these fails.
- `earningsTag`: `"reported"` when `etDate(earningsLastAt) === session` with time −1 or 0, or `=== previous` with time 1; `"tonight"` when `etDate(earningsNextAt) === session` with time 1; else null.
- `gapFor`: `pre` → `premarketChangePct`; otherwise `gapPct`.
- `volumeFor`: `pre` → `{ kind: "premarketPct", value: premarketVolume / avgVolume10d * 100 }`; `open` → `{ kind: "rvol", value: rvolIntraday }`; `closed` → `{ kind: "rvol", value: rvol10d }`.
- `triggersFor`: `"gap"` if `|gap| >= SCAN_GAP_TRIGGER_PCT`; `"volume"` if rvol `>= SCAN_RVOL_TRIGGER` or premarketPct `>= SCAN_PREMARKET_VOLUME_TRIGGER_PCT`; `"earnings"` if tag is `"reported"`. `"tonight"` never triggers.
- `activityScore` = `|gap|` + volume points (`min(rvol, 10)`, or `min(premarketPct / 2, 10)`) + 3 if reported + (2 for any red filing, else 1 for any notable). Nulls count 0.

- [ ] **Step 1: Write the failing tests:**
  - `base filter rejects cheap, illiquid and sleepy names, keeps an expensive one`: price 4 → false; avg volume 500k → false; ATR% 1.0 → false; a $900 stock with ATR% 2 and 2M volume → true (no upper price bound).
  - `null fields fail their trigger without throwing`: a row with every pre-market field null in phase `pre` → `triggersFor` returns `[]`, `volumeFor(...).value === null`, `activityScore` is finite.
  - `pre-market uses pre-market numbers, the session uses the open gap and intraday rvol`: same row, `gapFor(row,"pre") === premarketChangePct`, `gapFor(row,"open") === gapPct`, `volumeFor(row,"open").value === rvolIntraday`.
  - `earnings tags`: last report on `previous` with time 1 → `"reported"`; last on `session` with time −1 → `"reported"`; next on `session` with time 1 → `"tonight"`; next on `session` with time −1 and last a month ago → null.
  - `earnings tonight alone never qualifies`: a row with tag `"tonight"`, gap 0.5, rvol 1 → `triggersFor` returns `[]`.
  - `score is the documented sum`: gap −4, rvol 3, reported, one red filing → `4 + 3 + 3 + 2 === 12`.
- [ ] **Step 2: Run** `npx tsx --test src/lib/scanAgent/filter.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `filter.ts`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scan): base filter, triggers and activity score`.

### Task 4: Economic calendar

**Files:**
- Create: `src/lib/scanAgent/econ.ts`
- Test: `src/lib/scanAgent/econ.test.ts`

**Interfaces:**
- Consumes: `EconEvent` (Task 1), `etDate` (Task 2).
- Produces: `parseEconEvents(json: unknown): EconEvent[]` (keeps `importance === 1` and `country === "US"`; `thaiTime` is `HH:mm` in Asia/Bangkok; throws when `result` is not an array); `eventsForSession(events: EconEvent[], session: string): EconEvent[]` (New York date of `at` equals `session`); `fetchEconEvents(session: string): Promise<EconEvent[]>` (GET `https://economic-calendar.tradingview.com/events?from=<session−1d>&to=<session+1d>&countries=US` with header `Origin: https://www.tradingview.com`, probed live 2026-10-31; throws on non-OK).

- [ ] **Step 1: Write the failing tests:**
  - `keeps only high-importance US events and formats Thai time`: an event at `2026-10-30T12:30:00.000Z` with importance 1 → `thaiTime === "19:30"`; importance 0 and a non-US event are dropped.
  - `filters to the session's New York date`: an event at `2026-10-31T01:00:00Z` (21:00 ET on the 30th) is in session `2026-10-30`.
  - `a body without result throws`.
- [ ] **Step 2: Run** `npx tsx --test src/lib/scanAgent/econ.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `econ.ts`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scan): high-importance US economic calendar`.

### Task 5: AI summaries with the directional guard

**Files:**
- Create: `src/lib/scanAgent/annotate.ts`
- Test: `src/lib/scanAgent/annotate.test.ts`

**Interfaces:**
- Consumes: `SourceStatus`, `SCAN_AI_BATCH` (Task 1); `aiBackend`, `aiOutageReason`, `callAgentJSON` from `@/lib/anthropic`; `isDirectional` from `@/lib/advisor/critiqueContext`.
- Produces:
  - `interface AnnotateInput { ticker: string; facts: string }` (`facts` is one line of numbers, tags, 8-K labels and up to 3 headlines, built by Task 6)
  - `ANNOTATE_SYSTEM: string` (Thai). Ask for 1-2 Thai lines per ticker saying what is happening today and any caveat. Forbid buy/sell/hold advice, predictions of direction, ranking or "best pick". Return JSON `{"notes":[{"ticker","note"}]}`.
  - `normalizeNotes(raw: unknown, tickers: string[]): Map<string, { note: string | null; reason: string | null }>`: a directional note gives `note: null, reason: "ตัดออก: มีคำชี้นำ"`; a missing ticker gives `reason: "AI ไม่ได้ตอบตัวนี้"`; unknown tickers are ignored.
  - `annotateRows(inputs: AnnotateInput[]): Promise<{ notes: Map<string, { note: string | null; reason: string | null }>; status: SourceStatus }>`. It never throws. When `aiBackend() === "mock"`, every reason is `"AI ใช้ไม่ได้: " + (aiOutageReason() ?? "no AI backend")` and the status is not ok. Otherwise it calls in batches of `SCAN_AI_BATCH` with `tier: "haiku"`, `label: "scan-agent"`, a `jsonSchema`, and `maxTokens: 1500`. A failed batch gives its tickers a reason and never raw model text (same rule as `critiqueCard`).

- [ ] **Step 1: Write the failing tests** (pure only; no subprocess):
  - `a clean note is kept`: `normalizeNotes({ notes: [{ ticker: "KO", note: "งบออกเช้านี้ gap +3%" }] }, ["KO"])` → note kept, reason null.
  - `a directional note is stripped with a visible reason`: a note containing a phrase `isDirectional` flags (use one from its existing tests) → `note: null`, `reason: "ตัดออก: มีคำชี้นำ"`.
  - `a skipped ticker gets a reason`: tickers `["KO","AAPL"]`, notes only for KO → AAPL reason `"AI ไม่ได้ตอบตัวนี้"`.
  - `malformed shapes never throw`: `normalizeNotes("garbage", ["KO"])` and `normalizeNotes({ notes: [{ ticker: 5 }] }, ["KO"])` → KO has a reason.
- [ ] **Step 2: Run** `npx tsx --test src/lib/scanAgent/annotate.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `annotate.ts`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scan): AI row summaries behind the directional guard`.

### Task 6: The orchestrator

**Files:**
- Create: `src/lib/scanAgent/runScanAgent.ts`
- Test: `src/lib/scanAgent/runScanAgent.test.ts`

**Interfaces:**
- Consumes: everything above; `UNIVERSES` (`sp500`); `filingWatch`, `FilingFetchResult` from `@/lib/riskSentry/filingWatch`; `RecentNews` from `@/lib/market/news`.
- Produces:
  - `interface ScanDeps { fetchTradingViewRows(symbols: string[]): Promise<TvRow[]>; fetchRecentFilings(tickers: string[]): Promise<Map<string, FilingFetchResult>>; fetchRecentNews(symbol: string, days: number, limit: number): Promise<RecentNews>; fetchEconEvents(session: string): Promise<EconEvent[]>; annotateRows(inputs: AnnotateInput[]): Promise<{ notes: Map<string, { note: string | null; reason: string | null }>; status: SourceStatus }> }`
  - `runScanAgent(deps: ScanDeps, nowMs?: number): Promise<ScanResult>`

Flow:
1. Read the phase and dates.
2. Fetch TradingView rows. On a throw, return `{ ok: false, error: "TradingView: <message>" }`.
3. Apply `passesBase`, then tag, then `triggersFor`. Rows with at least one trigger have passed.
4. Fetch 8-Ks for the passed rows: `filingWatch` with `since = etSessionCloseMs(previous)` and `until = now`.
5. Score, sort descending, assign ranks starting at 1.
6. For the top `SCAN_NEWS_TOP_N`, fetch headlines `(ticker, 2, 3)` with concurrency 5.
7. Annotate the top `SCAN_AI_TOP_N`.
8. Fetch the economic calendar and run `eventsForSession`. On failure, set `econ: null`.
9. Set `fractional = price > SCAN_SLOT_BUDGET`.
10. Build `sources` with one entry each:
    - `TradingView`: note `"ครอบคลุม <covered> จาก <universeSize> ตัว"`, plus the first 10 missing tickers
    - `SEC 8-K`: failed tickers named
    - `Finnhub news`: count of failed fetches
    - `ปฏิทินเศรษฐกิจ`
    - `AI`

- [ ] **Step 1: Write the failing tests** with stubbed deps and a fixed `nowMs` (2026-10-30 12:00Z, `pre`):
  - `TradingView failure is an error, not an empty list`: `fetchTradingViewRows` rejects → `{ ok: false }` with `error` starting `"TradingView:"`.
  - `coverage is reported`: return rows for 3 of the universe → `covered === 3`, the TradingView source note contains `"3 จาก"`.
  - `only triggered rows are listed, ranked by score`: three base-passing rows with gaps 1, 5 and 3 (no volume, no earnings) → rows `[gap 5, gap 3]`, ranks `[1, 2]`.
  - `secondary failures are named and the table still renders`: econ, 8-K and news deps all reject or return errors → `ok: true`, rows present, `econ === null`, and the sources for `SEC 8-K`, `Finnhub news` and `ปฏิทินเศรษฐกิจ` each have `ok: false`.
  - `an expensive row is flagged fractional`: close 900 → `fractional === true`.
  - `AI is asked only about the top N`: 40 triggered rows → `annotateRows` receives 30 inputs.
- [ ] **Step 2: Run** `npx tsx --test src/lib/scanAgent/runScanAgent.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `runScanAgent.ts`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass, 880 + the new tests.
- [ ] **Step 5: Commit** `feat(scan): runScanAgent orchestrator`.

### Task 7: Route, page, sidebar, Advisor prefill, docs

**Files:**
- Create: `src/app/api/scan/route.ts`
- Create: `src/app/scan/page.tsx`, `src/app/scan/scan-panel.tsx`
- Modify: `src/components/sidebar.tsx` (add `{ href: "/scan", label: "Scanner", icon: Radar }` first)
- Modify: `src/app/advisor/page.tsx`, `src/app/advisor/advisor-form.tsx` (prefill from `?ticker=`)
- Modify: `docs/STATE.md` (§1 surfaces, §3 entry, §2 test count)

**Interfaces:**
- Consumes: `runScanAgent`, `ScanResult` (Task 6); real deps `fetchTradingViewRows`, `fetchRecentFilings`, `fetchRecentNews`, `fetchEconEvents`, `annotateRows`.
- Produces: `POST /api/scan` → `ScanResult`. Status 200 when ok, 502 when `ok: false`. `export const maxDuration = 300` and `dynamic = "force-dynamic"`.

- [ ] **Step 1: Read** the Next 16 docs in `node_modules/next/dist/docs/` on page `searchParams` (a Promise in this version) and on route handlers.
- [ ] **Step 2: Build the route and the page** to match the reviewed mockup (`.superpowers/brainstorm/1657-1793442270/content/scan-page.html`):
  - the button and last-scan time in Thai time (Asia/Bangkok)
  - the phase label (`ก่อนตลาดเปิด` / `ตลาดเปิด` / `ตลาดปิด — ตัวเลขของวันทำการล่าสุด`) and "ผ่าน <passed> จาก <covered>"
  - the econ banner, or `ปฏิทินเศรษฐกิจใช้ไม่ได้` when `econ === null`
  - the table:
    - columns: rank, ticker, price, gap, volume (`×` for rvol, `% ของวันปกติ` for pre-market), ATR%, tags, AI note (or `noteReason` in muted text), `→ Advisor` link to `/advisor?ticker=<ticker>`
    - tags: earnings, each 8-K item, fractional
  - a sources strip that shows every `ok: false` source
  - the footer: `SCAN_SCORE_FORMULA`, the Task 1 thresholds (imported from `types.ts`), "เรียงตามความคึกคัก ไม่ใช่โอกาสขึ้น", "ไม่มีกฎไหนในโปรเจกต์นี้ผ่านการทดสอบย้อนหลัง", "ข้อมูลช้า 15 นาที", and "ไม่รู้วันหยุดตลาดสหรัฐ"
  - while the scan runs: a disabled button reading `กำลังสแกน…`
  - when it fails: the route's `error` shown in a card
- [ ] **Step 3: Prefill Advisor.** `AdvisorPage` reads `ticker` from `searchParams`, uppercases it, and passes `initialTicker` to `AdvisorForm`. The form's ticker `useState` starts from it. It does not auto-submit.
- [ ] **Step 4: Verify.**
  - Run `npx tsc --noEmit`, `npm test`, and `npx next build`. Expected: clean, all pass, `/scan` and `/api/scan` in the route list.
  - Start `nexmind-dev-web` and open `/scan`. Press the button. Expect a table, or a named TradingView error. Expect no console errors.
  - Click `→ Advisor` and confirm the ticker field is filled.
  - Take a screenshot.
- [ ] **Step 5: Update `docs/STATE.md`** (§1: `/scan` is the first surface; §3: entry with commit hashes; §2: test count). Then commit `feat(scan): /scan page, route and Advisor prefill` together with the STATE.md change.
