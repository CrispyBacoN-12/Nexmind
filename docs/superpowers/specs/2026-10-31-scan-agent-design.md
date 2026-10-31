# Scan agent (agent #1): design

**Date:** 2026-10-31 · **Status:** draft, awaiting owner approval (builder check done, universe answered)
**Owner's words are marked (owner). Everything else is the designer's call and is marked (call).**

## 1. Intent

The owner wants to rebuild NEXMIND's AI agents one at a time, starting with a scanner. Each
trading day they want to open a page, press **"สแกนตอนนี้" (scan now)**, and see a list of US stocks
worth looking at for a **day trade** (bought and sold the same session) (owner).

The scan is the **wide first pass** of a funnel (owner): it returns *dozens* of names, and a later
agent (not designed here) narrows them to a few. The owner picks from that, sends one to `/advisor`
for the stop and the share count, and places the order by hand on Webull.

Filtering uses **news and indicators** (owner). The news that matters to the owner is: important
company news, economic data releases, and earnings (owner). On indicators the owner said "let the
agent analyse" (owner), so the indicator set below is the designer's call.

The list is sorted by **how much is happening to the stock today**, not by how likely it is to
rise (owner confirmed this reading). This matters because nothing in this project has ever beaten a
random entry (docs/STATE.md §3); the page must never imply it picks winners.

## 2. Goals

1. A new page in the NEXMIND web app with a "scan now" button. No schedule; it runs when pressed
   (owner).
2. One press returns a ranked table of dozens of liquid US stocks that have something happening
   today, each with its numbers, its news tags and a short AI-written summary.
3. Each row links to `/advisor` with the ticker filled in.
4. A banner at the top names the day's scheduled US economic releases (CPI, jobs, FOMC and so on)
   with their Thai time, because they move the whole market (call).
5. Runs in seconds to about a minute. The owner presses it right before trading.

## 3. Non-goals

- **No buy/sell call, no prediction, no "best pick".** The AI summarises what is happening; it does
  not say whether to trade (call, based on the HAWK/SAGE history: the old AI analysts vetoed almost
  everything and were never shown to beat random).
- **No sentiment score on news.** No free point-in-time sentiment source exists (STATE.md, 09-14),
  so the page reports *that* there is news and *what kind*, not whether it is good (call).
- No narrowing step. That is agent #2.
- No order placement and no broker connection. Orders stay manual on Webull.
- No scheduled runs, no Discord output (owner chose the web page and the button).
- No backtest of the ranking. It is a description of the day, not a claim.

## 4. Anti-goals (would be a failure even if it "works")

- A ranking or wording that reads like "these will go up". The footer must say the order is
  activity, not odds, and the existing `ADVISOR_NO_EDGE_CLAIM` spirit applies.
