# Protective-put card on /journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "เช็กประกัน put" button on /journal that shows, for every open journal position, a few
protective-put contracts with their cost, over-hedge multiple, breakeven and max loss next to the
stop-only loss.

**Architecture:** Pure math in `src/lib/hedge/math.ts`; an Alpaca option-snapshot fetcher in
`src/lib/hedge/alpacaPuts.ts`; a card builder with injected data sources in `src/lib/hedge/card.ts`;
a thin read-only route `GET /api/journal/hedges`; a client section component rendered inside the
existing open-positions card of `journal-panel.tsx`.

**Tech Stack:** Next.js 16 route handlers (read `node_modules/next/dist/docs/` first), TypeScript,
node:test via `npx tsx --test`, Prisma 7 (read only), Alpaca options data v1beta1, Finnhub.

**Spec:** `docs/superpowers/specs/2026-11-25-journal-put-hedge-design.md`

## Global Constraints

- Branch `journal-put-hedge` from `master`. Do not commit `obsidian-vault/` (it has a local edit):
  stage files by path, never `git commit -a`.
- Read-only: no Prisma schema change, no writes, no cron (`vercel.json` stays `crons: []`).
- Never print, log or return `ALPACA_KEY` / `ALPACA_SECRET` / `FINNHUB_API_KEY`; error strings are
  short reasons (≤ 80 chars of upstream text).
- Option quotes: `https://data.alpaca.markets/v1beta1/options/snapshots/{TICKER}` with
  `feed=indicative&type=put`; headers `APCA-API-KEY-ID` / `APCA-API-SECRET-KEY`. Never `feed=opra`.
- Underlying price = `fetchLiveQuote` (Finnhub, `src/lib/market/quote.ts`); fallback = close of the
  newest daily bar from `fetchCandlesBatch(tickers, "1y", "1d")`.
- Earnings = `fetchNextEarnings` (`src/lib/market/earnings.ts`).
- Numbers pinned by the spec: earnings window 45 days; fallback expiry ≥ today + 30 days; expiry
  window = target … target + 21 days; strike targets stop, price × 0.95, price; strike cap
  |K − target| ≤ 0.03 × price; wide spread = bid missing/0 or (ask − bid)/ask > 0.30; stale quote
  > 4 days; gap needs ≥ 60 measurable sessions (`GAP_MIN_SESSIONS`); contracts = max(1, ceil(S/100)).
- Copy is Thai, neutral, never "buy"/"recommended"; no row is marked as the pick.
- Fixed footer copy (verbatim): "ราคา option เป็นราคาประมาณการจาก Alpaca (indicative) ไม่ใช่ราคาจริงที่
  โบรกเกอร์ · 1 สัญญา = 100 หุ้น · นี่เป็นข้อมูลความเสี่ยง ไม่ใช่คำแนะนำให้ซื้อ · เช็กก่อนว่าบัญชีโบรกเกอร์
  ของคุณเทรด option สหรัฐฯ ได้"
- Preview only via `.claude/launch.json` config `nexmind-dev-web` (`npm run dev:web`, port 3275);
  never start a dev server with Bash. The dev DB is the live Neon DB: read only.

## Review Focus

1. A position whose ticker has no options at all (ETF-like or BRK.B): the card says so; other cards
   render. → Task 3 test `buildHedgeCard: options error keeps the card`.
2. Finnhub live quote missing (key unset / outside data): falls back to last close with a note,
   never a blank price. → Task 3 test `buildHedgeCard: falls back to last close`.
3. Shares ≥ 100 (e.g. 250 → 3 contracts, ×1.2): the over-hedge warning must not shout "×1" for an
   exact 100. → Task 1 test `contractsFor and overHedge`.
4. An earnings date already in the past or today returned by the vendor: must not pick an expiry
   before today. → Task 1 test `chooseExpiryTarget: past earnings falls back`.
