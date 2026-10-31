# Chart Agent (agent #2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After every `/scan`, read the 5-minute charts of the 20 highest-activity names, find long liquidity-sweep setups against volume-profile and session levels, let the AI read and veto them, and pop up a panel of at most 5 setups that hand entry + stop to `/advisor`.

**Architecture:** Pure, unit-tested modules under `src/lib/chartAgent/` (bar split → levels → setup rule → AI review → orchestrator with injected I/O, the `runScanAgent` pattern). One new route `POST /api/chart-agent`, one Prisma model `ChartSetup` for logging, a modal on `/scan`, and a `stopOverride` on `/advisor`.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before app code), TypeScript, Prisma 7 + Neon, node:test via `npm test` (`tsx --test "src/**/*.test.ts"`), recharts, Alpaca SIP bars, `callAgentJSON` from `src/lib/anthropic.ts`.

**Spec:** `docs/superpowers/specs/2026-11-01-chart-agent-design.md`

## Global Constraints

- Long setups only. Never place or prepare an order; the owner places every order on Webull.
- The AI never computes or changes a number; every level, stop, target and R comes from code.
- Constants (in `src/lib/chartAgent/types.ts`, verbatim): `CHART_TOP_N = 20`, `CHART_MAX_SETUPS = 5`, `CHART_PROFILE_BINS = 50`, `CHART_VALUE_AREA = 0.7`, `CHART_STOP_BUFFER_ATR = 0.1`, `CHART_LEVEL_MERGE_ATR = 0.1`, `CHART_MIN_T1_R = 1.5`, `CHART_AI_BARS = 24`, `CHART_ATR_PERIOD = 14`.
- Sweep levels are exactly `PDL`, `PML`, `pVAL`. Target candidates are exactly `dPOC`, `pPOC`, `pVAH`, `PDH`, `PMH`.
- Times: session logic in America/New_York (pre-market 04:00–09:30, regular 09:30–16:00, by bar START time); times shown to the owner in Bangkok time, as `/scan` does.
- Thai copy fixed by the spec: "วันนี้ไม่มี setup", "ไม่มีระดับเหนือราคา", "เป้าแรกไม่ถึง 1.5R", "ถึงเป้าแรกไปแล้ว", "ยังไม่มีแท่งในเวลาทำการ", "ตลาดปิดแล้ว", "ตัดออก: มีคำทำนาย", "AI ไม่ได้อ่าน", "ไม่มีข้อมูลแท่ง 5 นาที", "ไม่มีแท่งของตัวนี้", "แท่งช้า 15 นาที", "stop จากกราฟ".
- The panel always carries the no-backtest line: the sweep rule is untested on stocks and its gold relative (xau-vp-v1 sweep + VP, H1) lost money in every fold.
- Thai text in source files is written with Write/Edit, never through a shell heredoc or script (an earlier task emptied a file that way).
- Never start a dev server with Bash; preview via `.claude/launch.json` `nexmind-dev-web` only. Keep `vercel.json` `crons: []`. Never echo `.env` values.
- Nothing under `src/app/` gets unit tests (project convention); it is verified live.

## Review Focus

1. **Monday / day after a holiday:** "previous session" must be the latest ET date before today that has regular-session bars, not "yesterday". → test in Task 1.
2. **DST:** a bar at 13:30Z is 09:30 ET in summer and 08:30 ET (pre-market) in winter. → test in Task 1.
3. **Flat or one-bar previous session** (`volumeProfile` returns null when high ≤ low): no crash, the ticker reports a reason. → test in Task 2.
4. **A sweep bar that is also today's first bar, with no pre-market at all** (PMH/PML absent): the setup still forms from PDL/pVAL. → test in Task 3.
5. **AI returns a ticker it was not given, omits one, or returns keep:true with an empty reading:** unknown tickers ignored, omitted ones treated as "AI ไม่ได้อ่าน" (shown, not rejected), empty reading shown as no reading. → test in Task 4.

---

### Task 1: Types, constants and the session split

**Files:**
- Create: `src/lib/chartAgent/types.ts`, `src/lib/chartAgent/bars.ts`, `src/lib/chartAgent/bars.test.ts`
- Modify: `src/lib/scanAgent/session.ts` (export a clock helper)

