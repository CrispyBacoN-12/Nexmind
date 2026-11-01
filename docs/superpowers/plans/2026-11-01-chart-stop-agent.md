# Chart Stop Agent (agent #3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/advisor` finds its own stop from the 5-minute chart (given → swing low → PDL → ATR), discloses its source, and shows a guarded Thai AI reading of that stop.

**Architecture:** A pure `findChartStop` in `src/lib/advisor/chartStop.ts` reads finished 5-minute bars. `advise()` stays pure: it takes the bars as input and runs the stop chain. The advisor route adds one fail-soft Alpaca 5-minute fetch. A pure prompt/guard module plus an impure reader (mirroring `advisorCritic`) back a new `POST /api/advisor/stop-reading`. The form fires that reading on mount, like RAVEN.

**Tech Stack:** Next.js 16 App Router, TypeScript, node:test via `npm test`, Claude CLI through `src/lib/anthropic.ts`.

**Spec:** `docs/superpowers/specs/2026-11-01-chart-stop-agent-design.md`

## Global Constraints

- **No edge claim.** `ADVISOR_NO_EDGE_CLAIM` stands. The AI reading never carries:
  - a prediction or probability
  - an entry or exit call
  - a recommended stop price
  - buy advice
- **The AI reading never changes a number on the card.** The card is complete without it.
- **No DB writes anywhere in this plan.**
- **Never read a forming bar.** Keep only bars with `(t + CHART_BAR_SECONDS) <= cutoffSec`. The
  route sets `cutoffSec = nowSec - SIP_DELAY_MS / 1000`.
- **Long only.** A stop is valid only when it is finite, `> 0` and strictly `<` the card's final entry.
- **Buffer.** Structural stops sit `CHART_STOP_BUFFER_ATR` (0.1) × the card's daily ATR14 below their
  structure. Reuse the constant from `src/lib/chartAgent/types.ts`.
- **Flags.** A distance `< 0.5 × ATR` gets the flag "แคบมาก โดน noise ง่าย". A distance `> 3 × ATR`
  gets "กว้างมาก หุ้นที่ซื้อได้จะน้อย". Flags never change the stop.
- **Copy.** Owner-facing copy is Thai. The AI prompt is Thai and must forbid the English words
  `isDirectional` strips, as the chart agent's prompt does.
- **Next.js 16 has breaking changes.** Read `node_modules/next/dist/docs/` before writing a route or
  page.
- **Tests.** Nothing under `src/app/` gets tests, by design. `npm test` must stay green. Judge lint
  only on touched files.
- **Verification.** Never start a dev server with Bash. In a worktree with a junctioned
  `node_modules`, verify with `next build --webpack` + `next start`, not `next dev`.

## Review Focus

1. **Owner opens /advisor in the Thai evening, before the US open.** Only pre-market bars exist for
   today. The reading session must be the last completed session, its date must be shown, and PDL
   must come from the session before it. Test in Task 1.
2. **Typed entry below every pivot**, e.g. a limit entry under the swing. Swing is skipped, the chain
   goes on to PDL or ATR, and the reason is stated. Test in Task 2.
3. **Alpaca returns no 5-minute bars**, e.g. a symbol format it does not know, or a fetch error. The
   card still renders on ATR with the reason. Test in Task 1 (empty) and Task 2 (`{ error }` input).
4. **The model answers with English guard words or a prediction.** The reading is stripped, never
   shown. Test in Task 3.
5. **The "ใช้ stop ATR แทน" button after a ticker change.** Changing the ticker already clears the
   stop field. The button must fill the stop from the card currently shown and resubmit, and the
   resulting card must read source `given`. This lives in UI code with no tests: the reviewer checks
   it by reading the code.

---

### Task 1: `findChartStop` and `buildStopContext` (pure)

**Files:**
- Create: `src/lib/advisor/chartStop.ts`
- Test: `src/lib/advisor/chartStop.test.ts`