5. Alpaca returning more than one page: later pages are followed up to the cap, not silently
   dropped. → Task 2 test `fetchPutQuotes: follows next_page_token up to maxPages`.

---

### Task 1: Pure hedge math

**Files:**
- Create: `src/lib/hedge/types.ts`, `src/lib/hedge/math.ts`
- Test: `src/lib/hedge/math.test.ts`

**Interfaces:**
- Consumes: `EarningsInfo` from `@/lib/advisor/types`; `Candle` from `@/lib/indicators`
  (`t` epoch seconds, `o h l c`); `GAP_MIN_SESSIONS` from `@/lib/advisor/gapRisk`;
  `daysBetween(asOf, date): number | null` from `@/lib/advisor/earningsPhrase`.
- Produces (types.ts):
  ```ts
  export type StrikeTarget = "stop" | "minus5" | "atm";
  export interface PutQuote { symbol: string; expiry: string; strike: number; bid: number | null; ask: number | null; quotedAt: string | null }
  export interface StrikePick { strike: number; targets: StrikeTarget[] }
  export interface MissingTarget { target: StrikeTarget; reason: "priceBelowStop" | "noStrikeNear" }
  export interface RowMath { premiumTotal: number | null; premiumPct: number | null; breakeven: number | null; maxLossWithPut: number | null; distancePct: number; wideSpread: boolean }
  export interface StopOnly { atStop: number | null; gapPct: number | null; gapLoss: number | null; note: "stopNotBelowEntry" | "notEnoughHistory" | null }
  ```
- Produces (math.ts):
  - `parseOccSymbol(sym: string): { root: string; expiry: string; type: "P" | "C"; strike: number } | null`
  - `contractsFor(shares: number): number`; `overHedge(shares: number, contracts: number): number`
  - `chooseExpiryTarget(todayNY: string, earnings: EarningsInfo): { gte: string; reason: "afterEarnings" | "about30d" }`
  - `addDays(iso: string, n: number): string`
  - `pickExpiry(quotes: PutQuote[], gte: string): string | null`
  - `pickStrikes(strikes: number[], price: number, stop: number): { picks: StrikePick[]; missing: MissingTarget[] }`
  - `rowMath(a: { shares: number; entry: number; price: number; strike: number; contracts: number; bid: number | null; ask: number | null }): RowMath`
  - `worstGapDownPct(candles: Candle[] | null): number | null`
  - `stopOnly(a: { entry: number; stop: number; shares: number; price: number; gapPct: number | null }): StopOnly`
  - `isQuoteStale(quotedAt: string | null, nowMs: number): boolean`
  - constants `EARNINGS_WINDOW_DAYS = 45`, `FALLBACK_EXPIRY_DAYS = 30`, `EXPIRY_WINDOW_DAYS = 21`,
    `STRIKE_CAP_FRAC = 0.03`, `WIDE_SPREAD_FRAC = 0.3`, `STALE_QUOTE_MS = 4 * 86_400_000`

- [ ] **Step 1: Write the failing tests** in `src/lib/hedge/math.test.ts` (node:test + `assert/strict`):