**Interfaces:**
- Produces in `session.ts`: `export function etClock(epochSec: number): { date: string; minutes: number }` (wraps the private `etParts`; `etDate` keeps working).
- Produces in `types.ts`: the Global Constraints constants, plus
  ```ts
  export type LevelName = "pPOC" | "pVAH" | "pVAL" | "PDH" | "PDL" | "PMH" | "PML" | "dPOC";
  export type Levels = Record<LevelName, number | null>;
  export interface SessionSplit { previousDate: string | null; previous: Candle[]; premarket: Candle[]; regular: Candle[] }
  export interface Target { price: number; names: LevelName[]; r: number }
  export interface Setup {
    ticker: string; entry: number; stop: number; t1: Target; t2: Target | null;
    sweptLevels: LevelName[]; sweepBar: Candle; tags: string[]; levels: Levels; dataAsOf: string;
  }
  export type SetupOutcome = { kind: "setup"; setup: Setup } | { kind: "none"; ticker: string; reason: string };
  ```
- Produces in `bars.ts`: `export function splitSessions(candles: Candle[], today: string): SessionSplit` — `today` is a YYYY-MM-DD ET date; `previous` = regular-session bars of the latest ET date `< today` that has any; `premarket`/`regular` = today's bars in [240, 570) / [570, 960) minutes; post-market and other bars dropped; input order preserved (ascending).

- [ ] **Step 1: Write failing tests in `bars.test.ts`**
  - `etClock` on `2026-10-30T13:30:00Z` → `{ date: "2026-10-30", minutes: 570 }` (EDT); on `2026-12-01T13:30:00Z` → `minutes: 510` (EST, pre-market).
  - `splitSessions` with bars on Fri 2026-10-30 (regular + a 17:00 ET post-market bar) and Mon 2026-11-02 (one 08:00 ET bar, two regular bars), `today = "2026-11-02"` → `previousDate === "2026-10-30"`, post-market bar absent from `previous`, `premarket.length === 1`, `regular.length === 2`.
  - Holiday gap: bars on 2026-11-25 and 2026-11-27 only, `today = "2026-11-27"` → `previousDate === "2026-11-25"`.
  - No earlier regular bars → `previousDate === null`, `previous` empty.
- [ ] **Step 2:** `npm test` → the new tests FAIL (module not found).
- [ ] **Step 3:** Implement `etClock`, `types.ts`, `splitSessions`.
- [ ] **Step 4:** `npm test` → all pass (959 existing + new).
- [ ] **Step 5:** Commit `feat(chart-agent): session split and shared types`.

### Task 2: Levels

**Files:** Create `src/lib/chartAgent/levels.ts`, `src/lib/chartAgent/levels.test.ts`

**Interfaces:**
- Consumes: `SessionSplit`, `Levels`, constants (Task 1); `volumeProfile(candles, i, lookback, bins, valueAreaPct)` from `src/lib/indicators.ts`.
- Produces: `export function computeLevels(split: SessionSplit): { levels: Levels } | { error: string }`.
  - `pPOC/pVAH/pVAL` = `volumeProfile(previous, previous.length - 1, previous.length, CHART_PROFILE_BINS, CHART_VALUE_AREA)`; `PDH/PDL` = max high / min low of `previous`; `PMH/PML` = of `premarket`, null when empty; `dPOC` = profile POC of `regular`, null when `regular` has < 2 bars or the profile is null.
  - Returns `{ error: "ไม่มีวันทำการก่อนหน้า" }` when `previous` is empty, `{ error: "profile เมื่อวานคำนวณไม่ได้" }` when the previous profile is null.