**Interfaces:**
- Consumes:
  - `splitSessions(candles, today)` and `SessionSplit` from `src/lib/chartAgent/bars.ts` / `types.ts`
  - `computeLevels(split)` and `Levels`
  - `etClock(epochSec)` from `src/lib/scanAgent/session.ts`
  - `CHART_BAR_SECONDS`, `CHART_STOP_BUFFER_ATR`
  - `Candle` from `@/lib/indicators`
- Produces:
  ```ts
  export const STOP_PIVOT_SIDE_BARS = 2;
  export const STOP_READING_BARS = 48;
  export type StructuralSource = "swing" | "pdl";
  export interface StopStructure { level: number; barT: number; sessionDate: string }
  export type ChartStopResult =
    | { kind: "found"; source: StructuralSource; stop: number; structure: StopStructure; skipped: string[] }
    | { kind: "none"; reasons: string[] };
  export function findChartStop(input: { candles: Candle[]; entry: number; atr: number; cutoffSec: number }): ChartStopResult;
  export interface StopContext { sessionDate: string; recent: Candle[]; levels: Levels | null }
  export function buildStopContext(candles: Candle[], cutoffSec: number): StopContext | null;
  ```

Rules, from spec §4.1–4.2:

- **Reading session.** Keep only finished bars. The reading session is the latest ET date that has
  finished **regular** bars (09:30–16:00 ET). Cut sessions with `splitSessions(finished, readingDate)`.
  Its `previous` is the PDL session.
- **Pivot.** A regular bar of the reading session whose low is strictly below the lows of the 2 bars
  before it and the 2 bars after it. The scan runs newest first. The first pivot with
  `low < entry` (spec §4.1) and `low - buffer > 0` wins. Then `stop = low - buffer` and
  `structure.barT` is that bar's `t`.
- **PDL.** The minimum low of `previous`. `barT` is the bar holding it. `stop = PDL - buffer` if valid.
- **Reasons (exact copy).** `skipped` and `reasons` collect these, in order:
  - no finished bars: `ไม่มีแท่ง 5 นาทีที่ปิดแล้ว`
  - no pivot qualifies: `ไม่มี swing low ใต้ราคาเข้าในกราฟ 5 นาทีวันที่ ${date}`
  - no previous session: `ไม่มีวันทำการก่อนหน้าในกราฟ 5 นาที จึงไม่มี PDL`
  - PDL stop not below entry: `PDL ${pdl.toFixed(2)} ลบระยะเผื่อแล้วไม่อยู่ใต้ราคาเข้า (มักเกิดจากเปิด gap ลง)`
- **Context.** `buildStopContext` returns:
  - the reading session's last `STOP_READING_BARS` finished regular bars
  - its date
  - `computeLevels(split).levels`, or `null` when `computeLevels` returns `{ error }`
  
  It returns `null` when there is no reading session.

Fixture hint:
- Build bars with a helper `bar(date, hh, mm, low, extra?)` that converts ET to epoch seconds.
- 2026-10-27 (Tue) and 2026-10-28 (Wed) are EDT, UTC−4, so 09:30 ET is 13:30Z.
- Default `o = h = c = low + 0.2`, `v = 1000`.
- Use `atr = 1`, `cutoffSec` far in the future unless the test is about the cutoff.

- [ ] **Step 1: Write the failing tests**

