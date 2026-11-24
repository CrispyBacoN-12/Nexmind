# /portfolio: local-only holdings + risk analysis: design

- Date: 2026-11-25. Status: draft, awaiting owner approval.
- Owner's words: "เริ่มจากการทำ portfolio ขึ้นมาก่อนเพื่อจะรู้ว่าตอนนี้ถือหุ้นอะไรบ้าง";
  "ต้องการซ้ำเพราะจะได้เอามาวิเคราะห์ด้วย". Picks:
  - analysis **1 (portfolio risk)**
  - build **approach 1 (new /portfolio page, separate from /journal)**
  - privacy **3 (local only, never on the public site)**

## Intent

The owner's real US holdings live in a broker app (Dime!): about 19 names, almost all fractional,
with cost per share but no remembered trade history. The app already shows value and P&L. The owner
wants a copy inside NEXMIND so NEXMIND can analyse the portfolio's **risk**, which the broker app
does not show: concentration, names that move together, sensitivity to a market drop, and earnings
coming up.

Risk display only, like the rest of the copilot (`ADVISOR_NO_EDGE_CLAIM`). It never says buy, sell,
trim or "rebalance to X".

## Goals

1. A `/portfolio` page with a holdings table: ticker, shares (fractional), avg cost per share, note.
   Add / edit / delete rows in the page.
2. A "วิเคราะห์ความเสี่ยง" button that computes, on demand:
   1. **Weights:** each holding's % of portfolio value, and the top-3 share. Also shown per holding:
      value, cost basis, unrealized P&L.
   2. **Industry concentration:** value by Finnhub industry (e.g. "Semiconductors"). This is
      deliberately *not* the 11 GICS sectors, which lump NVDA / MSFT / PLTR / CRWD into one bucket.
   3. **Move-together clusters:** groups of holdings whose 60-day daily-return correlation is
      ≥ 0.75. That is the same function and threshold as Risk Sentry: `dateAlignedCorrelation`,
      `CORRELATION_ALERT_THRESHOLD`. Each cluster is shown with its combined weight.
   4. **Market-drop sensitivity:** each holding's beta to SPY over 1 year of daily returns, the
      value-weighted portfolio beta, and "if SPY falls 10%, the portfolio falls about X% (≈ $Y)".
      The card states that this is an estimate from the past year, not a forecast.
   5. **Earnings ahead:** holdings reporting within 14 calendar days, with their worst overnight
      gap-down of the last year.
3. Works only on the owner's PC (`npm run dev:web`). The deployed site never shows or serves holdings.

## Non-goals

- Performance vs a benchmark. It needs trade dates the owner does not have.
- AI commentary. Possible later, fed by these numbers.
- Feeding holdings into Risk Sentry or the put card. Possible later.
- Thai stocks, options, cash.
- Any recommendation, target weight or rebalancing suggestion.

## Anti-goals

- Holdings reachable from the public site (`nexmind-gamma.vercel.app`) or committed to the public repo.
- A number that looks precise when its input is missing. Examples: a holding with too little history
  for beta is silently treated as beta 1, or an ETF is silently put in an "Other" industry. Missing
  inputs are shown as missing, with the reason.
- Wording that reads as advice, e.g. "you should diversify".

## Approaches considered

1. **New /portfolio page with its own store (picked).** Keeps long-term holdings out of /journal,
   whose rows carry stops and count against /advisor's slots.
2. **"Long-term" rows inside /journal.** Rejected: every reader of journal rows would have to filter
   them out (advisor slots, stop check, R). One miss blocks new trades.