- [ ] **Step 1: Failing tests:** hand-built previous session where volume concentrates in one price band → `pPOC` inside that band and `pVAL ≤ pPOC ≤ pVAH`; `PDH`/`PDL` exact; empty premarket → `PMH === null && PML === null`; flat previous session (all bars h = l = 100) → `{ error }`; empty previous → `{ error: "ไม่มีวันทำการก่อนหน้า" }`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(chart-agent): volume-profile and session levels`.

### Task 3: Sweep and setup rule

**Files:** Create `src/lib/chartAgent/setup.ts`, `src/lib/chartAgent/setup.test.ts`

**Interfaces:**
- Consumes: Task 1 types/constants, `Levels` from Task 2.
- Produces: `export function findSetup(ticker: string, split: SessionSplit, levels: Levels, atrDaily: number): SetupOutcome`.

Rule (spec §5, in this order):
1. `regular` empty → none "ยังไม่มีแท่งในเวลาทำการ". `atrDaily` not finite or ≤ 0 → none "ATR คำนวณไม่ได้".
2. `last = regular.at(-1)`. Sweep bar = the most recent bar `b` in `regular` such that for some `L` in {PDL, PML, pVAL} (non-null): `b.l < L && b.c > L && last.c > L`. `sweptLevels` = every such `L` for that bar. None → none "ยังไม่มี sweep".
3. `stop = sweepBar.l − CHART_STOP_BUFFER_ATR × atrDaily`; `entry = last.c`.
4. Any bar after the sweep bar with `c < sweepBar.l` → none "หลุด low ของแท่ง sweep แล้ว".
5. Candidates = {dPOC, pPOC, pVAH, PDH, PMH} with price `> entry`, sorted ascending; walk them and merge a candidate into the previous group when within `CHART_LEVEL_MERGE_ATR × atrDaily` of that group's price (the group keeps its lower price, names accumulate). `t1` = first group, `t2` = second or null. None → none "ไม่มีระดับเหนือราคา".
6. Any bar after the sweep bar with `h ≥ t1.price` → none "ถึงเป้าแรกไปแล้ว".
7. `r = (price − entry) / (entry − stop)`; `t1.r < CHART_MIN_T1_R` → tag "เป้าแรกไม่ถึง 1.5R".
8. `dataAsOf` = ISO of `(last.t + 300) * 1000` (bar end).

- [ ] **Step 1: Failing tests** (one per rule line): qualifying PDL sweep → setup with exact stop `sweepLow − 0.1×ATR` and entry `last.c`; wick below with close below → none "ยังไม่มี sweep"; sweep then latest close back below L → none; later bar closes under sweep low → invalidation reason; two targets within 0.1×ATR → one group with both names; no level above → "ไม่มีระดับเหนือราคา"; a later high ≥ T1 → "ถึงเป้าแรกไปแล้ว"; T1 at 1.0R → tag present, at 2.0R → absent; PMH/PML null and the sweep bar is the first regular bar → setup forms from PDL (Review Focus 4); one bar sweeping both PDL and pVAL → `sweptLevels` has both.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(chart-agent): long sweep setup rule`.

### Task 4: AI review

**Files:** Create `src/lib/chartAgent/review.ts`, `src/lib/chartAgent/review.test.ts`

**Interfaces:**
- Consumes: `Setup`, `CHART_AI_BARS`; `isDirectional` from `@/lib/advisor/critiqueContext`; `aiBackend`, `aiOutageReason`, `callAgentJSON` from `@/lib/anthropic`; `safeFailureReason` from `@/lib/scanAgent/annotate`.
- Produces:
  ```ts
  export type ReviewStatus = "kept" | "rejected" | "stripped" | "unread";
  export interface Review { status: ReviewStatus; reading: string | null; reason: string | null }
  export const CHART_PREDICTION_PHRASES_TH: readonly string[];
  export function isChartPrediction(text: string): boolean;          // isDirectional || any phrase
  export function buildReviewPrompt(items: { setup: Setup; recent: Candle[] }[]): string;
  export function normalizeReviews(raw: unknown, tickers: string[]): Map<string, Review>;
  export async function reviewSetups(items: { setup: Setup; recent: Candle[] }[]): Promise<{ reviews: Map<string, Review>; backend: string; note: string | null }>;
  ```
