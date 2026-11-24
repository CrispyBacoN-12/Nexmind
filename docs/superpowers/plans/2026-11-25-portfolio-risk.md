# Local-only /portfolio + risk analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/portfolio` page, local to the owner's PC, that stores the owner's holdings in a
git-ignored file and analyses their risk on demand: weights, industries, move-together clusters,
beta / −10% scenario, and earnings ahead.

**Architecture:**
- Pure risk math lives in `src/lib/portfolioRisk/risk.ts`.
- A file store (`.local/holdings.json`) and a 1-call Finnhub profile helper sit beside it.
- An analysis builder with injected data sources and a pacer feeds two route groups:
  `/api/portfolio/holdings` and `/api/portfolio/analysis`.
- A client page renders the result.
- Every server entry point refuses when `process.env.VERCEL` is set.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before routes/pages), TypeScript,
node:test via `npx tsx --test`, Node `fs/promises`.

**Spec:** `docs/superpowers/specs/2026-11-25-portfolio-risk-design.md`

## Global Constraints

- **Privacy:**
  - The owner's holdings never go into a committed file: no tests, fixtures, docs or commit messages.
  - Tests use made-up tickers (`AAA`, `BBB`, …).
  - Stage files by path; never `git commit -a`; never commit `obsidian-vault/` or `.local/`.
- **Local-only guard:** `process.env.VERCEL` set → page shows "ใช้ได้เฉพาะบนเครื่อง", APIs 404 without reading the file.
- **No DB:** no Prisma reads or writes in this feature, no schema change, no cron, no Discord.
- **Finnhub:** at most 55 calls/min, paced inside the analysis request.
- **Thresholds from the spec:**
  - correlation edge `CORRELATION_ALERT_THRESHOLD` (0.75), 60-day `dateAlignedCorrelation`
  - beta: 252-day window, ≥ 120 shared days
  - scenario −10%
  - earnings window 0..14 days
  - flags: holding ≥ 0.20, industry ≥ 0.30 (never the ETF bucket), cluster ≥ 0.30
- **Copy:** Thai, neutral, no advice words ("ควรขาย", "ควรกระจาย", "rebalance").
- **Preview:** only via `preview_start {name: "nexmind-dev-web"}`.

## Review Focus

1. A holding with no price at all (quote and candles both missing) must be listed as unpriced and
   excluded from totals, without NaN anywhere. → Task 1 test
   `computeWeights: unpriced rows are excluded and listed`.
2. Every holding lacks beta (e.g. all new listings): the portfolio beta is null and the scenario shows
   0 counted, without dividing by zero. → Task 1 test `portfolioBeta: nothing measurable`.
3. The holdings file is missing or malformed on first run: read returns [] (missing) or a clear
   error (malformed) and never overwrites the bad file silently. → Task 2 test
   `readHoldings: malformed file is an error, not []`.
4. Upserting a ticker that exists keeps its cached `kind`/`industry` and updates shares/cost.
   → Task 2 test `upsertHolding: keeps cached profile`.
5. A 429 from Finnhub on one holding must not blank the analysis. → Task 3 test
   `buildPortfolioAnalysis: one failing source per holding is reported, rest renders`.

---

### Task 1: Pure risk math + ignore `.local/`

**Files:**
- Modify: `.gitignore` (append `/.local/`)
- Modify: `src/lib/portfolio/marketInputs.ts` (export the existing `returnsByDate`)
- Create: `src/lib/portfolioRisk/risk.ts`
- Test: `src/lib/portfolioRisk/risk.test.ts`