```ts
test("picks the most recent pivot low below the entry", () => {
  // 10-28 lows, 5-min apart from 09:30: [10.0, 9.9, 9.5, 9.8, 9.9, 9.7, 9.6, 9.8, 9.9, 10.0]
  // 10-27 has a full regular session with low 9.0
  const r = findChartStop({ candles, entry: 10.2, atr: 1, cutoffSec: FAR });
  assert.equal(r.kind, "found");
  assert.equal(r.source, "swing");
  assert.ok(Math.abs(r.stop - 9.5) < 1e-9);          // 9.6 - 0.1
  assert.equal(r.structure.level, 9.6);
  assert.equal(r.structure.sessionDate, "2026-10-28");
  assert.deepEqual(r.skipped, []);
});
test("skips a pivot whose low is not below the entry and takes the older one", () => {
  // same bars, entry 9.55: pivot 9.6 is not below 9.55, skipped; pivot 9.5 taken -> stop 9.4
  const r = findChartStop({ candles, entry: 9.55, atr: 1, cutoffSec: FAR });
  assert.ok(Math.abs(r.stop - 9.4) < 1e-9);
});
test("the last two bars are never pivots", ...);      // lows end [.., 9.9, 9.0, 9.5] -> 9.0 is not chosen
test("equal neighbouring lows are not a pivot", ...);  // [10, 9.9, 9.5, 9.5, 9.9, 10] -> source "pdl"
test("a bar ending after the cutoff is not read", ...);// the 2nd confirming bar ends after cutoffSec -> no swing
test("no swing low falls back to PDL with the reason", () => {
  // monotonic falling 10-28 lows (no pivot), entry 9.2, 10-27 low 9.0
  assert.equal(r.source, "pdl");
  assert.ok(Math.abs(r.stop - 8.9) < 1e-9);
  assert.deepEqual(r.skipped, ["ไม่มี swing low ใต้ราคาเข้าในกราฟ 5 นาทีวันที่ 2026-10-28"]);
});
test("PDL above the entry gives none with both reasons", ...); // entry 8.95 below 10-27 low 9.0
test("pre-market bars do not make a reading session", () => {
  // 10-27 + 10-28 regular, plus 10-29 08:00 ET bars only
  assert.equal(r.structure.sessionDate, "2026-10-28"); // and PDL session is 10-27
});
test("no previous session: swing still works, PDL reason when swing fails", ...);
test("no candles gives none with the no-bars reason", ...);
test("buildStopContext returns the last 48 regular bars, the date and levels", ...);
test("buildStopContext returns null with no reading session", ...);
```