- `CHART_PREDICTION_PHRASES_TH` = `["จะขึ้น","จะลง","น่าจะขึ้น","น่าจะลง","แน่นอน","โอกาสสูง","การันตี","รับประกัน","ชัวร์","กำไรแน่"]`.
- Model: `tier: "sonnet"`, `label: "chart-agent"`, `jsonSchema` = `{ reviews: [{ ticker, keep: boolean, reading: string, rejectReason: string | null }] }`, one call for all items, `maxTokens` 3000. The system prompt (Thai) says: describe structure like a trader in 2–3 lines; you may reject a setup whose structure reads poor and must give a Thai reason; never predict, never claim odds or certainty, never change numbers.
- `recent` = the last `CHART_AI_BARS` regular bars, sent as OHLCV rows with ET HH:MM.
- normalize: reading that trips `isChartPrediction` → `{ status: "stripped", reading: null, reason: "ตัดออก: มีคำทำนาย" }`; `keep:false` → `rejected` with its reason (a reason that itself trips the guard, or is empty, becomes "AI ตัดออกโดยไม่ให้เหตุผลที่แสดงได้"); missing ticker → `unread` "AI ไม่ได้อ่าน"; unknown tickers ignored; empty reading with keep → `kept`, reading null.
- `reviewSetups`: backend mock → every item `unread` with reason "AI ไม่ได้อ่าน" and `note` = outage reason; a thrown call → every item `unread`, `note = safeFailureReason(err)`; never throws.