**Interfaces:**
- Consumes: `Candle` (`@/lib/indicators`); `returnsByDate(candles): Map<string, number>` (now exported).
- Produces:
  ```ts
  export const HOLDING_FLAG = 0.2, INDUSTRY_FLAG = 0.3, CLUSTER_FLAG = 0.3;
  export const BETA_WINDOW = 252, BETA_MIN_DAYS = 120, SCENARIO_SPY_MOVE = -0.1;
  export type HoldingKind = "stock" | "etf" | null;
  export interface PricedHolding { ticker: string; shares: number; avgCost: number; price: number | null; kind: HoldingKind; industry: string | null }
  export interface WeightRow { ticker: string; value: number; cost: number; pnl: number; pnlPct: number; weight: number; flagged: boolean; kind: HoldingKind; industry: string | null }
  export function computeWeights(rows: PricedHolding[]): { total: number; rows: WeightRow[]; top3Share: number; unpriced: string[] }
  export interface IndustryBucket { label: string; kind: "industry" | "etf" | "unknown"; value: number; weight: number; tickers: string[]; flagged: boolean }
  export function industryBuckets(rows: WeightRow[]): IndustryBucket[]          // sorted by value desc
  export function betaVsBenchmark(stock: Candle[] | null, bench: Candle[] | null, window?: number, minDays?: number): number | null
  export interface BetaInput { ticker: string; value: number; beta: number | null }
  export function portfolioBeta(rows: BetaInput[]): { beta: number | null; scenarioUsd: number; scenarioPct: number | null; excluded: string[]; excludedValue: number }
  export interface Cluster { members: string[]; weight: number; flagged: boolean; strongest: { a: string; b: string; r: number } }
  export function correlationClusters(tickers: string[], corr: (a: string, b: string) => number | null, weightOf: (t: string) => number, threshold?: number): Cluster[] // 2+ members, weight desc
  ```
  - Labels: industry bucket labels are the industry string, `"ETF / กองทุน"` (kind etf) and
    `"ยังไม่ทราบกลุ่ม"` (kind null).
  - `scenarioPct = scenarioUsd / (sum of all BetaInput values)`. It is null when that sum is 0.

- [ ] **Step 1: Write the failing tests** (`risk.test.ts`, made-up tickers only):
  - `computeWeights: value, P&L, weight, top3`: AAA 5 sh @ price 10, cost 8; BBB 3 @ 10, cost 12;
    CCC 2 @ 10, cost 10 → AAA value 50, pnl 10, pnlPct 0.25, weight 0.5, flagged true; BBB pnl −6;
    CCC weight 0.2, flagged true (≥ 0.20 inclusive); total 100; top3Share 1. A fourth row DDD 1 @ 1,
    cost 1 (total 101) → top3Share = 100/101.
  - `computeWeights: unpriced rows are excluded and listed`: price null → not in rows, in
    `unpriced`; totals finite.
  - `industryBuckets: groups, labels, ETF never flagged`: AAA Semiconductors 0.5, BBB Semiconductors
    0.1, CCC etf 0.35, DDD kind null 0.05 → buckets `[Semiconductors 0.6 flagged, ETF / กองทุน 0.35
    not flagged, ยังไม่ทราบกลุ่ม 0.05]`.
  - `betaVsBenchmark: exact 2x mover`: 200 daily candles, bench return alternating +1% / −1%,
    stock +2% / −2% on the same dates → ≈ 2 (±1e-9); 100 candles → null; null input → null.
  - `portfolioBeta: weighted, excluded listed`: AAA 100 β2, BBB 100 β0.5, CCC 50 null →
    beta 1.25, scenarioUsd −25, scenarioPct −0.1, excluded ["CCC"], excludedValue 50.
  - `portfolioBeta: nothing measurable`: all null → beta null, scenarioUsd 0, scenarioPct 0.
  - `correlationClusters: connected components at 0.75`: AAA-BBB 0.9, BBB-CCC 0.8, DDD-EEE 0.76,
    AAA-DDD 0.1, rest null; weights AAA .3 BBB .1 CCC .05 DDD .2 EEE .15 → `[{AAA,BBB,CCC} .45
    flagged, strongest AAA-BBB 0.9}, {DDD,EEE} .35 flagged]`; a pair at 0.74 is not an edge.