- [ ] **Step 2: Run** `npm test -- --test-name-pattern="pivot|PDL|reading session|buildStopContext|cutoff"`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `src/lib/advisor/chartStop.ts`** to the interfaces and rules above.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(advisor): find a structural stop on 5-minute bars`.

---

### Task 2: Stop chain in `advise()`

**Files:**
- Modify:
  - `src/lib/advisor/types.ts` (`AdvisorInput`, `AdvisorCard`)
  - `src/lib/advisor/advise.ts:76-90`
  - `src/lib/advisor/critiqueContext.ts:106`
- Test:
  - `src/lib/advisor/advise.test.ts`
  - `src/lib/advisor/critiqueContext.test.ts`

**Interfaces:**
- Consumes: `findChartStop`, `ChartStopResult`, `StopStructure` (Task 1).
- Produces, on the types:
  ```ts
  // AdvisorInput
  intraday?: { candles: Candle[]; cutoffSec: number } | { error: string } | null;
  // AdvisorCard
  stopSource: "given" | "swing" | "pdl" | "atr";        // "chart" is renamed "given"
  stopNotes: string[];        // why earlier sources were skipped, in chain order
  stopFlags: string[];        // tight / wide copy from Global Constraints
  stopStructure: StopStructure | null;                  // set for swing and pdl only
  atrAlternative: { stop: number; atrMult: number; shares: number } | null; // null when stopSource === "atr"
  ```

Chain:
1. **Given.** A valid `stopOverride` gives `"given"`. An invalid one keeps today's warning, reworded
   to `Stop ที่ให้มา (${stopGiven}) ไม่ได้อยู่ใต้ราคาเข้า จึงหา stop จากกราฟแทน`, and the chain
   continues.
2. **Intraday.** `intraday` with candles goes to `findChartStop({ candles, entry, atr: atrValue,
   cutoffSec })`.
   - A `found` result gives its source, stop and structure, and `stopNotes = skipped`.
   - A `none` result sets `stopNotes = reasons`.
   - `{ error }` sets `stopNotes = ["ดึงกราฟ 5 นาทีไม่ได้: " + error]`.
   - Absent or null sets `stopNotes = []`, so no 5-minute read was attempted.
3. **ATR.** When the chain reaches ATR with any `stopNotes`, append `จึงใช้ 1.5×ATR`.
   `atrAlternative` uses `sizeShares` at `ADVISOR_ATR_SL_MULT * atrValue`.
4. **Flags.** Flags apply to every non-ATR source.

In `critiqueContext.ts`, the label per source reads:
- `given`: "stop given (chart-agent link or typed)"
- `swing`: "stop under a 5-minute swing low"
- `pdl`: "stop under the previous session low"
- `atr`: "ATR rule"

- [ ] **Step 1: Update the existing tests and write the new ones**

```ts
// existing: every "chart" expectation becomes "given"; the "above the entry" test now expects
// warnings to include "Stop ที่ให้มา (101) ไม่ได้อยู่ใต้ราคาเข้า จึงหา stop จากกราฟแทน"
test("a given stop wins over a swing low in the intraday bars", ...);           // stopSource "given", stopStructure null
test("no given stop: the swing low drives stop, size and stopAtrMult", ...);    // stop === found.stop, stopAtrMult === (entry-stop)/atr, atrAlternative.atrMult === 1.5
test("a typed entry below every pivot falls to PDL with the swing reason", ...); // stopSource "pdl", stopNotes[0] starts "ไม่มี swing low"
test("an intraday fetch error falls to ATR with the reason", () => {
  // intraday: { error: "timeout" }
  assert.equal(card.stopSource, "atr");
  assert.deepEqual(card.stopNotes, ["ดึงกราฟ 5 นาทีไม่ได้: timeout", "จึงใช้ 1.5×ATR"]);
  assert.equal(card.atrAlternative, null);
});
test("no intraday input keeps today's ATR card with no stop notes", ...);       // stopNotes [], stopFlags []
test("a stop under 0.5 ATR is flagged tight, never moved", ...);                // stopFlags ["แคบมาก โดน noise ง่าย"]
test("a stop over 3 ATR is flagged wide", ...);                                  // stopFlags ["กว้างมาก หุ้นที่ซื้อได้จะน้อย"]
// critiqueContext.test.ts: the "chart" card test uses "given"; add one asserting the swing label text
```

- [ ] **Step 2: Run** `npm test`. Expected: the new and renamed tests FAIL.
- [ ] **Step 3: Implement the types, the chain in `advise.ts` and the label in `critiqueContext.ts`.**
- [ ] **Step 4: Run** `npm test`. Expected: all pass. `npx tsc --noEmit` must be clean apart from
  `src/app/advisor/advisor-form.tsx`, whose `=== "chart"` checks Task 4 fixes; note them in the
  report.
- [ ] **Step 5: Commit** `feat(advisor): stop chain given -> swing -> PDL -> ATR`.

---

### Task 3: The AI stop reading (lib + route)

**Files:**
- Create: `src/lib/advisor/stopReading.ts` (pure)
- Test: `src/lib/advisor/stopReading.test.ts`
- Create: `src/lib/critic/stopReader.ts` (impure; mirrors `src/lib/critic/advisorCritic.ts`)
- Create: `src/app/api/advisor/stop-reading/route.ts` (mirrors `src/app/api/advisor/critique/route.ts`)

**Interfaces:**
- Consumes:
  - `AdvisorCard` (Task 2) and `StopContext` (Task 1)
  - `isChartPrediction` and `mockBackendNote` from `src/lib/chartAgent/review.ts`
  - `safeFailureReason` and `RAW_WITHHELD_REASON` from `src/lib/scanAgent/annotate.ts`
  - `aiBackend`, `aiOutageReason` and `callAgentJSON` from `src/lib/anthropic.ts`
- Produces:
  ```ts
  // stopReading.ts
  export type StopReadingStatus = "read" | "stripped" | "unread" | "skipped";
  export interface StopReading { status: StopReadingStatus; reading: string | null; concern: string | null; note: string | null; backend: string }
  export const STOP_READING_SYSTEM: string;
  export const STOP_READING_SCHEMA: object;  // { reading: string, concern: string } — "" = no concern
  export const SKIP_NOTE_ATR = "stop นี้ไม่ได้มาจากโครงกราฟ จึงไม่มีอะไรให้อ่าน";
  export const SKIP_NOTE_GIVEN = "stop นี้กำหนดมาเอง (จากป๊อปอัป agent กราฟหรือพิมพ์เอง) จึงไม่ได้ให้ AI อ่านซ้ำ";
  export const STRIPPED_NOTE = "คำอ่านของ AI ถูกตัดออก เพราะมีคำทำนายหรือคำแนะนำซื้อขาย";
  export function skipNoteFor(source: AdvisorCard["stopSource"]): string | null; // null for swing/pdl
  export function buildStopReadingPrompt(card: AdvisorCard, ctx: StopContext): string;
  export function normalizeStopReading(raw: unknown, backend: string): StopReading;
  // stopReader.ts — never throws
  export async function readStop(card: AdvisorCard, ctx: StopContext | null): Promise<StopReading>;
  ```

Rules:

- **The system prompt** is Thai. It asks for 2–4 sentences on what the stop sits under and how
  clean that structure is, for example:
  - one touch or several
  - a deep wick or a shallow dip
  - another level just below
  - how many bars old the pivot is
  
  It allows an optional one-line concern. It forbids:
  - predictions and probabilities
  - entry or exit calls
  - suggesting a different stop price
  - buy advice
  - the English words `isDirectional` strips
- **The prompt** carries:
  - ticker, entry, stop, source, `stopStructure` (level, bar time in ET, date)
  - ATR, `stopAtrMult`, `stopFlags`
  - the context levels (PDH, PDL, pVAL, pPOC, pVAH, when present)
  - the recent bars as compact ET-time OHLC lines
- **`normalizeStopReading`.**
  - A non-object, or a missing or blank `reading`, gives `unread` with note
    `AI ตอบกลับในรูปแบบที่อ่านไม่ได้`.
  - When `isChartPrediction` matches the reading or the concern, it gives `stripped`, both fields
    `null`, and `STRIPPED_NOTE`.
  - Otherwise it gives `read`, with `concern` set to `null` when the concern is `""`.
- **`readStop`.** `skipNoteFor` non-null, or a null `ctx`, gives `skipped`. A null `ctx` uses the
  note `ไม่มีแท่ง 5 นาทีให้ AI อ่าน`. A mock backend gives `unread` with
  `mockBackendNote(aiOutageReason())`. Otherwise it calls `callAgentJSON` with:
  - `tier: "sonnet"`
  - `label: "advisor-stop-reading"`
  - `maxTokens: 2000`
  - `jsonSchema: STOP_READING_SCHEMA`
  
  A catch gives `unread` with `safeFailureReason(err)`, logging the raw text server-side only, as
  `reviewSetups` does.
- **The route.** `POST {card, context}`, force-dynamic, `maxDuration = 300`. A shape check returns
  400 when:
  - `card.ticker` is not a string
  - `card.entry` or `card.stop` is not a finite number
  - `card.stopSource` is not a string
  
  `context` may be null. It returns `200` with the `StopReading`.

- [ ] **Step 1: Write the failing tests for the pure module**

```ts
test("skipNoteFor: atr and given are skipped, swing and pdl are read", ...); // SKIP_NOTE_ATR / SKIP_NOTE_GIVEN / null / null
test("a clean Thai reading is kept, an empty concern becomes null", ...);   // status "read", concern null
test("a reading with an English guard word is stripped", ...);              // e.g. "โครงนี้ bullish" -> "stripped", reading null, note STRIPPED_NOTE
test("a concern with a Thai prediction phrase strips the whole reading", ...); // use a phrase from CHART_PREDICTION_PHRASES_TH
test("malformed output is unread, never thrown", ...);                     // null, "x", { reading: "  " }
test("the prompt carries the stop, its structure and every context level", ...); // includes stop.toFixed(2), the level, "PDL"
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `stopReading.ts`, `stopReader.ts` and the route.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: all pass. TypeScript errors are
  allowed only in `advisor-form.tsx`, as in Task 2.