```ts
test("parseOccSymbol", () => {
  assert.deepEqual(parseOccSymbol("AAPL261231P00240000"), { root: "AAPL", expiry: "2026-12-31", type: "P", strike: 240 });
  assert.deepEqual(parseOccSymbol("MSFT261205P00397500"), { root: "MSFT", expiry: "2026-12-05", type: "P", strike: 397.5 });
  assert.equal(parseOccSymbol("junk"), null);
});
test("contractsFor and overHedge", () => {
  assert.equal(contractsFor(20), 1); assert.equal(contractsFor(100), 1); assert.equal(contractsFor(250), 3);
  assert.equal(overHedge(20, 1), 5); assert.equal(overHedge(100, 1), 1); assert.equal(overHedge(250, 3), 1.2);
});
test("chooseExpiryTarget: earnings within 45 days → day after earnings", () => {
  assert.deepEqual(chooseExpiryTarget("2026-11-25", { date: "2026-12-03", hour: "amc" }), { gte: "2026-12-04", reason: "afterEarnings" });
});
test("chooseExpiryTarget: far, missing or past earnings → today + 30", () => {
  assert.deepEqual(chooseExpiryTarget("2026-11-25", { date: "2027-01-20", hour: null }), { gte: "2026-12-25", reason: "about30d" });
  assert.deepEqual(chooseExpiryTarget("2026-11-25", { date: null, hour: null, note: "x" }), { gte: "2026-12-25", reason: "about30d" });
});
test("chooseExpiryTarget: past earnings falls back", () => {
  assert.deepEqual(chooseExpiryTarget("2026-11-25", { date: "2026-11-20", hour: null }), { gte: "2026-12-25", reason: "about30d" });
});
test("pickExpiry: earliest expiry on or after gte", () => {
  const q = (expiry: string) => ({ symbol: "", expiry, strike: 1, bid: null, ask: null, quotedAt: null });
  assert.equal(pickExpiry([q("2026-12-11"), q("2026-12-04"), q("2026-12-03")], "2026-12-04"), "2026-12-04");
  assert.equal(pickExpiry([], "2026-12-04"), null);
});
test("pickStrikes: three targets, highest first", () => {
  assert.deepEqual(pickStrikes([390, 395, 397.5, 400, 410, 417.5, 420], 418.2, 395), {
    picks: [{ strike: 417.5, targets: ["atm"] }, { strike: 397.5, targets: ["minus5"] }, { strike: 395, targets: ["stop"] }],
    missing: [],
  });
});
test("pickStrikes: two targets on one strike are merged", () => {
  assert.deepEqual(pickStrikes([395, 420], 418.2, 397).picks, [{ strike: 420, targets: ["atm"] }, { strike: 395, targets: ["stop", "minus5"] }]);
});
test("pickStrikes: strike farther than 3% of price is missing", () => {
  const r = pickStrikes([300, 420], 418.2, 395);
  assert.deepEqual(r.missing, [{ target: "stop", reason: "noStrikeNear" }, { target: "minus5", reason: "noStrikeNear" }]);
});
test("pickStrikes: stop at or above price is skipped", () => {
  assert.deepEqual(pickStrikes([400, 417.5, 420], 418.2, 420).missing, [{ target: "stop", reason: "priceBelowStop" }]);
});
test("rowMath: 20 shares, one contract", () => {
  const r = rowMath({ shares: 20, entry: 410, price: 418.2, strike: 395, contracts: 1, bid: 1.6, ask: 1.85 });
  assert.equal(r.premiumTotal, 185);
  assert.ok(Math.abs(r.premiumPct! - 185 / 8364) < 1e-9);
  assert.equal(r.breakeven, 419.25);
  assert.equal(r.maxLossWithPut, 485);
  assert.ok(Math.abs(r.distancePct - (418.2 - 395) / 418.2) < 1e-9);
  assert.equal(r.wideSpread, false);
});
test("rowMath: no ask → no math; bid 0 → wide spread", () => {
  const none = rowMath({ shares: 20, entry: 410, price: 418.2, strike: 395, contracts: 1, bid: 1, ask: null });
  assert.equal(none.premiumTotal, null); assert.equal(none.breakeven, null); assert.equal(none.maxLossWithPut, null);
  assert.equal(rowMath({ shares: 20, entry: 410, price: 418.2, strike: 395, contracts: 1, bid: 0, ask: 1 }).wideSpread, true);
  assert.equal(rowMath({ shares: 20, entry: 410, price: 418.2, strike: 395, contracts: 1, bid: 0.6, ask: 1 }).wideSpread, true);
});
test("rowMath: strike above entry gives a loss below the premium", () => {
  assert.equal(rowMath({ shares: 20, entry: 400, price: 418.2, strike: 417.5, contracts: 1, bid: 5, ask: 6 }).maxLossWithPut, (400 - 417.5) * 20 + 600);
});
test("worstGapDownPct: needs 60 measurable sessions", () => {
  const bars = (n: number) => Array.from({ length: n }, (_, i) => ({ t: i * 86400, o: 100, h: 101, l: 99, c: 100, v: 1 }));
  const b = bars(61); b[30] = { ...b[30], o: 88 };
  assert.ok(Math.abs(worstGapDownPct(b)! - 0.12) < 1e-9);
  assert.equal(worstGapDownPct(bars(60)), null);
  assert.equal(worstGapDownPct(null), null);
});
test("stopOnly: fill at stop and worst gap", () => {
  const s = stopOnly({ entry: 410, stop: 395, shares: 20, price: 418.2, gapPct: 0.112 });
  assert.equal(s.atStop, 300);
  assert.ok(Math.abs(s.gapLoss! - (410 - 418.2 * 0.888) * 20) < 1e-9);
  assert.equal(s.note, null);
  assert.deepEqual(stopOnly({ entry: 410, stop: 410, shares: 20, price: 418.2, gapPct: 0.1 }), { atStop: null, gapPct: 0.1, gapLoss: null, note: "stopNotBelowEntry" });
  assert.equal(stopOnly({ entry: 410, stop: 395, shares: 20, price: 418.2, gapPct: null }).note, "notEnoughHistory");
});
test("isQuoteStale: more than 4 days", () => {
  const now = Date.parse("2026-11-25T00:00:00Z");
  assert.equal(isQuoteStale("2026-11-24T18:47:01Z", now), false);
  assert.equal(isQuoteStale("2026-11-20T18:47:01Z", now), true);
  assert.equal(isQuoteStale(null, now), true);
});
```