- [ ] **Step 1: Failing tests** for `isChartPrediction` (each phrase; a plain description "sweep PDL แล้วกลับขึ้นมายืนเหนือ VAL" passes), `normalizeReviews` (all five branches above, Review Focus 5), `buildReviewPrompt` contains every ticker, its entry/stop/T1, and the ET time of the last recent bar.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement (`reviewSetups` is impure and untested, like `annotateRows`).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(chart-agent): AI chart reading with prediction guard`.

### Task 5: `ChartSetup` model and log rows

**Files:**
- Modify: `prisma/schema.prisma` (add model after `GateOverride`)
- Create: `src/lib/chartAgent/logRows.ts`, `src/lib/chartAgent/logRows.test.ts`

**Interfaces:**
- Model fields exactly as spec §8: `id Int @id @default(autoincrement())`, `createdAt DateTime @default(now())`, `runId String`, `ticker String`, `status String` (`shown|ai_rejected|guard_stripped|capped`), `dataAsOf String`, `entry Float`, `stop Float`, `t1 Float`, `t2 Float?`, `r1 Float`, `r2 Float?`, `sweptLevels String[]`, `sweepBarAt String`, `levels Json`, `aiReading String?`, `aiRejectReason String?`, `aiBackend String`, `@@index([createdAt])`, `@@index([ticker])`. A `///` doc comment saying these rows exist so a later spec can grade T1-before-stop against a random-entry control.
- Produces: `export type LogStatus = "shown" | "ai_rejected" | "guard_stripped" | "capped"; export interface ChartSetupRow { … }` (the model's create input minus id/createdAt) and `export function toLogRows(runId: string, decided: { setup: Setup; review: Review; status: LogStatus }[], backend: string): ChartSetupRow[]` — `sweepBarAt` = ISO of the bar start.

- [ ] **Step 1: Failing test:** one shown + one rejected + one capped → three rows with the right status, `t2`/`r2` null when `t2` null, `aiRejectReason` only on the rejected row.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Add the model, run `npx prisma generate` then `npm run db:push` (additive table only; confirm the push output says it created `ChartSetup` and dropped nothing — stop and report if it wants to drop or alter anything else). Implement `toLogRows`.
- [ ] **Step 4:** `npm test` → PASS; `npx tsc --noEmit` clean for the touched files.
- [ ] **Step 5:** Commit `feat(chart-agent): ChartSetup log model`.

### Task 6: Orchestrator and route

**Files:**
- Create: `src/lib/chartAgent/runChartAgent.ts`, `src/lib/chartAgent/runChartAgent.test.ts`, `src/app/api/chart-agent/route.ts`

**Interfaces:**
- Consumes: Tasks 1–5; `marketPhase`, `sessionDates` from `@/lib/scanAgent/session`; `atr` from `@/lib/indicators`.
- Produces:
  ```ts
  export interface ChartDeps {
    now: () => number;
    fetchIntraday: (tickers: string[]) => Promise<Map<string, Candle[]>>; // Alpaca 5d/5m
    fetchDaily: (tickers: string[]) => Promise<Map<string, Candle[]>>;    // Alpaca 1mo/1d
    review: typeof reviewSetups;
    log: (rows: ChartSetupRow[]) => Promise<void>;
    runId: () => string;
  }
  export interface ShownSetup { setup: Setup; review: Review; bars: Candle[] } // bars = previous + premarket + regular
  export type ChartAgentResult =
    | { ok: true; ranAt: string; phase: MarketPhase; dataAsOf: string | null; shown: ShownSetup[];
        rejected: { ticker: string; review: Review }[]; none: { ticker: string; reason: string }[];
        aiNote: string | null; logNote: string | null; backend: string }
    | { ok: false; error: string };
  export async function runChartAgent(tickers: string[], deps: ChartDeps): Promise<ChartAgentResult>;
  ```
- Flow: phase ≠ "open" → `ok: true`, `shown: []`, `none` = every ticker with "ยังไม่มีแท่งในเวลาทำการ" (pre) or "ตลาดปิดแล้ว" (closed), no fetch, no AI, no log. Otherwise fetch both maps in parallel; a throw from `fetchIntraday` → `ok:false, error: "ไม่มีข้อมูลแท่ง 5 นาที"`; a ticker absent → `none` "ไม่มีแท่งของตัวนี้". `today = sessionDates(now).session`; split → levels → `findSetup` with ATR14 of the daily candles' last value. Keep input order. Review all setups in one call; `kept`/`unread` are eligible; first `CHART_MAX_SETUPS` eligible → `shown`, the rest → status `capped`; `rejected` → `ai_rejected`, `stripped` → `guard_stripped` (both listed in `rejected`). Log every setup; a log throw sets `logNote` ("บันทึกลงฐานข้อมูลไม่ได้: …") and never fails the run. `ok:false` only when intraday fetch fails or no ticker had intraday bars.
- Route: `POST`, `export const dynamic = "force-dynamic"`, `export const maxDuration = 300`; body `{ tickers }` must be an array of 1..`CHART_TOP_N` strings matching `/^[A-Z][A-Z.\-]{0,9}$/` after trim/uppercase, else 400 JSON `{ ok:false, error }`; live deps use `fetchAlpacaCandlesBatch` (map `CandleResponse.candles`), `reviewSetups`, `prisma.chartSetup.createMany`, `crypto.randomUUID`. `ok:false` → 502.

- [ ] **Step 1: Failing tests** with fake deps: closed phase → no fetch called, every ticker in `none`; intraday throw → `ok:false`; 7 eligible setups → 5 shown + 2 logged as `capped`; a rejected and a stripped setup → in `rejected`, logged with the right status; log throw → `ok:true` with `logNote`; missing ticker → `none` "ไม่มีแท่งของตัวนี้"; AI unavailable (`unread` everywhere) → all setups eligible.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement orchestrator, then the route (read the route-handler guide in `node_modules/next/dist/docs/` first).
- [ ] **Step 4:** `npm test` → PASS; `npx tsc --noEmit` clean for the touched files.
- [ ] **Step 5:** Commit `feat(chart-agent): orchestrator and POST /api/chart-agent`.

### Task 7: `/advisor` accepts a chart stop

**Files:**
- Modify: `src/lib/advisor/types.ts` (`AdvisorInput.stopOverride?: number | null`; `AdvisorCard.stopSource: "atr" | "chart"`; `AdvisorCard.stopAtrMult: number`), `src/lib/advisor/advise.ts`, `src/lib/advisor/advise.test.ts`, `src/app/api/advisor/route.ts` (read `stop` with `readPositive(body.stop, "Stop")`), `src/app/advisor/page.tsx` (read `entry` and `stop` search params), `src/app/advisor/advisor-form.tsx` (`initialEntry`, `initialStop` props; a stop field shown only when prefilled, cleared with the entry when the ticker changes; card label "stop จากกราฟ (k×ATR)" with k to 2 decimals when `stopSource === "chart"`).
- Fix any test fixture that builds an `AdvisorCard` by hand (critiqueContext tests did last time) by adding `stopSource: "atr"`, `stopAtrMult: 1.5`.

**Interfaces:**
- In `advise`: valid when `stopOverride` finite and `0 < stopOverride < entry` → `slDistance = entry − stopOverride`, `stopSource = "chart"`; given but invalid → ignored, warning "Stop จากกราฟ (X) ไม่ได้อยู่ใต้ราคาเข้า จึงใช้ 1.5×ATR แทน"; absent → as today. `stopAtrMult = slDistance / atrValue`. `baseRate(input.gapHistory, ADVISOR_R_STEPS, BASE_RATE_HORIZON, stopAtrMult)` (signature: `candles, rSteps, horizon, slMult, period`). The base-rate caveat line on the card names the multiple instead of the hard-coded `ADVISOR_ATR_SL_MULT` when `stopSource === "chart"`.

- [ ] **Step 1: Failing tests in `advise.test.ts`:** stopOverride 95 with entry 100 → `card.stop === 95`, `stopSource "chart"`, sizing uses distance 5; stopOverride 101 → ignored, warning present, `stopSource "atr"`; no override → `stopAtrMult === 1.5`; base-rate table uses `stopAtrMult` (assert via a fixture where the two multiples give different stop-first counts).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement lib, route, page, form.
- [ ] **Step 4:** `npm test` → PASS; `npx tsc --noEmit` clean for the touched files.
- [ ] **Step 5:** Commit `feat(advisor): accept a chart stop via ?stop=`.

### Task 8: Setup panel on `/scan`

**Files:**
- Create: `src/app/scan/setup-panel.tsx` (modal + cards), `src/app/scan/setup-chart.tsx` (recharts 5-minute candles, pattern from `src/app/advisor/advisor-chart.tsx`)
- Modify: `src/app/scan/scan-panel.tsx`

**Interfaces:**
- Consumes: `ChartAgentResult`, `ShownSetup` (Task 6), `/advisor?ticker&entry&stop` (Task 7).
- After a successful scan, `scan-panel` POSTs `{ tickers: scan.rows.slice(0, CHART_TOP_N).map(r => r.ticker) }` to `/api/chart-agent`, shows "กำลังอ่านกราฟ…", and opens the modal when it returns (also on `ok:false`, showing the error). A "ดู setup" button reopens it. The scan table never waits on it.
- Modal header: ran-at and data-as-of in Bangkok time, phase, "แท่งช้า 15 นาที", the no-backtest line (Global Constraints). Body: "วันนี้ไม่มี setup" when `shown` is empty; else one card per setup — chart with horizontal lines for every non-null level (labelled by name), entry/stop/T1/T2 lines, a marker on the sweep bar; a table of entry, stop, T1 and T2 with names and R (2 decimals); tags; the AI reading or its status reason; "→ Advisor" link `/advisor?ticker=…&entry=…&stop=…` (prices to 2 decimals). Footer, collapsed: rejected list with reasons, then the `none` list with reasons, then `aiNote`/`logNote` if present. Closable by button and Escape.

- [ ] **Step 1:** Implement both components and the scan-panel wiring (read the client-component guide in `node_modules/next/dist/docs/` first).
- [ ] **Step 2:** `npx tsc --noEmit` clean for the touched files; `npm test` still all pass.
- [ ] **Step 3: Live check** (main checkout via `nexmind-dev-web`, or in a worktree `next build --webpack` + `next start -p 3275`): press "สแกนตอนนี้"; the modal opens with the phase message out of hours, or with setups/"วันนี้ไม่มี setup" during the session; "→ Advisor" lands with ticker, entry and stop filled and the card shows "stop จากกราฟ". Check the console for errors. Screenshot.
- [ ] **Step 4:** Commit `feat(scan): chart-agent setup panel`.

### Task 9: State handoff

**Files:** Modify `docs/STATE.md`

- [ ] **Step 1:** Add a §3 entry for the chart agent (what shipped, commit range, the live-check result, the untested-rule caveat, AI availability), update §1's `/scan` bullet to mention the setup panel and `/advisor`'s `?stop=`, update §2's test count from a real `npm test` run and add `ChartSetup` to the live-state table. Keep the file under ~150 lines per §7.
- [ ] **Step 2:** Commit `docs(state): chart agent`.