- A failed data source that shows up as a short or empty list. Every source that fails must say so
  on the page (the repo's rule: unknown is never an all-clear).
- Spending the owner's Claude budget invisibly, or on hundreds of stocks per press.
- Re-enabling anything from the paused desk (scheduler jobs, HAWK/SAGE trading path).

## 5. Constraints

- **Capital:** $2-3k on Webull, about 5 slots. **Fractional shares are allowed (owner,
  2026-10-31)**, so price is NOT filtered against the slot budget. But a fractional quantity cannot
  carry a resting stop: Webull's fractional rules page says "we only support market orders for
  fractional share trading", regular hours only; the trade API says "Only MARKET orders are
  supported for fractional trading" with quantity in (0, 1]. Reviews mention limit orders in the
  app; nothing official mentions stop orders. Checked 2026-10-31 from Webull's pages, not the
  owner's app. So:
  - a row whose slot budget buys **less than one whole share** is tagged
    "เศษหุ้น · ตั้ง stop ไม่ได้ ต้องเฝ้าเอง" (call);
  - for other rows the whole-share part can carry a stop and only the leftover fraction cannot,
    which is `/advisor`'s concern (§7), not the scan's.
- **Day-trading rules:** FINRA removed the PDT $25k minimum on 2026-06-04 and Webull says it no
  longer limits day-trade counts. The owner has not yet said whether the account is cash or
  margin. A cash account can only use settled funds, so effectively one turn of capital per day.
  Either way the final pick is a few names, which is agent #2's job; this scan does not depend on it.
- **Stack:** existing NEXMIND app (Next.js 16, Prisma 7, Neon). Read `node_modules/next/dist/docs/`
  before app code (AGENTS.md). Pure logic in `src/lib/`, I/O at the route, tests on the pure parts,
  as the rest of the repo does.
- **Preview** with launch config `nexmind-dev-web` only (STATE.md §5).
- **AI backend:** `callAgent` / `callAgentJSON` in `src/lib/anthropic.ts`, which runs on the local
  Claude CLI. Vercel production has no AI backend (STATE.md §6), so on Vercel the AI column will be
  unavailable and must say so.

## 6. How it works

### 6.1 Market data: TradingView screener (owner chose TradingView)

One POST to `https://scanner.tradingview.com/america/scan` returns the whole filtered US market in
about 0.5 s. Probed 2026-10-31: it serves `close`, `change`, `gap`, `premarket_change`,
`premarket_volume`, `volume`, `relative_volume_10d_calc`, `average_volume_10d_calc`, `ATR`, `RSI`,
`EMA20`, `market_cap_basic`, `earnings_release_date`, `earnings_release_next_date`. With no login,
`update_mode` reads `delayed_streaming_900`: **data is 15 minutes delayed**. The owner accepted that
(owner), because `/advisor` re-checks a live Finnhub quote before sizing.

The endpoint is **unofficial**. It can change or rate-limit without notice. A failure means no scan,
shown as an error naming TradingView; never an empty table.

### 6.2 Layer 1: code filters (call)

All server-side in the TradingView request where possible:

- **universe: the S&P 500 only (owner, 2026-10-31).** The owner chose it over the whole US market,
  which keeps out low-float small-cap gappers (halts, wide spreads, bad delayed pre-market prints).
  The repo already has the list (`UNIVERSES.sp500` in `src/lib/trading/universe.ts`); whether the
  request filters by TradingView's index membership or passes the ticker list is the builder's call,
  but the page must show how many of the ~500 the response actually covered.
- price at least $5 (no upper bound: fractional shares are allowed)
- 10-day average volume high enough to day-trade in and out (starting point: 1M shares; the builder
  may tune it)
- ATR as % of price above a floor, so cost is not most of 1R

Then "something is happening today", at least one of these **qualifying triggers**, all read from
the one TradingView response so they cover the whole universe at no extra cost:

- absolute gap (pre-market move before the open, or today's open vs prior close after it) above a
  threshold
- relative volume above a threshold (pre-market volume before the open, the session's so far after)
- earnings released after yesterday's close or before today's open

**Tags only, never a trigger on their own (call):** "earnings tonight" and SEC 8-Ks. For a day trade
that is closed before tonight's report, earnings tonight is a caveat, and in earnings season it
alone would add a hundred-plus names with nothing happening today. An 8-K is only fetched for rows
that already qualified (one EDGAR request per ticker, ~10/s), so it cannot be a market-wide
trigger; a stock with an 8-K and no gap and no volume has nothing to day-trade.

Thresholds are starting points for the builder to set and show on the page.

### 6.3 Activity score and order (call)

Rows are ordered by a transparent **activity score** built from gap size, relative volume and
news presence. The formula is shown on the page (a tooltip or a line under the table). It is a
sort key, not a forecast.

### 6.4 News (owner: company news, economic data, earnings)

- **Earnings:** from TradingView's release dates. Tag "earnings last night / this morning" or
  "earnings tonight".
- **Company news:** SEC 8-Ks via the existing `fetchRecentFilings` and the tiers in
  `riskSentry/filingWatch.ts`, plus recent headlines via the existing `fetchRecentNews` (Finnhub),
  only for names that pass layer 1, to stay inside Finnhub's 60 calls/min.
- **Economic releases:** a banner with today's US releases and their Thai time. Source is the
  builder's call (no free Finnhub endpoint covers it). If no source works, the banner says the
  calendar is unavailable.

### 6.5 Layer 2: the AI summary (owner: "let the agent analyse")

For the rows that pass layer 1, the AI gets each stock's numbers and headlines and writes one or two
lines saying **what is happening** ("reported last night, gapping +6%, pre-market volume 4× normal")
and flags caveats ("earnings after tonight's close", "the 8-K is a routine director change").
It does not say buy, sell, or which is best (call).

To control cost, the AI covers the top N rows by activity score (starting point 30), in batched
calls. If the AI is unavailable (no backend, outage latch, spend limit), the table still renders
and the column reads "AI unavailable: <reason>".

### 6.6 The page (mockup: `.superpowers/brainstorm/.../scan-page.html`, owner reviewed)

- New sidebar entry next to Trade Advisor and Trade Journal. Thai UI, like the rest.
- "สแกนตอนนี้" button, last-scan time in Thai time, market state (pre-market, open, closed), and
  "N passed of M scanned".
- Economic-release banner.
- Table: rank, ticker, price, gap, relative volume, ATR%, news tags, AI summary, "→ Advisor" link
  that opens `/advisor` with the ticker filled in.
- Footer: the order is activity, not odds; no rule in this project passed its hold-out; data is
  15 minutes delayed.
- Each source that failed is named on the page.

## 7. Follow-up outside this agent

`/advisor` sizes whole shares only (`sizeShares`), so for a name priced above one slot it reports 0
shares. Fractional sizing in `/advisor` (with the no-resting-stop caveat) is a separate small change,
to be done after this agent; until then the scan's "→ Advisor" link still works but the card will say
0 whole shares for those names.

## 8. Left to the builder

- Exact thresholds and the activity-score formula (document them on the page).
- Whether scan results are stored (a DB table or nothing). Nothing needs history yet.
- How `/advisor` receives the ticker from the link (query string is the obvious choice).
- Economic calendar source.
- Batch size and model tier for the AI summaries.
- Route timeout (`maxDuration`) to fit the AI step.