(Use the `Candle` field names actually exported by `@/lib/indicators`; adjust the fixture's keys
if `v` is not a field.)

- [ ] **Step 2: Run** `npx tsx --test src/lib/hedge/math.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `types.ts` and `math.ts`** with the signatures above.
  - `pickStrikes`: nearest listed strike per target (ties → the lower strike); a target whose stop
    ≥ price → `priceBelowStop`; |K − target| > 0.03 × price → `noStrikeNear`; merge picks sharing a
    strike keeping target order `stop, minus5, atm`; picks sorted by strike descending; `missing`
    ordered `stop, minus5, atm`.
  - `rowMath`: spec §"Per row"; premium uses ask × 100 × contracts; null math when ask is null or ≤ 0.
  - `worstGapDownPct`: max over t ≥ 1 of `max(0, (c[t-1] − o[t]) / c[t-1])`, counting only bars
    with finite positive prev close and open; null if count < `GAP_MIN_SESSIONS` (60).
  - `stopOnly`: `stopNotBelowEntry` takes precedence over `notEnoughHistory`.
  - `chooseExpiryTarget`: `daysBetween(todayNY, date)` in 1..45 → `afterEarnings` with
    gte = date + 1 day; anything else → `about30d` with gte = today + 30.

- [ ] **Step 4: Run** `npx tsx --test src/lib/hedge/math.test.ts` — Expected: all PASS.

- [ ] **Step 5: Commit** `git add src/lib/hedge/types.ts src/lib/hedge/math.ts src/lib/hedge/math.test.ts && git commit -m "feat(hedge): pure protective-put math"`

### Task 2: Alpaca put-snapshot fetcher

**Files:**
- Create: `src/lib/hedge/alpacaPuts.ts`
- Test: `src/lib/hedge/alpacaPuts.test.ts`

**Interfaces:**
- Consumes: `PutQuote` (Task 1), `parseOccSymbol` (Task 1).
- Produces:
  ```ts
  export interface PutWindow { expGte: string; expLte: string; strikeGte: number; strikeLte: number }
  export type PutQuotesResult = { quotes: PutQuote[] } | { error: string };
  export async function fetchPutQuotes(ticker: string, w: PutWindow, opts?: {
    fetchImpl?: typeof fetch; env?: { ALPACA_KEY?: string; ALPACA_SECRET?: string }; maxPages?: number;
  }): Promise<PutQuotesResult>   // never throws; maxPages default 5
  ```

- [ ] **Step 1: Write the failing tests** with a fake `fetchImpl` that records URLs and returns
  canned JSON `{ snapshots: { [sym]: { latestQuote: { ap, bp, t } } }, next_page_token }`:
  - `fetchPutQuotes: maps snapshots` — one page with `AAPL261231P00240000` `{ap: 0.12, bp: 0.01, t: "2026-11-24T18:47:01Z"}`
    → `{ quotes: [{ symbol: "AAPL261231P00240000", expiry: "2026-12-31", strike: 240, bid: 0.01, ask: 0.12, quotedAt: "2026-11-24T18:47:01Z" }] }`;
    the recorded URL contains `feed=indicative`, `type=put`, `expiration_date_gte=`, `expiration_date_lte=`,
    `strike_price_gte=`, `strike_price_lte=`, `limit=1000`, and does not contain `opra`.
  - `fetchPutQuotes: ap 0 or missing → ask null; bp 0 → bid 0` (kept as 0 so rowMath flags the spread).
  - `fetchPutQuotes: follows next_page_token up to maxPages` — pages always return a token; with
    `maxPages: 3` exactly 3 calls are made and the second URL carries `page_token=`.
  - `fetchPutQuotes: HTTP 403 → error without secrets` — result `{ error: "Alpaca options HTTP 403" }`;
    with env `{ ALPACA_KEY: "k-secret", ALPACA_SECRET: "s-secret" }`, `JSON.stringify(result)` contains neither value.
  - `fetchPutQuotes: missing keys → error, no fetch` — `{ error: "ALPACA_KEY/ALPACA_SECRET not set" }`, fake fetch never called.
  - `fetchPutQuotes: thrown fetch → error` — message starts with `"option quotes fetch failed"` and is ≤ 120 chars.
  - `fetchPutQuotes: unparseable symbol skipped`.

- [ ] **Step 2: Run** `npx tsx --test src/lib/hedge/alpacaPuts.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `fetchPutQuotes`** (`env` defaults to `process.env`, `fetchImpl` to global
  `fetch`; ticker URL-encoded and upper-cased; strikes formatted with `toFixed(2)`).