- [ ] **Step 5: Commit** `feat(advisor): AI reading of the chart stop`.

---

### Task 4: Wire the route and the card UI; STATE.md

**Files:**
- Modify:
  - `src/app/api/advisor/route.ts`
  - `src/app/advisor/advisor-form.tsx`
  - `src/app/advisor/page.tsx` (comment only, if it describes the stop)
  - `docs/STATE.md`
- Create: `src/app/advisor/advisor-stop-reading.tsx` (mirrors `advisor-critique.tsx`)

**Interfaces:**
- Consumes:
  - `findChartStop` / `buildStopContext` (Task 1)
  - the `AdvisorInput.intraday` and `AdvisorCard` fields (Task 2)
  - `StopReading` and `POST /api/advisor/stop-reading` (Task 3)
  - `fetchAlpacaCandlesBatch` and `SIP_DELAY_MS` from `src/lib/alpaca.ts`
- Produces: `/api/advisor` returns `{ ...result, chart, stopContext }`. `stopContext` is a
  `StopContext`, or null when `stopSource` is not `swing`/`pdl`.

Steps:

- [ ] **Step 1: Route.** Add `fetchAlpacaCandlesBatch([ticker], "5d", "5m")` to the existing
  `Promise.all`. It is fail-soft and resolves to `{ candles }` or `{ error: message }`, never a
  rejection.
  - Pass `intraday: { candles, cutoffSec }` or `{ error }` to `advise`, with
    `cutoffSec = nowSec - SIP_DELAY_MS / 1000` and the same `nowSec` the route already passes.
  - When the card's source is `swing`/`pdl`, return
    `stopContext = buildStopContext(candles, cutoffSec)`; otherwise return `null`.
  - Add a header comment line on why this fetch fails soft.