3. **One settings list (like Risk Sentry's manual extras).** Rejected: no per-row editing, no
   per-row timestamp.

## Storage (Claude's call: a local file, not the database)

The owner chose local-only. The Neon DB is shared with the public site, so holdings are kept out
of it entirely.
- **File:** `.local/holdings.json` at the repo root. The `.local/` directory is added to
  `.gitignore`. Shape:
  `{ "holdings": [{ "ticker", "shares", "avgCost", "note", "industry", "updatedAt" }] }`
- `industry` is cached in the file when a row is added (Finnhub `profile2` via `fetchFundamentals`),
  so an analysis run does not re-fetch 19 profiles. A row whose fetch failed stores `industry: null`;
  the next analysis retries it and writes back what it gets.
- ETFs and funds get no industry from Finnhub (VOO, JEPQ). They are shown as **"ETF / กองทุน"**, not
  merged into a stock industry, and listed as such.
- **Initial 19 rows:** Claude writes the file once from the owner's screenshots, already confirmed in
  chat. The file is never committed.

## Local-only guard

- The page, the holdings API and the analysis API all refuse when `process.env.VERCEL` is set
  (Vercel sets it at build and runtime). The page shows "ใช้ได้เฉพาะบนเครื่อง"; the APIs return 404
  without reading the file.
- On Vercel the file also does not exist and the filesystem is read-only. The guard is the primary
  defense; the missing file is a second one.
- The sidebar shows the "Portfolio" link only in development (`process.env.NODE_ENV === "development"`).

## Data and rules

- **Prices:** `fetchCandlesBatch([...tickers, "SPY"], "1y", "1d")` for beta, correlation and gaps.
  The current price comes from `fetchLiveQuote`, falling back to the newest daily close with a note,
  the same rule as the put card.
- **Beta:**
  - Formula: cov(r_i, r_SPY) / var(r_SPY) on date-aligned daily returns over the last 252 shared
    days. Needs ≥ 120 shared days; otherwise null with "ประวัติราคาไม่พอ" (e.g. a recent IPO).
  - Portfolio beta: value-weighted over the holdings that have one. The excluded holdings and their
    combined weight are printed next to the number.
  - −10% scenario: Σ value_i × β_i × −0.10 over holdings with beta. The excluded value is printed
    separately as "ไม่ได้นับ".
- **Clusters:**
  - Pairwise `dateAlignedCorrelation` (60-day).
  - Clusters are connected components of the graph whose edges have r ≥ 0.75. Only clusters of 2+
    are shown, each with members, combined weight and the strongest pair's r.
  - Pairs with null correlation are not edges.
- **Display flags:** neutral colour only, no advice text.
  - a single holding ≥ 20% of the portfolio
  - a single industry ≥ 30%
  - a cluster ≥ 30%
- **Earnings:**
  - `fetchNextEarnings` for each non-ETF holding; show those with a date 0..14 days ahead.
  - Worst gap: `worstGapDownPct` from `src/lib/hedge/math.ts` (1y, null under 60 sessions).
- **Rate limit:** Finnhub's free tier is 60 calls/min. One run makes about 2 calls per holding
  (quote + earnings) plus industry backfills. Calls are made with limited concurrency and must stay
  under 55/min. If a call is refused (429), that holding's item shows "ดึงข้อมูลไม่ได้" and the rest
  of the analysis still renders.

## Surface

- `GET/POST/DELETE /api/portfolio/holdings`: read, upsert by ticker, delete by ticker. Validation:
  - ticker: the journal's ticker regex
  - shares: > 0
  - avgCost: > 0
  - note: optional
- `GET /api/portfolio/analysis`: reads the file, fetches, returns the five sections plus `asOf`.
  Read-only.
- `/portfolio` page (client) with three parts:
  - the holdings table and form
  - the analysis button
  - one card per analysis section
  - Thai copy in /journal's style.

## Constraints

- Next.js 16 in this repo has breaking changes: read `node_modules/next/dist/docs/` before writing
  routes and pages.
- Tests: node:test via `npx tsx --test`. Write the pure analysis functions first (TDD), then fake
  the data sources.
- No DB schema change, no Prisma writes, no cron, no Discord.
- The owner's holdings must never appear in a committed file: not in tests, fixtures, docs or commit
  messages. Tests use made-up tickers or weights.
- Branch from master.

## Calls made after the builder check (Claude's calls)

1. **Seeding the 19 rows is a Claude step, outside the repo.** At execution time Claude copies the
   confirmed list from its session scratchpad into `.local/holdings.json`. It is not a plan task with
   committed data. The add form handles one row at a time; a bulk import is not built.
2. **ETF vs unknown.**
   - Each row stores `kind: "stock" | "etf" | null`. A new profile-only helper decides it: one
     Finnhub `profile2` call, not `fetchFundamentals`, which makes 2 calls.
   - Verified 2026-11-25: Finnhub answers HTTP 200 with an **empty object** for VOO and JEPQ, and
     14 fields with `finnhubIndustry` for NVDA and ANT.
   - Empty object → `kind: "etf"`, `industry: null`. Non-empty → `kind: "stock"` plus its industry.
   - HTTP error, 429 or a thrown fetch → `kind: null`, retried on the next run.
   - ETFs skip the earnings fetch.
3. **ETFs in the numbers.**
   - ETFs count in weights, top-3, beta, clusters and the −10% scenario, since they have candles.
   - The "ETF / กองทุน" bucket is listed in the industry table but **never flagged** by the 30%
     industry flag: a fund is diversification, not concentration.
   - A row with `kind: null` is listed as "ยังไม่ทราบกลุ่ม".
4. **Finnhub budget.**
   - One analysis run calls, per holding: quote (1), earnings (1, stocks only) and a profile backfill
     (1, only when `kind` is null).
   - The calls are paced to at most 55/min in one request. The route takes as long as it needs: it runs
     only locally, where there is no serverless timeout.
   - The page shows "กำลังวิเคราะห์ อาจใช้เวลาประมาณ 1 นาที".
5. **One price snapshot.** Each row has one price, the live quote or the last-close fallback with a
   label. Weights, P&L and the −10% scenario all use it.
6. **What "local" means.** The guard is `process.env.VERCEL` everywhere, not `NODE_ENV`.
   - The sidebar is a client component, so the root layout (server) passes a boolean
     `showPortfolio = !process.env.VERCEL` to it.
   - `next start` on the PC therefore also shows the link.
7. **Next behaviour.** The routes and the page data are `dynamic = "force-dynamic"`. `.local/` is added
   to `.gitignore` in the first task, before any file is written there.
8. **Tickers.**
   - The journal's `TICKER_RE` in `src/lib/portfolio/journalInput.ts` is exported and reused.
   - Symbols are stored as typed and upper-cased. A provider that cannot resolve one shows that
     item as missing; there is no per-provider alias table.

## Left to the builder

- File locking: there is one user and one process, so read-modify-write per request is enough.
- Concurrency mechanism for the Finnhub calls.
- Card layout within /journal's existing components.
- Where the pure functions live (suggested: `src/lib/portfolioRisk/`).