- [ ] **Step 4: Run** the test file — Expected: all PASS.

- [ ] **Step 5: Commit** `git add src/lib/hedge/alpacaPuts.ts src/lib/hedge/alpacaPuts.test.ts && git commit -m "feat(hedge): Alpaca indicative put snapshots"`

### Task 3: Card builder + `GET /api/journal/hedges`

**Files:**
- Create: `src/lib/hedge/card.ts`, `src/app/api/journal/hedges/route.ts`
- Test: `src/lib/hedge/card.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–2; `LiveQuote`, `EarningsInfo` from `@/lib/advisor/types`;
  `fetchLiveQuote` (`@/lib/market/quote`), `fetchNextEarnings` (`@/lib/market/earnings`),
  `fetchCandlesBatch` (`@/lib/marketData`).
- Produces:
  ```ts
  export interface HedgePosition { id: number; ticker: string; shares: number; entryPrice: number; stop: number }
  export interface HedgeRow extends StrikePick, RowMath { bid: number | null; ask: number | null; quotedAt: string | null; stale: boolean }
  export interface HedgeCard {
    id: number; ticker: string; shares: number; entryPrice: number; stop: number;
    price: number | null; priceSource: "live" | "lastClose" | null; priceAt: string | null; priceNote: string | null;
    earnings: EarningsInfo; expiry: string | null; expiryReason: "afterEarnings" | "about30d" | null;
    contracts: number; overHedge: number; rows: HedgeRow[]; missing: MissingTarget[];
    stopOnly: StopOnly | null; optionsError: string | null;
  }
  export interface HedgeDeps {
    liveQuote(t: string): Promise<LiveQuote>; earnings(t: string): Promise<EarningsInfo>;
    putQuotes(t: string, w: PutWindow): Promise<PutQuotesResult>; candles: Candle[] | null;
  }
  export async function buildHedgeCard(p: HedgePosition, deps: HedgeDeps, todayNY: string, nowMs: number): Promise<HedgeCard>
  ```
  Route response: `{ ok: true, asOf: string /* todayNY */, cards: HedgeCard[] }` or
  `{ ok: false, error: string }` with status 500.

- [ ] **Step 1: Write the failing tests** in `card.test.ts` with fake deps (no network):
  - `buildHedgeCard: full card` — position `{id:1, ticker:"MSFT", shares:20, entryPrice:410, stop:395}`,
    live 418.2, earnings `2026-12-03`, puts at expiry 2026-12-04 strikes 395/397.5/417.5 and at
    2026-12-11 strike 395; todayNY `2026-11-25` → `expiry "2026-12-04"`, `expiryReason "afterEarnings"`,
    3 rows (only 2026-12-04 strikes), `contracts 1`, `overHedge 5`, `priceSource "live"`; the window passed
    to `putQuotes` has `expGte "2026-12-04"`, `expLte "2026-12-25"`.
  - `buildHedgeCard: falls back to last close` — live `{price:null, at:null, note:"FINNHUB_API_KEY not set"}`,
    candles' last close 400 → `price 400`, `priceSource "lastClose"`, `priceNote` contains the note.
  - `buildHedgeCard: no price at all` — live null and candles null → `price null`, `rows []`, `putQuotes` never called.
  - `buildHedgeCard: options error keeps the card` — putQuotes `{error:"Alpaca options HTTP 404"}` →
    `optionsError` equals it, `rows []`, `stopOnly` still computed.
  - `buildHedgeCard: no expiry in window` — putQuotes `{quotes: []}` → `expiry null`, `rows []`, `optionsError null`.

- [ ] **Step 2: Run** `npx tsx --test src/lib/hedge/card.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `buildHedgeCard`.** Strike window: `strikeGte = max(0, min(stop < price ? stop : price*0.95, price*0.95) − 0.03*price)`,
  `strikeLte = price * 1.03`; expiry window `expGte = target.gte`, `expLte = addDays(gte, 21)`.
  `priceAt` is ISO from `LiveQuote.at` (seconds) or the last candle's `t`. `stale` via `isQuoteStale(quotedAt, nowMs)`.