- [ ] **Step 2: Form.**
  - **Stop field.** It is always visible (drop the `initialStop !== "" || stop !== ""` condition), with
    the label `Stop (เว้นว่าง = หาจากกราฟ 5 นาที)`.
  - **Stop line.** One label per source:
    - `given`: `จุดตัดขาดทุน (กำหนดมาเอง)`
    - `swing`: `จุดตัดขาดทุน (ใต้ swing low กราฟ 5 นาที)`
    - `pdl`: `จุดตัดขาดทุน (ใต้ low ของวันก่อน)`
    - `atr`: today's ATR label
    
    The sub-line keeps `(${stopAtrMult.toFixed(2)}×ATR) · ห่าง $x`. For swing and pdl it adds the
    structure's date and ET time.
  - **Notes and flags.** Render `stopNotes` as one muted line joined by " · ". Render each of
    `stopFlags` as a warning badge.
  - **ATR comparison.** When `atrAlternative` is set, show
    `เทียบ stop แบบ 1.5×ATR: $stop · ซื้อได้ N หุ้น` with a button `ใช้ stop ATR แทน`. The button
    sets the stop field to `atrAlternative.stop.toFixed(2)` and resubmits the form, so the next card
    reads `given`.
  - Fix every remaining `=== "chart"` check.
- [ ] **Step 3: Reading block.** Create `advisor-stop-reading.tsx`, rendered under the stop line.
  - It fires once on mount behind the same Strict-Mode `firedRef` guard and the same `formEpoch`
    remount key as `AdvisorCritique`, with a manual re-run button.
  - It shows the status in Thai: the reading and concern, or the note. Errors are shown the way the
    critique block shows them.
  - It never blocks the card. It does not fire when `skipNoteFor(card.stopSource)` is non-null; it
    shows that note instead.
- [ ] **Step 4: Verify.** Run `npm test` and `npx tsc --noEmit`, then lint the touched files only.
  Then run `next build --webpack` and `next start` in the worktree on port 3275, and POST
  `/api/advisor` for one liquid ticker (e.g. `{"ticker":"AAPL"}`). Report:
  - the returned `stopSource`, `stopNotes` and `stopFlags`
  - whether `stopContext` is non-null
  
  This writes no DB rows. Do not start `next dev` with Bash.
- [ ] **Step 5: STATE.md.** Add a §3 entry for agent #3 on branch `chart-stop-agent`, unmerged: what
  it does, the chain, the rulings, and "no DB rows, no edge claim". Update the §1 `/advisor` bullet
  (the stop is now the chain) and the §1 "agents built" sentence. Add a §5 trap:
  `stopSource "chart"` was renamed `"given"`.
- [ ] **Step 6: Commit** `feat(advisor): chart stop on the card, AI reading block`.