- [ ] **Step 2: Run** `npx tsx --test src/lib/portfolioRisk/risk.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `risk.ts` with the signatures above.
  - `betaVsBenchmark`: uses `returnsByDate` for both series, takes the last `window` shared dates,
    and computes cov / var(bench). It returns null when there are fewer than `minDays` dates or the
    bench has 0 variance.
  - Append `/.local/` to `.gitignore`. Export `returnsByDate`.
- [ ] **Step 4: Run** the test. Expected: all PASS.
- [ ] **Step 5: Commit**

  ```
  git add .gitignore src/lib/portfolio/marketInputs.ts src/lib/portfolioRisk/risk.ts src/lib/portfolioRisk/risk.test.ts
  git commit -m "feat(portfolio): pure risk math; ignore .local/"
  ```

### Task 2: Local holdings store + profile helper + guard

**Files:**
- Modify: `src/lib/portfolio/journalInput.ts` (export `TICKER_RE`)
- Create: `src/lib/portfolioRisk/store.ts`, `src/lib/portfolioRisk/profile.ts`, `src/lib/portfolioRisk/localOnly.ts`
- Test: `src/lib/portfolioRisk/store.test.ts`, `src/lib/portfolioRisk/profile.test.ts`

**Interfaces:**
- Consumes: `TICKER_RE`, `Parsed<T>` from `@/lib/portfolio/journalInput`; `HoldingKind` (Task 1).
- Produces:
  ```ts
  // store.ts
  export interface HoldingRow { ticker: string; shares: number; avgCost: number; note: string; kind: HoldingKind; industry: string | null; updatedAt: string }
  export const DEFAULT_HOLDINGS_PATH: string   // path.join(process.cwd(), ".local", "holdings.json")
  export function parseHoldingInput(body: Record<string, unknown>): Parsed<{ ticker: string; shares: number; avgCost: number; note: string }>
  export async function readHoldings(file?: string): Promise<HoldingRow[]>          // missing file → []; malformed → throws Error("holdings file is not valid JSON")
  export async function upsertHolding(input: { ticker: string; shares: number; avgCost: number; note: string }, file?: string, now?: Date): Promise<HoldingRow[]>
  export async function deleteHolding(ticker: string, file?: string): Promise<HoldingRow[]>
  export async function setProfiles(updates: { ticker: string; kind: HoldingKind; industry: string | null }[], file?: string): Promise<void>
  // profile.ts
  export async function fetchProfileKind(symbol: string, opts?: { fetchImpl?: typeof fetch; env?: { FINNHUB_API_KEY?: string } }): Promise<{ kind: HoldingKind; industry: string | null; note: string | null }>
  // localOnly.ts
  export function isDeployed(env?: Record<string, string | undefined>): boolean  // Boolean(env.VERCEL)
  ```
  Writes create the `.local` dir if needed and write the file atomically (write temp, rename).
  Rows are kept sorted by ticker.

- [ ] **Step 1: Write the failing tests.** Use a temp dir from `fs.mkdtemp(os.tmpdir())`, never `.local/`.
  - `parseHoldingInput`: `{ticker:" aaa ", shares:"2.5", avgCost:"10"}` → ok, AAA, 2.5, 10, note "";
    shares "0" / "-1" / "x" → not ok; avgCost "0" → not ok; ticker "not a ticker" → not ok.
  - `readHoldings: missing file → []`.
  - `readHoldings: malformed file is an error, not []`: file contents `{oops` → rejects; the file
    is unchanged afterwards.
  - `upsertHolding: adds then updates, sorted`: add BBB then AAA → order [AAA, BBB]; new rows have
    `kind: null, industry: null`.
  - `upsertHolding: keeps cached profile`: setProfiles BBB → stock / "Semiconductors"; upsert BBB
    with new shares → shares changed, kind / industry kept.
  - `deleteHolding` removes only that ticker; deleting an absent ticker is a no-op.
  - `fetchProfileKind`:
    - fake fetch `{}` → `{kind:"etf", industry:null, note:null}`
    - `{finnhubIndustry:"Semiconductors", name:"x"}` → stock / Semiconductors
    - `{name:"x"}` without an industry → stock / null
    - HTTP 429 → `{kind:null, industry:null, note:"Finnhub HTTP 429"}`
    - missing key → kind null with a note
    - a thrown fetch → kind null
    - the note never contains the key value
  - `isDeployed`: `{VERCEL:"1"}` → true; `{}` → false.
- [ ] **Step 2: Run** `npx tsx --test src/lib/portfolioRisk/store.test.ts src/lib/portfolioRisk/profile.test.ts`.
  Expected: FAIL, modules not found.
- [ ] **Step 3: Implement** the three modules. `fetchProfileKind` uses
  `https://finnhub.io/api/v1/stock/profile2?symbol=…&token=…` (1 call).
- [ ] **Step 4: Run** the tests. Expected: all PASS.
- [ ] **Step 5: Commit**

  ```
  git add src/lib/portfolio/journalInput.ts src/lib/portfolioRisk/store.ts src/lib/portfolioRisk/profile.ts src/lib/portfolioRisk/localOnly.ts src/lib/portfolioRisk/*.test.ts
  git commit -m "feat(portfolio): local holdings store, profile kind, deploy guard"
  ```

### Task 3: Analysis builder + routes

**Files:**
- Create: `src/lib/portfolioRisk/analysis.ts`, `src/app/api/portfolio/holdings/route.ts`, `src/app/api/portfolio/analysis/route.ts`
- Test: `src/lib/portfolioRisk/analysis.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–2.
  - `dateAlignedCorrelation`, `CORRELATION_WINDOW` (`@/lib/portfolio/marketInputs`)
  - `CORRELATION_ALERT_THRESHOLD` (`@/lib/riskSentry/correlationAlert`)
  - `worstGapDownPct` (`@/lib/hedge/math`)
  - `daysBetween` (`@/lib/advisor/earningsPhrase`)
  - `LiveQuote`, `EarningsInfo` (`@/lib/advisor/types`)
- Produces:
  ```ts
  export interface AnalysisDeps {
    liveQuote(t: string): Promise<LiveQuote>; earnings(t: string): Promise<EarningsInfo>;
    profile(t: string): Promise<{ kind: HoldingKind; industry: string | null; note: string | null }>;
    candles: Map<string, Candle[] | null>; spy: Candle[] | null; pace(): Promise<void>;
  }
  export interface AnalysisRow extends WeightRow { price: number; priceSource: "live" | "lastClose"; priceNote: string | null; beta: number | null }
  export interface PortfolioAnalysis {
    asOf: string; total: number; rows: AnalysisRow[]; top3Share: number; unpriced: string[];
    industries: IndustryBucket[]; clusters: Cluster[]; market: ReturnType<typeof portfolioBeta>;
    earnings: { ticker: string; date: string; hour: string | null; days: number; worstGapPct: number | null }[];
    missing: { ticker: string; what: "price" | "profile" | "earnings" | "beta"; reason: string }[];
    profileUpdates: { ticker: string; kind: HoldingKind; industry: string | null }[];
  }
  export function makePacer(perMinute: number, sleep?: (ms: number) => Promise<void>): () => Promise<void>
  export async function buildPortfolioAnalysis(holdings: HoldingRow[], deps: AnalysisDeps, todayNY: string): Promise<PortfolioAnalysis>
  ```
  Routes:
  - `GET/POST/DELETE /api/portfolio/holdings` → `{ ok, holdings }`.
    - POST body: `{ticker, shares, avgCost, note}`; DELETE takes `?ticker=`.
    - Validation errors return 400 `{ ok:false, error }`.
  - `GET /api/portfolio/analysis` → `{ ok, analysis }`.
  - All of them: `isDeployed()` → 404 `{ ok:false, error:"not found" }` before any file access.
  - All of them: `dynamic = "force-dynamic"`.

- [ ] **Step 1: Write the failing tests** with fake deps and `pace` as a no-op counter (made-up tickers):
  - `buildPortfolioAnalysis: end to end on fakes`:
    - AAA (stock, Semis), BBB (etf), CCC (kind null → profile returns stock / "Software").
    - Totals and weights match `computeWeights`.
    - `profileUpdates` = [CCC stock Software].
    - `earnings` is never called for BBB.
    - `pace` is called once before every quote, earnings and profile call.
  - `buildPortfolioAnalysis: falls back to last close`: the quote has a null price → priceSource
    "lastClose" with priceNote; no candles and no quote → in `unpriced` and in `missing` as "price".
  - `buildPortfolioAnalysis: earnings window`:
    - today `2026-11-25`; AAA reports `2026-12-03` → listed, days 8.
    - A report on `2026-12-20` → not listed.
    - A report on `2026-11-20` → not listed.
  - `buildPortfolioAnalysis: one failing source per holding is reported, rest renders`:
    - AAA's earnings throws "429" → `missing` has AAA earnings.
    - The other sections are present.
  - `makePacer: spaces calls`: with a fake sleep recording ms, 3 calls at 60/min → sleeps sum ≥ 2000.
- [ ] **Step 2: Run** `npx tsx --test src/lib/portfolioRisk/analysis.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `analysis.ts`:
  - Correlation pairs from `deps.candles` via `dateAlignedCorrelation(a, b, CORRELATION_WINDOW)`.
  - Beta via `betaVsBenchmark(candles, deps.spy)`.
  - Each data source is wrapped in try / catch, with reasons ≤ 80 chars.
- [ ] **Step 4: Run** the test. Expected: all PASS.
- [ ] **Step 5: Implement the routes** after reading the route-handler guide in `node_modules/next/dist/docs/`.
  - The analysis route reads the holdings and calls `fetchCandlesBatch([...tickers, "SPY"], "1y", "1d")`.
  - It builds the deps with `makePacer(55)`, `fetchLiveQuote`, `fetchNextEarnings` and `fetchProfileKind`.
  - `todayNY` = `toLocaleDateString("en-CA", { timeZone: "America/New_York" })`.
  - After the build it calls `setProfiles(analysis.profileUpdates)`.
- [ ] **Step 6: Run** `npm test` and `npx tsc --noEmit`. Expected: green, no type errors.
- [ ] **Step 7: Commit**

  ```
  git add src/lib/portfolioRisk/analysis.ts src/lib/portfolioRisk/analysis.test.ts src/app/api/portfolio
  git commit -m "feat(portfolio): analysis builder and local-only routes"
  ```

### Task 4: Page, sidebar link, seed, browser check

**Files:**
- Create: `src/app/portfolio/page.tsx` (server), `src/app/portfolio/portfolio-panel.tsx` (client)
- Modify: `src/components/sidebar.tsx` (prop `showPortfolio: boolean`, nav item `/portfolio` "Portfolio", lucide `PieChart`)
- Modify: `src/app/layout.tsx` (`<Sidebar showPortfolio={!process.env.VERCEL} />`)

**Interfaces:**
- Consumes: the route shapes from Task 3; `isDeployed` (Task 2); UI components from `@/components/ui`.

- [ ] **Step 1: Implement the page.**
  - `page.tsx`: `isDeployed()` → a `Card` saying "ใช้ได้เฉพาะบนเครื่อง"; otherwise the
    `PageHeader` and `PortfolioPanel`. Set `dynamic = "force-dynamic"`.
  - `PortfolioPanel` holdings table: ticker, shares (≤ 7 dp), cost/share, cost basis, note, delete.
  - `PortfolioPanel` add / edit form: ticker, shares, cost/share, note. It saves via POST.
  - Button "วิเคราะห์ความเสี่ยง" (busy: "กำลังวิเคราะห์ อาจใช้เวลาประมาณ 1 นาที…") renders:
    - (a) the weights table: value, P&L $ / %, weight, price source; flagged rows get `Badge tone="warning"`
    - (b) industry buckets
    - (c) clusters
    - (d) market: portfolio beta, "ถ้า S&P 500 ลง 10% พอร์ตน่าจะลงประมาณ X% (≈ $Y)", and
      "ไม่ได้นับ: …"; footer "ประมาณจากความผันผวนเทียบ SPY ย้อนหลัง 1 ปี ไม่ใช่การทำนาย"
    - (e) earnings in 14 days with worst gap
    - (f) the `missing` list
  - Section footer, verbatim: "ข้อมูลความเสี่ยงเท่านั้น ไม่ใช่คำแนะนำให้ซื้อหรือขาย"
- [ ] **Step 2: Sidebar + layout** as listed.
- [ ] **Step 3: Verify** `npx tsc --noEmit`, eslint on the touched paths, `npm test`. Expected: clean / green.
- [ ] **Step 4: Seed (Claude, not committed).** Write `.local/holdings.json` from the owner-confirmed
  list kept in the session scratchpad. Confirm `git status` does not list it.
- [ ] **Step 5: Browser check** with `preview_start {name:"nexmind-dev-web"}` → `/portfolio`:
  - 19 rows listed
  - run the analysis and confirm every section renders and the console is clean
  - take a screenshot
  - also confirm that `VERCEL=1` makes the APIs refuse (unit-tested via `isDeployed`)
- [ ] **Step 6: Commit**

  ```
  git add src/app/portfolio src/components/sidebar.tsx src/app/layout.tsx
  git commit -m "feat(portfolio): local-only /portfolio page"
  ```