- [ ] **Step 4: Run** the card test — Expected: all PASS.

- [ ] **Step 5: Implement the route** `src/app/api/journal/hedges/route.ts` after reading the
  route-handler guide in `node_modules/next/dist/docs/`. Mirror `src/app/api/journal/stops/route.ts`:
  `dynamic = "force-dynamic"`, `maxDuration = 60`; read open rows with
  `prisma.journalTrade.findMany({ where: { exitDate: null }, select: { id, ticker, shares, entryPrice, stop }, orderBy: { id: "asc" } })`;
  one `fetchCandlesBatch(uniqueTickers, "1y", "1d")`; per-ticker memoized `fetchLiveQuote`,
  `fetchNextEarnings`, `fetchPutQuotes` so rows sharing a ticker reuse one fetch; positions processed
  sequentially; `todayNY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })`;
  catch → `{ ok: false, error: String(e).slice(0, 80) }` status 500. No positions → `{ ok: true, asOf, cards: [] }`.

- [ ] **Step 6: Run** `npm test` and `npx tsc --noEmit` — Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit** `git add src/lib/hedge/card.ts src/lib/hedge/card.test.ts src/app/api/journal/hedges/route.ts && git commit -m "feat(hedge): card builder and /api/journal/hedges"`

### Task 4: "เช็กประกัน put" section on /journal

**Files:**
- Create: `src/app/journal/hedge-section.tsx`
- Modify: `src/app/journal/journal-panel.tsx` (inside the "สถานะที่ถืออยู่" `Card`, after the open-positions `</table></div>` block, around line 309)

**Interfaces:**
- Consumes: `HedgeCard` type (Task 3), route response shape (Task 3); `Badge`, `Button`, `Card`
  from `@/components/ui`; `fmtMoney`, `fmtNumber` from `@/lib/utils`.
- Produces: `export function HedgeSection({ openCount }: { openCount: number })` (client component).

- [ ] **Step 1: Implement `HedgeSection`.** Renders nothing when `openCount === 0`. A button
  "เช็กประกัน put" (busy text "กำลังดึงราคา put…") fetches `/api/journal/hedges` only on click. Per card,
  following the spec sketch:
  - header: ticker · shares หุ้น · ทุน · stop · ราคาตอนนี้ + time in ICT (`Asia/Bangkok`), or the
    last-close fallback note.
  - earnings line via `earningsPhrase` from `@/lib/advisor/earningsPhrase` + expiry with label
    "หมดอายุหลังประกาศงบ" / "ประมาณ 30 วัน"; `expiry null` → "ไม่มีงวดหมดอายุที่เหมาะในช่วงนี้".
  - `overHedge > 1` → `Badge tone="warning"`: "1 สัญญาคุม 100 หุ้น แต่ถือ {shares} → คุมเกิน ×{overHedge ≤ 2 dp}"
    (for N contracts: "{N} สัญญาคุม {100N} หุ้น …").
  - table columns: strike (+ target labels "stop", "−5%", "ราคาตอนนี้" and "ต่ำกว่าราคา x%"),
    bid / ask, ค่าเบี้ยรวม, % ของมูลค่าหุ้น, คุ้มทุน, ขาดทุนสูงสุดถ้ามี put; `ask null` → "ไม่มีราคาเสนอขาย";
    `wideSpread` → `Badge tone="warning"` "spread กว้าง"; `stale` → `Badge` "ราคาเก่า".
  - missing lines: `priceBelowStop` → "ราคาอยู่ต่ำกว่า stop แล้ว"; `noStrikeNear` → "ไม่มี strike ใกล้ {label}".
  - stop-only line: "stop อย่างเดียว: ขาดทุน {atStop} ถ้า fill ที่ stop · {gapLoss} ถ้าเปิดกระโดดลงแรงเท่าครั้งที่แย่ที่สุดในรอบปี (−{gapPct}%)";
    notes: `stopNotBelowEntry` → "stop ไม่ได้อยู่ต่ำกว่าราคาทุน", `notEnoughHistory` → "ข้อมูลราคาย้อนหลังไม่พอคำนวณกรณีกระโดด".
  - `optionsError` → amber line "ดึงราคา option ไม่ได้: {optionsError}".
  - the fixed footer copy from Global Constraints, verbatim, in `text-(--color-muted)`.
  - request failure → amber "เช็กประกัน put ไม่สำเร็จ: {error}".

- [ ] **Step 2: Mount it** in `journal-panel.tsx`: `<HedgeSection openCount={data?.open.length ?? 0} />`
  as the last child of the open-positions `Card`.

- [ ] **Step 3: Verify** `npx tsc --noEmit` and `npm run lint` (if the script exists) — Expected: clean.

- [ ] **Step 4: Verify in the browser** with `preview_start {name: "nexmind-dev-web"}` → `/journal`.
  If the journal has 0 open rows, confirm the section is hidden and call
  `GET /api/journal/hedges` directly (expect `{ ok: true, cards: [] }`); do not write journal rows to
  the live DB to test. Check console/network for errors; screenshot.

- [ ] **Step 5: Commit** `git add src/app/journal/hedge-section.tsx src/app/journal/journal-panel.tsx && git commit -m "feat(journal): protective-put check per open position"`
