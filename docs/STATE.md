# NEXMIND — Session State

**Living handoff. Read this first; update it before you finish.**
Auto-loaded every session via `CLAUDE.md`. Dated deep-dives live in `docs/quant/`; the
reasoning behind each change lives in its commit body. This file is the current bar, not
the archive.

_Last verified against the live DB: **2026-08-31**. Working tree, branch and test suite
re-checked **2026-09-11**, branch `stocks-only-pivot`._

> **The panel gate has now run end to end (2026-08-31, run #112, `status: done`).** The budget
> that had paused everything came back the same day. The round proposed 3 strategies and rejected
> all 3 at the FIT fold — **the first `panel-v1` rows the project has ever produced**, and the
> answer to the question that had been open since the gate was built: it works, and it says no.
> The eligible pool is still empty, but that is now a verdict rather than an untested claim.
> **Resume at §4.0.**

---

## 1. What this project is

Multi-agent AI trading guild (Next.js 16 · Prisma 7 · Neon Postgres). **US stocks only**,
**paper mode**, no broker API. Pipeline: SCANNER (no AI) → HAWK×3 vote → SAGE veto →
Iron Rules (pure code) → simulated fill. See `README.md` for the architecture; do not
duplicate it here.

Hard context the code does not state:

- **Webull is data-only.** Its trading API can't be reached unattended; the shadow-execution
  path was removed 2026-08-22. Real orders are manual.
- **Real capital is $2–3k on Webull, whole shares only.** No fractional sizing → ~5 usable
  slots. Validate unconstrained first, then restate results at $2–3k.
- Go-Live is deferred and unscheduled. Nothing goes live until an arm comparison shows the
  analysts beat the rule-only baseline.

## 2. Live state (verified by query, 2026-08-31)

| Thing | Value |
|---|---|
| Portfolios | **one**: #11 "US Stocks Desk", active, kill switch off, 5 slots, $10k paper |
| Desk #11 strategy | **`trend-pullback`** (built-in), 1wk/5y — switched off `combo-vote` 09-02 (§3) |
| Open trades | 3 (KO, AZO, XOM), all `aiBackend = "mock"`, all opened 08-24 (KMX has since closed) |
| Closed trades | 44, cumulative **-$386.82** |
| AI backend on every trade ever | `mock` (46) or null (2) — **no trade has ever been opened by a real backend** |
| Since the mock cutoff (08-25) | **0 trades opened.** The desk runs, decides with `cli`, and declines |
| `Counterfactual` rows | **51, every one `aiBackend = "cli"`**: no-consensus dominant, a handful of SAGE vetoes, **0 fills** |
| …by day | 08-23 (3), 08-26 (10), 08-27 (12), 08-29 (12), 08-30 (13) — the loop is running daily |
| `Signal` rows since 08-26 | 50 discarded, 6 vetoed, 0 traded |
| `ResearchStrategy` | 218 rows: **3 are `panel-v1`** (216-218, all rejected at FIT on 08-31), the other 215 `legacy-single-symbol` (6 of them still read "approved" — none desk-eligible) |
| Desk-eligible strategies | **0** — but as of 08-31 that is a *verdict*: 3 candidates were panel-tested and all 3 failed (`npx tsx scripts/list-survivors.mts`) |
| `ResearchRun` | newest is **#112, 2026-08-31, `status: done`** — **the first panel round ever to complete.** 491 symbols, FIT fold, 3 proposals, 3 rejections (#111 was the spend-limit failure the day before) |
| `Setting` rows | only `fearGreed` and `webull:accessToken` (expires **2026-09-14**). **No `ai:outage` row** — the spend limit predates the latch fix, so it was never recorded |
| Market gate | **live and readable again** since 08-30: `SPY 769.35 > SMA200 707.41` (+8.8%) on Alpaca bars (§3) |
| Scheduled tasks | all three (`Stocks scan` 05:00, `Manage positions` /15min, `Research round` Sun 06:00) now share the same power settings; next research fire **2026-09-06 06:00** |
| Working tree | **dirty**, not clean: branch `stocks-only-pivot` at `859331a`, **52 commits ahead of `origin/stocks-only-pivot`, never pushed** — 16 tracked files touched (10 modified, 6 intent-to-add) plus 28 untracked, none of it yours to stash, clean, or check out over. `xauusd-mt5` was fast-forwarded into this branch on 09-11 and deleted |

The load-bearing part is the owner's uncommitted 2026-09-05 deep-hold-out work —
`docs/quant/2026-09-05-deep-holdout.md`, `scripts/deep-holdout.mts`, `scripts/cache-deep-history.mts`,
`scripts/deep-holdout.log`, `src/lib/research/mechanisms.ts` — plus 96 uncommitted lines already in
this file. `git stash`, `git clean -fd`, or `git checkout --` on any of it destroys real work.

Re-verify with a throwaway script under `scripts/` (delete it afterwards) querying
`portfolio.findMany` (the field is `status`, **not** `active`),
`trade.groupBy({ by: ["status"] })` and `researchStrategy.groupBy({ by: ["status"] })`.

## 3. Done recently (2026-08-23 → 09-14)

Older entries are compressed to one line each; their reasoning is in the commit bodies.

- **REGIME BREAK — the automated research pipeline now decides at 5bps slippage, not 0.5bps.
  2026-09-14.** `RESEARCH_COST_MODEL` (`runResearch.ts`) fed `sweepLadder` at all three of its
  call sites — the FIT ladder sweep, the SELECT approve/reject read, and the held-out blind
  test — from `DEFAULT_COST_MODEL`, whose own comment says it was calibrated to an **MT5
  Raw/ECN GOLD account** and never re-derived after the stocks-only pivot to US equities. The
  size of that gap was already measured and sitting uncommitted:
  `scripts/probe-fill-and-costs.mts` replayed the real SP500 panel at 0.5bps vs 5bps slippage
  (commissionBps held at 1 in both) and found fold avgR shifts of **roughly -0.022 to -0.033R**
  (`scripts/probe-fill-and-costs.log`) — the same size as most effects this panel hunts for, so
  which of the two numbers research uses can flip a verdict on its own.
  New constant `EQUITY_COST_MODEL = { slippageBps: 5, commissionBps: 1 }` — exactly the
  already-measured pessimistic cell, not a new guess — and `RESEARCH_COST_MODEL` now points at
  it instead of `DEFAULT_COST_MODEL`. 5bps matches Vibe-Trading's `global_equity.py` assumption
  for US equities and sits in the same neighborhood as `ADVISOR_COST_BPS` (already 5, already
  stock-specific, already used by the advisory card — never previously propagated to research).
  Same pattern this project already established for the wrong reason not to guess: `XAU_COSTS`
  / `xauCostPoints()` (`xauFolds.ts`) throws rather than silently substitute
  `DEFAULT_COST_MODEL` for an uncalibrated instrument; this is the equities mirror of that
  refusal, expressed as picking the worse of two measured numbers instead of an assumption with
  no data behind it at all — there is no equities fill log to calibrate a true value from yet
  (Webull here is data-only).
  **Deliberately NOT touched:** `DEFAULT_COST_MODEL` itself (still the live paper desk's P&L
  assumption), `mechanisms.ts`'s already-logged, already-concluded screens (`deep-holdout.mts`,
  `mechanism-screen.mts`), and `panelRun.ts`'s exit-control fallback (`costs: exit.costs ??
  DEFAULT_COST_MODEL`) — re-deciding those is a separate, larger task, not this fix.
  **What this invalidates:** every number in run #112 (§0) and everything in §3-§5 measured via
  `sweepLadder`/`runResearch` was decided at 0.5bps. A future `ResearchRun` decides at 5bps.
  **Do not pool a pre-2026-09-14 SELECT/blind-test verdict with a post-2026-09-14 one** — they
  were judged against different friction. 704/704 tests pass (`runResearch.test.ts`'s
  `recomputeSweep` helper now mirrors `sweepLadder` off the same `RESEARCH_COST_MODEL` constant
  so the two cannot silently drift), typecheck clean. Owner-authorized (`ทำเลย`) after a
  three-point technical review that also reopened the exit axis (below) and flagged the news-
  sentiment data class as unresolved pending a depth check.

- **Earlier ATR-trail activation was the follow-up hypothesis `exit-control.mts` flagged on
  2026-09-05, and it is now tested and rejected. 2026-09-14. NOT a regime break — no candidate
  survived selection, so nothing downstream changes.** The original exit-control run (§3, below)
  found `trail 1/1.5` beating `trail 1.5/1.5` — the desk's live geometry — specifically on TEST2,
  the one fold where the live geometry fails, and flagged activating even earlier as "a hypothesis
  for a pre-registered run, not a conclusion from this one." `scripts/exit-control-trail-
  activation.mts` is that run: `activateMult` in `{0.25, 0.5, 0.75}` against a fixed `offsetMult`
  of 1.5, so only activation timing varies, same `BASELINE_EXIT` null, same `runExitControl`
  machinery, same pre-registered rule (p5 > 0 on FIT *and* SELECT), written down before either
  fold ran. Uses `DEFAULT_COST_MODEL`, not the new `RESEARCH_COST_MODEL` above — deliberately, to
  stay numerically comparable to `exit-control.log`/`exit-control-holdout.log`, and because this
  script exercises `panelRun.ts`'s exit-control path, which the cost-model fix explicitly left
  untouched. **Selection: zero candidates, all three ways.** All three clear FIT decisively (delta
  +0.037 to +0.043, p5 +0.017 to +0.022) and all three fail SELECT — not merely short of zero but
  *negative relative to baseline* (delta -0.004 to -0.010, p5 -0.041 to -0.043), worse than doing
  nothing. Holdout, run after per the same convention as the original (an empty candidate list
  does not skip the record): TEST1 fails (baseline itself positive here, +0.014; trail deltas
  positive but p5 crosses zero, -0.006 to -0.001); **TEST2 — the fold this whole follow-up exists
  to explain — passes on all three** (baseline -0.031, trails +0.007 to +0.010, p5 clears zero);
  TEST3 also passes (baseline -0.010, trails +0.031, p5 +0.020 to +0.024). Read this narrowly: the
  hypothesis is directionally right exactly where predicted, and the gate rejects it anyway,
  because SELECT said no before TEST2 was ever looked at — a holdout win cannot un-fail a
  selection fold, and reading it as vindication is the exact trap `runControl`'s p95-on-a-null-hits
  check exists to catch on the entry side. The exit axis, having now had both its already-built
  candidates (1.0/1.5, 1.5/1.5) and the earlier-activation region below them tested, is closed
  along this dimension the same way the entry axis closed in §5 — the remaining untried lever is
  `offsetMult`, not `activateMult`. No production code changed; 704/704 tests unaffected, typecheck
  clean. Logs: `scripts/exit-control-trail-activation.log`,
  `scripts/exit-control-trail-activation-holdout.log`. Second of the three items authorized by
  `ทำเลย` alongside the cost-model fix above; third (news-sentiment data depth) below.

- **News-sentiment data depth investigated and the pipeline was NOT built. 2026-09-14. No code
  written — this is the third `ทำเลย` item, and the point of checking first was to spend nothing
  if the data can't clear the bar.** Same question the 2026-09-08 earnings screen asked of an
  EPS-surprise feed, asked of sentiment: is there a source that is free, reaches back to FIT
  (2016-01-01), and is point-in-time BY CONSTRUCTION rather than a vendor's restated-today
  read of the past. None does, at panel scale:
  (a) **Finnhub `/news-sentiment`** — already the desk's news vendor (`lib/intel/news.ts`) —
  returns only a rolling aggregate over "articles in the last week": buzz, weekly average,
  sector bullish %. No date-range parameter, no per-article score. Finnhub's own tracker
  (`finnhubio/Finnhub-API` issue #19, opened by a user asking for exactly this, still open with
  no response) confirms historical per-article sentiment isn't offered, not merely underdocumented.
  Dead end before any fold is touched.
  (b) **Finnhub `/company-news`** — the endpoint `refreshFinnhubNews` already calls for the SCOUT
  panel — takes a real date range but returns headline/summary/datetime only. Checking
  `lib/intel/news.ts` against `prisma/schema.prisma`'s `NewsItem.sentiment` column found that
  field is set by **nothing in the live code path** — `refreshFinnhubNews`'s `create` call never
  touches it. The only rows that ever carry it are `prisma/seed.ts`'s three fixture rows, so the
  sentiment badge `page.tsx` renders (`{n.sentiment && (...)}`, line 115) is fixture-data leftover,
  not a working feature, on every real Finnhub-sourced row today. Unrelated to this investigation
  but worth a line since it surfaced for free: harmless (SCOUT feeds no analyst), not worth a
  separate task.
  (c) **Alpha Vantage `NEWS_SENTIMENT`** — the one API shaped right (`time_from`/`time_to` range,
  genuine per-article scores) — free tier is **25 requests/day**. The panel is 491 symbols across
  6 folds; even one query per symbol-fold is ~3,000 calls, a 120-day fetch on the free key alone,
  before the multi-month windows a real 2016-2018 backfill needs. Not viable without a paid tier,
  and depth before ~2021-2022 is itself unconfirmed in Alpha Vantage's own docs.
  (d) **GDELT GKG** — the only free source with real point-in-time-by-construction coverage
  reaching before FIT's 2016-01-01 open (from February 2015): its tone score is computed
  automatically when an article is crawled and is never revised, the same property this project
  already trusts in EDGAR's `acceptanceDateTime` (`cache-earnings-dates.mts`). But GKG has no
  built-in ticker mapping — matching a global news-tone stream to specific S&P 500 symbols is an
  open-ended entity-resolution project, a different order of engineering from the earnings
  screen's clean ticker→CIK join, and the raw archive runs into terabytes a year.
  **Why this closes the question rather than deferring it:** the earnings screen already
  established the fallback this project uses when a point-in-time surprise feed doesn't exist —
  substitute the reaction bar's own price move and call that the surprise. The same substitution
  is the only thing left once (a)-(d) are ruled out: score a headline with today's LLM after the
  fact, which is not a text-sentiment signal distinct from price, it is the 2026-09-08 PEAD/
  reaction-bar experiment again, already run in both directions (`pead-drift`, `pead-fade`) and
  already rejected. Building a sentiment pipeline here would either cost more than this project's
  other data-class work for a source that cannot reach FIT, or quietly re-run a screen already on
  the books. **Recommendation: do not build it.** All three `ทำเลย` items are now closed.

- **The advisory card now carries a real earnings date, and SCOUT's news is per-position.
  2026-09-14. NOT a regime break — nothing HAWK or SAGE reads changed.** RAVEN had been
  reciting "earnings dates, news, sector-wide moves" as blind spots because its own system
  prompt listed them, not because it had looked. Two of the five are now real:
  (a) **earnings** — `lib/market/earnings.ts` calls Finnhub's `calendar/earnings` (free tier,
  verified live), `AdvisorCard.earnings` carries it, `lib/advisor/earningsPhrase.ts` formats
  the ONE string that both the owner's card and RAVEN's `[head]` block print, and the SYSTEM
  prompt now forbids listing earnings as a blind spot and requires quoting the date instead.
  (b) **news** — `refreshFinnhubNews` moved from `news?category=general` to
  `company-news?symbol=` over the symbols with an **open trade**, filling the `NewsItem.symbol`
  column that had always existed and been left null. A flat desk now stores nothing rather
  than storing the market's front page.
  **Deliberately not done:** the earnings field was kept OFF `Fundamentals`. `fundamentalsLine`
  feeds `buildAnalystContext`, which is in every HAWK and SAGE prompt on every scan — a line
  there WOULD have been a regime break splitting the `Counterfactual` population at this date.
  The advisory tool decides nothing and trades nothing, so it got its own module instead.
  **Also deliberately not done:** news is NOT wired into RAVEN. Sector/peer moves, options
  positioning and the macro calendar remain blind spots; no free source for them exists here.
  The earnings date is **reported, never acted on** — the 2026-09-08 mirror-pair screen killed
  earnings timing as an entry in both directions, so nothing sizes, stops or ladders from it.

- **New data class evaluated and built: SEC Form 4 insider transactions. 2026-09-14.**
  Investigated SEC EDGAR's bulk **Insider Transactions Data Sets** (quarterly ZIPs,
  `SUBMISSION`/`NONDERIV_TRANS`/`REPORTINGOWNER` tables joined by `ACCESSION_NUMBER`) as a
  candidate research data class, holding it to the same bar the news-sentiment investigation
  above failed: free, point-in-time-by-construction, reaches before FIT's 2016-01-01, and
  survives at panel scale. It passes all four. **Point-in-time**: `SUBMISSION.FILING_DATE`
  (day precision) plus row-level `TRANS_TIMELINESS` — of 217,720 cached events only 148
  (0.1%) were filed late. **Free and flat**: quarterly ZIPs run ~13.6-13.9MB compressed
  regardless of year. **Panel join**: 486/490 SP500 symbols carry at least one event
  (99.2%); the 4 misses (`BIO`, `FOXA`, `LEN`, `NWSA`) are dual-class structures where
  insiders trade the *other* class (`FOX` not `FOXA`, the excluded `LEN.B` not `LEN`), not
  a join defect. **Signal density**: filtered to `TRANS_CODE` P/S only (open-market
  buy/sell — excludes grants, option exercises, tax withholding, gifts, conversions),
  leaving a real subset rather than a thin one.
  **Recommendation: build it.** Built `scripts/cache-insider-transactions.mts` (mirrors
  `cache-earnings-dates.mts`'s pattern; new `adm-zip` dependency, zero transitive deps, to
  read TSVs out of the ZIPs), producing `.cache/insider/sp500-form4-ps.json`: 217,720 P/S
  events, 486/490 symbols, `2015q1..2026q3` (`2026q2`/`2026q3` not yet published by SEC —
  a trailing publication lag distinguished from a real historical gap by only tolerating
  404s at the tail, not mid-run). **This is the caching half only.** The proposer still
  only consumes a price/volume `ScanSnapshot`; wiring insider data into the proposer or
  backtest engine is separate, larger work and has not been started or decided.

- **Insider-transaction screen: REJECTED, both directions. 2026-09-14.**
  `scripts/insider-transaction-screen.mts` — pre-registered mirror-pair screen (`insider-follow`:
  net dollar-value buying -> long, net selling -> short; `insider-fade`: the exact mirror), daily
  bars, filing date `d` as the sole anchor, same-bar fill (`entryAt: "open"`, no `shift1` needed
  because the signal depends on nothing about any bar's own price), FIT+SELECT only. All four
  checks passed: FILING-LAG 99.99% `d >= td`; COVERAGE 95.6%/95.4%; NO-LOOKAHEAD zero violations
  across 17,594+10,941 signals per rule; VOIDING 99.32%. **Neither rule clears the frozen bar.**
  `insider-follow` beats its control's median in both folds but **loses money outright**
  (avgR -0.074 fit / -0.096 select vs control median -0.095 / -0.166) — the exact "margin over a
  losing control" shape the `avgR > 0` clause exists to reject. `insider-fade` is the mirror image
  of the interesting case: it is **profitable in both folds** (avgR +0.056 fit / +0.100 select,
  59.0%/61.4% win rate) but **loses to its own control's median** (+0.070 / +0.146) — insiders
  selling ahead of an up move and buying ahead of a down move is real money, but a random entry on
  this panel in this regime makes even more of it, so the edge is the panel's own directional
  drift, not something specific to insider filings. Retail costs change neither verdict. **This is
  the second non-price data class in a row to fail** (earnings-timing above was the first): knowing
  WHEN a company's own officers traded their own stock, alone, is not tradable here. No TEST-fold
  read is authorised — the frozen bar says stop.

- **Insider role-weighting: REJECTED, both directions — closes the untried axis named above.
  2026-09-14.** `scripts/insider-role-weight-screen.mts` — same net-dollar-value screen as above,
  but each event's contribution is multiplied by a fixed ordinal role rank (Officer=3 >
  Director=2 > TenPercentOwner/Other=1, highest rank wins on multi-role filings) before
  aggregation, testing whether the raw screen's null was a large uninformative 10%-owner trade
  drowning out a smaller, more informed officer trade on the same bar. It was not:
  `insider-role-follow` -0.074 fit / -0.096 select (vs control -0.095/-0.166) and
  `insider-role-fade` +0.056/+0.099 (vs control +0.070/+0.148, 59.0%/61.3% win rate) are, to three
  decimal places, the **same numbers as the unweighted screen** — the weighting changed almost
  nothing. Same four checks, same frozen bar, same verdict: both FAIL.
  **A genuine data-quality bug was found and fixed first, before any performance number was read.**
  A pre-registered ROLE-MIX diagnostic (informational, no gate) exposed a handful of SEC Form 4
  events with corrupted per-share prices dominating one role bucket's dollar total. A same-date
  price-vs-panel-close check was tried first and rejected: the panel's bars are retroactively
  split-adjusted (confirmed via GOOG's 2022 20:1 split), so it flagged ~20,700 legitimate pre-split
  GOOG/NVDA/CMG filings as corrupt. The check actually shipped compares each event's price/close
  ratio against the **local median ratio of that same symbol's nearby filings** — a split moves a
  whole neighbourhood together so it does not register, isolated corruption still does. 43 of
  217,720 events dropped (0.02%), not sign-flipped; ROLE-MIX post-cleaning: Officer 75.6% of
  events/37.2% of dollar value, Director 20.6%/15.4%, TenPercentOwner+Other 3.8%/47.4%. **Not
  fixed by this check:** a share-COUNT-side corruption (BAC, 2016-10-19: 4,201,596,806 shares at a
  plausible $15.61) — a different shape, stated as an open limitation, not addressed here.
  **What is now closed:** role-based weighting of Form 4 filing timing, on this fold/regime.
  No TEST-fold read is authorised.

- **The stocks half now has a surface the owner can actually use, and it claims no edge.
  2026-09-11.** `/advisor` — the first thing this project has shipped that is meant to be
  *used* rather than measured. It is not a screener and not an automated trader: the owner
  types a ticker they already chose, and the tool reports that ticker's structure. Entry
  (last close, or an override), stop at **1.5 × ATR(14)**, the R ladder `[1, 1.5, 2, 2.5, 3]`
  in real prices, the round-trip cost expressed **in R**, how many **whole** shares the
  capital buys under two caps (risk budget and one-slot affordability) with the binding cap
  named and the **actual** risk % printed, free slots, the market gate's own reading, and
  correlation to what is already held. It picks no target, ranks nothing, and every card
  carries `ADVISOR_NO_EDGE_CLAIM` verbatim — because §4 (g), the weekly deep hold-out and the
  classic-indicator screen all landed the same way, and a tool built on top of that record has
  no business implying a reason to buy. Correlation is **reported, never applied**: the card
  prints `corrMultiplier` and `corrAdjustedShares` beside a size that ignores both.
  Architecture is one boundary, enforced: `src/lib/advisor/` is pure (no prisma, no
  marketData, no yahoo, no clock) and `src/app/api/advisor/route.ts` is the only I/O. SPY is
  fetched separately at `2y/1d` with a 300-day floor, because `fetchCandlesBatch` takes no
  `minDays` and a `6mo` benchmark would have made the gate read BLIND on every request with
  nobody the wiser. Six commits, `9bcae76..859331a`, fast-forwarded into `stocks-only-pivot`.
  **648 tests pass.** Spec `docs/superpowers/specs/2026-09-10-stock-advisory-tool-design.md`.

  The load-bearing part is what the final whole-branch review caught, because it is the
  failure mode this file keeps warning about in a new place: the route coerced every numeric
  field through a silent fallback, so typing `0.5%` into "Risk per trade (%)" produced `NaN`,
  fell back to `1`, and the card then printed *"Real risk is $18.00 (0.72% of capital), not
  the **1%** requested"* — a **fabricated risk percentage at double the intended risk**, with
  the tool's own honesty machinery repeating the wrong number back with confidence. `3,000`
  in the capital field was worse: it became 2500 and nothing on the card echoes capital, so
  every dollar figure was silently wrong. Fixed in `859331a`: absent or blank still means
  "use the default", but anything present that does not parse to a positive number is a
  **400 naming the field and the value**. Same round: holdings are deduped (a repeated name
  was silently eating a slot), tokens dropped for any reason now reach the card's warnings,
  and a holding whose last bar lands on a different date than the ticker's is flagged
  approximate instead of being rendered as a clean correlation — `pearsonCorrelation` zips by
  trailing index, not by date, and `fetchCandlesBatch` will hand back a series up to 6 days
  stale. Also replaced a test that asserted nothing: the "correlation is reported, never
  applied" case had been running with **no holdings**, so the multiplier was 1 and the
  assertion was arithmetic; folding the multiplier into the share count would have passed it.

- **Weekly-bar screen: two of the six existing mechanisms clear the promotion bar at the only
  fill the owner can trade. 2026-09-08.** Pre-registered hypothesis: at least one of the six
  existing entry mechanisms, unmodified, resampled to weekly bars and filled the only way the
  owner can actually place it — decided at the close of week *i*, filled at the open of week
  *i+1* — beats its matched random-entry control at `DEFAULT_COST_MODEL` in both FIT and
  SELECT. All three aborting checks passed before the verdict was read: HARNESS **match** (the
  daily panel still reproduces `mechanism-screen-control.log` to 0.002R), RESAMPLER **pass**
  (491 symbols, 265,167 weekly bars, every bar re-derived from and checked against its daily
  source), VOIDING **99.73%** against a 99% bar. Stated as constraints, not caveats: FIT
  carries **no** warm-up prefix and loses its first 60 weekly bars to the engine's own
  warm-up (~14 months of a 3-year fold); SELECT is **52** weekly bars. Verdict, avgR /
  control-median at `DEFAULT_COST_MODEL` (fit then select): **mr-down3** 0.104/0.073 then
  0.397/0.241 — beats-median **and** clears the control p95 (0.097, 0.272) in both folds, raw
  avgR positive and large both times. **gap-fade** 0.004/−0.071 then 0.026/−0.111 — also
  beats-median in both folds, but its own avgR is ~0 while the control it beats is *negative* —
  and at the pre-registered 5bps retail block its FIT avgR turns negative too (−0.009 against a
  −0.086 control, `scripts/weekly-mechanism-screen.log`): the same "clears the bar without
  making money" shape §5 already warns about, in reverse.
  **mr-down3 and gap-fade are not the same finding — say which is which.** The other four
  failed at least one fold and are not promoted: nr7 0.130/0.086 (fit beats-median) then
  0.031/0.180 (select LOSES); turn-of-month 0.070/0.103 (fit LOSES) then 0.351/0.296 (select
  beats-median); vol-dryup 0.277/0.124 (fit beats-median) then 0.180/0.325 (select LOSES);
  range-expand 0.056/−0.009 (fit beats-median) then 0.005/0.128 (select LOSES). Realised
  weekly 1R (median slMult × ATR / close over each mechanism's firing bars) came to
  **5.58%–8.33%** of price across mechanisms and folds — the spec projected ~8.3% from
  sqrt-of-time scaling off a measured daily 3.70%, so the realised number lands somewhat below
  the projection: the halved cost-in-R the spec was testing for is real, but smaller than
  projected. **ADVANCES: mr-down3, gap-fade** — read their TEST rows next, then write a
  separate pre-registration before spending the deep hold-out (§4g). Spec
  `docs/superpowers/specs/2026-09-08-weekly-bar-mechanism-screen-design.md`, plan
  `docs/superpowers/plans/2026-09-08-weekly-bar-mechanism-screen.md`, log
  `scripts/weekly-mechanism-screen.log`.

- **`mr-down3` PASSED a pre-registered hold-out on 2000–2016 data. 2026-09-05 — the first
  thing in this project ever to pass one.** `docs/quant/2026-09-05-deep-holdout.md`,
  raw log `scripts/deep-holdout.log`.

  The 2016-01-04 floor on every symbol in `sp500-1d.json` was never the end of history — it is
  **Alpaca's equity inception**. `providerOrder()` falls through to Yahoo only when a provider
  *errors*, and Alpaca does not error, so Yahoo, which serves the same names back to the 1990s,
  had never been asked. `scripts/cache-deep-history.mts` asked it: **453 of 491 S&P names,
  1998-01-02..2016-01-04**, into a SEPARATE cache (`.cache/bars/sp500-1d-deep.json`) so no
  existing number moves. Three new `DEEP_FOLDS`, all ending before `FOLDS.fit` begins.

  Rules fixed in the script header **before the first run**: pass = beats the control median in
  ≥2/3 deep folds AND the control p95 in ≥1/3; anything less closes mean reversion as a family.

  | fold | trades | avgR | ctrl med | ctrl p95 | margin vs p95 |
  |---|---|---|---|---|---|
  | deep1 2000-05 (dot-com bust) | 27,521 | +0.070 | 0.045 | 0.051 | **+0.019** |
  | deep2 2005-10 (GFC) | 30,268 | +0.074 | 0.039 | 0.044 | **+0.030** |
  | deep3 2010-16 (QE) | 38,195 | +0.132 | 0.076 | 0.081 | **+0.051** |

  **Median 3/3, p95 3/3 — PASS on the stricter condition in every fold.** The pre-registered
  survivorship diagnostic (quartile symbols by their OWN deep-window return; reject if the
  margin lives only in the top quartile) came back **flat**: Q1 +0.037, Q2 +0.040, Q3 +0.036,
  Q4 +0.042, 12/12 cells beating the control median, with Q1 holding names compounding at
  −27.8%/yr. **The winner-drift objection falls — that one only.** Bucketing survivors by
  their own return cannot reach the names that left the index, so membership survivorship is
  untested here, not answered (restated in "What it is NOT" below, and now carried in the
  script's own verdict line rather than only in prose). 13 of 14 fold-cells positive across two ticker-disjoint
  universes and two non-overlapping 16-year eras, from a rule with zero fitted parameters on an
  exit ladder never tuned to it.

  **What it is NOT.** Not a strategy: 27k–38k trades per fold is a diffuse edge firing ~40×/day,
  and at $2–3k in whole shares the desk holds ~5 slots — *which* signals to take is unsolved and
  unvalidated. Not free of **membership** survivorship: the list is today's S&P 500, and names
  that delisted 2000–2016 are absent entirely (the quartile test kills "winners bounce", not
  "losers are missing"). Not to be combined with the ATR trail (both chosen on the same panel).
  Not to be swept — "3 days" comes from the literature, and that is the whole reason it is
  credible. **Next question is sizing and selection, not another entry mechanism.**

  Harness verification: `LADDERS`/`MECHANISMS` moved to `src/lib/research/mechanisms.ts` so both
  screens run the same objects; proven number-identical by diffing a full 9×5 run against
  `git show HEAD:scripts/mechanism-screen.mts`. `npm test` 519/519.

- **The wider single targets were exposure; the trails are not. 2026-09-05 — the side split.**
  The new exit control said the trail is positive in 4-5/5 folds. This project has been fooled by
  that shape before (regime x side was also 5/5 and turned out to be beta), so the same test
  that exposed it was applied here before anything was tuned: `scripts/trail-is-geometry.mts`
  computes the paired delta **separately on long and short trades**. Drift in a US equity panel is
  up, so a geometry that only helps longs is collecting drift; one that helps both is managing a
  trade. Result, against a pre-registered rule: **`single 2`, `single 2.5` and `single 3` are
  exposure, confirmed** — positive on longs in 4/5 folds, negative on shorts in **5/5 each, 15 of
  15 short cells the wrong way**, with both halves growing monotonically in `tp1Mult`. That also
  explains the fit-shaped pattern from the day's earlier run: delta rising with `tp1Mult` on
  FIT/TEST1 and falling on SELECT/TEST2 is the fold's long/short mix, nothing more. The trails
  behave differently — `trail 1/1.5` has a **positive short delta in 5/5 folds**, `trail 1.5/1.5`
  in 3/5 — but by the pre-registered rule (shorts p5 > 0 in ≥4/5) they are **MIXED, not proven**:
  `trail 1/1.5` clears p5 on shorts in only 1/5, because the short leg is a third of the sample
  over the same monthly blocks and the intervals are wide. Post-hoc and labelled as such: 5/5
  positive is p = 1/32 under a fair coin. **Duration is refuted outright** — the rank correlation
  between "holds longer than baseline" and delta is negative in all five folds (mean −0.42), and
  the trails hold *less* than the single targets (10.8–13.5d vs 13.8–16.8d) while beating them
  everywhere. Log: `scripts/trail-is-geometry.log`.

- **The exit axis is measurable now, and the first thing it measured is the ATR trail.
  2026-09-05 — the second null exists.** §5's standing trap said no AI-proposed exit could be
  gated until a null of the form *same entries, baseline ladder* existed. It does:
  `runExitControl` + `exitFoldVerdict` in `panelRun.ts`, resting on `pairedBlockBootstrap` in
  `control.ts`. It is the mirror image of `runControl` — that one shuffles the entries and holds
  the exit fixed, this one holds the entries fixed and swaps the geometry — so whichever half of
  a strategy is under test, the other is the constant. The bootstrap is **paired**: both arms
  trade the same signals in the same months, so resampling a month resamples it in *both* arms
  and the shared market component cancels inside every resample; two independent bootstraps would
  charge that variance to the difference twice and could not resolve a ~0.04R effect. Blocks are
  the **intersection** of the two arms' months, because one-position-per-symbol means a
  longer-held geometry skips signals a shorter one takes, and a month only one arm was in would
  let arm composition drive the delta. Bar: p5 of the resampled delta > 0, one-sided at 5% — the
  same level the entry gate asks of the control's p95, pre-registered before any geometry was
  measured. Fail-closed as everywhere else: fewer than two shared months reads as *unverified*,
  never as a pass. `BASELINE_EXIT` (1.5/1.5) is `REFINEMENT_LADDER` restated as plain numbers
  because `runResearch.ts` constructs prisma at module scope; `runResearch.test.ts` asserts the
  two agree so the copy cannot drift. **First reading (`scripts/exit-control.mts`, pre-registered
  selection rule = p5 > 0 on FIT *and* SELECT): zero candidates.** Both ATR trails clear FIT
  decisively (delta +0.045/+0.046, p5 +0.024/+0.019) and both fail SELECT, where every geometry
  including the baseline is negative. The holdout, run afterwards with an empty candidate list to
  finish the record: `trail 1/1.5` is positive in **5/5** folds and passes p5 in 4, failing only
  SELECT; `trail 1.5/1.5` — the geometry the desk trades — is positive in 4 and passes 3, failing
  SELECT and TEST2. The three wider single targets pass nothing, and their delta grows with
  `tp1Mult` on FIT/TEST1 and shrinks with it on SELECT/TEST2 — a parameter whose sign depends on
  the fold is a fit, not a mechanism. Read narrowly: an ATR trail is worth ~+0.04R per trade
  *against the 1.5/1.5 ladder, on these entries*, and that is a smaller loss rather than an edge
  — the baseline entry still loses to a matched random entry in 30/30 cells. Logs:
  `scripts/exit-control.log`, `scripts/exit-control-holdout.log`. 509/509 tests.

- **Anticipating the setup fails too, and better onset prediction made returns WORSE.
  2026-09-05 — the closing test of the entry axis.** §8 had named the one direction left: a
  causal rule that fires earlier on the *same* setup rather than one that admits more setups.
  `scripts/entry-anticipation.mts` tested it as four pre-registered pairs — a pad around the
  RSI band or the ADX floor, each with and without a requirement that the reading be *closing
  on* its threshold (bars i and i-1 only, nothing reads forward). Bar: beat the baseline AND
  the paired widen-only variant on FIT and SELECT and both geometries. **No candidate.** Best
  is `adx approach 5` at 3/4, failing fit/single, and it loses to plain widening in all four.
  The harness checks out first — `adx widen 5` reproduces `adx 15` to three decimals in all
  four cells (+0.001/+0.009/+0.010/+0.022). What settles it is that the two gates answer the
  direction question **in opposite directions**, measured by a new column, `lead%` (of the
  bars a variant signals on that the baseline does not, the share followed by a baseline
  signal within 3 bars): on the RSI pad `approach` beats `widen` 4/4 while `lead%` **falls**
  (60.1 vs 61.5) — it discarded 69% of the extra signals and did not predict onsets any
  better, so it helped by trading less, not by anticipating; on the ADX pad `approach` lifts
  `lead%` **18.0% -> 31.4%**, a real gain at predicting the rule's own trigger, and **loses**
  4/4. *Firing earlier on the same setup* and *predicting when the setup fires* are therefore
  measurably different things, and where they were separable they pointed opposite ways —
  which is what the 30/30 control result means read at the bar level: the trigger bar is
  negatively selected, so homing in on it inherits the selection. Caveat in the study:
  `lead%` is confounded with which gate is padded, so only the within-gate pairs are clean.
  **The entry axis is now closed on three fronts** — relax (8/8 fail), anticipate (4/4 fail),
  and the one gate genuinely set late is worth +0.009R. The remaining untried axis is the
  **data class**: every mechanism ever screened here is a function of `ScanSnapshot`, which
  is price and volume only. Changing that is engine work, not a brief. Study §9:
  `docs/quant/2026-09-03-entry-lateness.md`. Script + log: `scripts/entry-anticipation.mts`.

- **The lag is the RSI band, and relaxing it does not recover the lateness gain. 2026-09-03,
  same day, follow-up to the entry below.** Two runs. `scripts/entry-gate-lag.mts` names what
  the rule waits on: at the bar before a signal onset the RSI band is the *sole* refusing gate
  in **53-58% of onsets in all five folds** (align ~19%, ADX ~13%, MACD ~11%), and in 4/5 the
  binding end is **RSI > 70** — the rule standing aside from a trend that is running; TEST2
  (2022-23) flips to the low end, as a bear market should. `scripts/entry-lag-variants.mts`
  then tested 8 pre-registered relaxations, scored on margin over the matched control, with the
  four-cell selection rule fixed in advance. **The margin stays negative in every cell of all
  ten**, and the three RSI relaxations — the gate the diagnostic pointed straight at — are the
  worst (`rsi high 80` negative in 10/10). The reason is the distinction the control exists to
  draw: shifting an entry earlier keeps the same trades and moves their price, while relaxing a
  gate admits a **new population** and lifts the control with it (fit/single control median
  +0.018 → +0.036). **Three of eight raise raw avgR while losing to their own control.** One
  candidate passed selection and then **replicated 6/6 out of sample — `adx 15`, 10/10 overall,
  and it is the only variant whose control median FALLS (9/10 cells) while its own avgR rises**,
  which is the signature entering-earlier should have. But it is worth **+0.009R** and leaves
  every margin negative, so the ADX floor is measurably set too late and that is all it is.
  **The §3 lateness gain is not reachable by loosening thresholds** — it came from moving the
  *same* trades; every relaxation available changes *which* trades are taken. Study §6-8:
  `docs/quant/2026-09-03-entry-lateness.md`.

- **The baseline entry rule loses to random entry in 30 of 30 cells, and the loss is confirmation
  lag. 2026-09-03.** Started as a check on whether `sweepLadder`'s FIT-chosen exit transfers out of
  sample. It does — Spearman rho vs FIT is +1.00 on test1 and test3, +0.37 on test2, and −0.54 only
  on SELECT, the fold where all six geometries are negative across a 0.028 spread. A trail wins in
  4 of 5 folds and the trail pair holds ranks 1-2 in all four. But the same run's matched control
  came back negative in **every one of the 30 ladder×fold cells**, and monotone in target width in
  5/5 folds: `single 1.5` → `single 3.0` gets steadily worse (select −0.130 → −0.255), with
  `single 3.0` the worst cell in three folds — worse than either trail. So the deficit scales with
  how far price must travel *after* entry, which is a statement about entry timing, not about
  exits. The obvious confound was checked and killed: ATR/price at entry, rule median ÷ control
  median, is 1.014 / 1.002 / 1.003 / 1.015 / 1.011 — at most 1.5%, nowhere near a 0.034R gap.
  Then `scripts/entry-lateness.mts` replayed the same signals *k* bars earlier with the control
  recomputed at each *k*: the margin flips sign at t−2/t−3 and climbs, in 5/5 folds and both
  geometries (`trail 1.5/1.5` at t−3: +0.185 / +0.021 / +0.164 / +0.109 / +0.174). **The rule picks
  the right names and the wrong bars.** Caveat recorded in the study: the t−5/t−8 magnitudes are
  inflated by the lookahead itself and are not a reachable target; the panel is daily while the
  desk trades weekly. Study: `docs/quant/2026-09-03-entry-lateness.md`. Scripts and logs:
  `scripts/ladder-transfer.mts`, `scripts/control-atr-bias.mts`, `scripts/entry-lateness.mts`.

- **Three defects behind "0 fills", all found by running the desk rather than reading it.
  2026-09-02.** The desk had produced 0 fills in 77 real AI decisions, and `structure` /
  `exhaustion` were voting skip ~100% of the time, so the 2-of-3 bar was unreachable. It was not
  one cause but three, and each was measured before and after in isolation:

  **(1) Every analyst was told volume had collapsed, on every scan.** `isForming` in `context.ts`
  tested `last.v === 0` only. That is the *Yahoo* shape — Yahoo appends the live quote as a
  zero-volume bar — but the feed moved to Alpaca on 08-30, and Alpaca returns the real,
  partially-filled bar. On a Tuesday the current weekly bar holds two sessions of volume, so
  against a 20-week average it read **"0.29-0.40x — thin"** on perfectly ordinary weeks, and
  `volumeBlock`'s correct `forming` branch (which reads the last *closed* bar) never ran.
  `isForming` now tests **the clock, not the contents**: median bar spacing over the last 10 gaps,
  the median so one halted or missing bar cannot stretch the deadline. Errs toward "still forming"
  between a session close and the next period boundary, which costs a reading of the last closed
  bar — always the defensible direction. Same six symbols, live, before -> after: WBD 0.40->0.81x,
  VRTX 0.29->0.60x, ILMN 0.39->1.08x, NVDA 0.33->1.32x, ADP ->0.71x, DXCM ->0.68x, all now
  "normal", and the in-progress bar is tagged `[bar not closed]`.

  **(2) A truncated answer voided the whole panel and was reported as an outage.**
  `maxTokens: 300` cut WBD's `structure` reason mid-string, `parseJsonLoose` threw, `Promise.all`
  rejected, and the engine's catch filed **`no-ai-backend`** — while the backend was answering four
  other symbols in the same run. That is the `FTNT -> no-ai-backend` line in the 09-02 log: a
  misdiagnosed outage, and two paid-for votes binned. Fixed both ways — the cap is 600
  (`MAX_VOTE_TOKENS`, a runaway guard, not a length budget) and `Promise.all` is now
  `Promise.allSettled` folded by a new pure `countableVotes`. Dropping a failed vote **cannot make
  entry easier**: the bar is "two votes on the same side", not "a majority of whoever answered", so
  a smaller panel is strictly harder. A genuine `isFatalBackendReason` still throws, so the outage
  latch keeps working, and an all-failed panel is an error. Dropped analysts are named in the
  engine's step note — a 2-of-2 that only happened because the third analyst died must not read
  like a clean 2-of-3.

  **(3) `combo-vote` on weekly bars was silently a 2-of-2 AND.** `combo-vote` is
  "vote >=2 of {trend-pullback, orb, fvg}" and desk #11 ran it on **weekly** bars, where `orb` — an
  intraday opening-range break — fired **0 of 80 symbols**. The live rule was therefore
  "trend-pullback AND fvg", and that intersection takes the most extended bar either member offers:
  median **%B 0.89 / stochastic 92.8 / +29.1% over SMA50**, against 0.70 / 77.4 / +12.5% for
  trend-pullback alone. Which is exactly what the analysts kept saying once (1) was fixed and the
  volume noise was gone — not one skip cited volume any more, and `structure`/`exhaustion` skipped
  4/4 unanimously **on extension**: ILMN "43.63% above SMA50 ... blown-off extension", ADP
  "Stochastic %K 97.1/%D 95.0 pinned at the extreme", DXCM "93% of the visible range". The desk was
  being handed the worst possible entries and the analysts were right to refuse them.
  New exported `silentMembers` + a one-shot `console.warn` names any combo member that never fires
  across a bar series, so a vote that has quietly become an AND says so. **Desk #11 is now on
  `trend-pullback`** (1wk/5y unchanged), which also settles the §6 mismatch: combo-vote on weekly
  was never intended. Switched with 3 legacy positions open — `revert-stocks-desk-to-default.ts`
  refuses that, but its stated reason ("exits get managed by a rule that did not open them") does
  not hold here: `manage.ts` reads no strategy at all, and exits are the sl/tp1/tp2 levels stored
  per Trade row.

  489/489 tests pass, typecheck clean. Note what none of the three was: a case for lowering the bar
  to 1-of-3 or dropping the skeptical analysts. `structure` and `exhaustion` were reading the facts
  they were given correctly on all three counts.

  **Verification run, same day, `trend-pullback` live — 19 setups / 79 symbols, and the desk still
  filled nothing (13 no-consensus, 6 vetoed). What changed is everything upstream of that:**
  - **The false outage is gone.** 0 `no-ai-backend` in 19 decisions; FTNT, the symbol that produced
    the misdiagnosis, decided `no-consensus` normally.
  - **SAGE stopped vetoing the data and started vetoing the trade.** Was 5 of 6 vetoes about frozen
    placeholder prints; now **0 of 6**. All six are setup arguments — COP "26.7% above SMA50,
    Stochastic 93.5, 100% of range", MDLZ "TP1 requires a range high the name has never printed",
    CSGP "weekly bearish but the daily has turned up". SAGE also now cites the new
    `[bar not closed]` tag by name (INTU), so Fix (1) is reaching the risk reviewer too.
  - **The analysts disagree now instead of uniformly refusing.** Under `combo-vote` it was
    `trend:long, structure:skip, exhaustion:skip` on essentially every symbol. Now `exhaustion`
    votes **long** on its own (PANW `trend:skip, exhaustion:long`; FAST `exhaustion:long` against
    two skips) and PCAR draws three skips. A 2-of-3 bar is reachable in principle again; it was not
    reachable before.
  - **A real pattern the desk should not be handed:** 4 of the 6 vetoes are **shorts entered into an
    active bounce** (CSGP, INTU, ISRG, TMUS) while the market gate reads risk-on (SPY 761.85 >
    SMA200 708.75). The scanner is proposing downtrend-pullback shorts in a regime the gate has
    already called long. Not yet investigated — next thing to look at, and cheaper than any AI work.
  - **One defect in the fixes themselves, found by reading the DB rather than the log.** The engine
    built the panel reading **twice** — once for the step note (with dropped analysts) and once at
    `engine.ts:244` for the stored `Counterfactual.aiReason` (without). So CRWD recorded
    `votes exhaustion:skip` and NVDA `votes trend:long, structure:skip` with no trace of the
    analysts that never answered — in the one table the arm recorder keeps. Both call sites now
    share `describePanel` (`hawk.ts`, two tests). 491/491.

- **A spent budget no longer fails silently. 2026-08-30.** `FATAL_BACKEND` in `anthropic.ts`
  matched `authenticat|oauth|logged in|api key|credit balance|quota|subscription` — and **not**
  "You've hit your monthly spend limit", the string the CLI actually returns when the account
  budget runs out. So the latch never tripped: the desk went on calling a backend that could not
  answer, every call failed on its own, and `aiOutageStatus()` stayed null, i.e. **War Room
  reported AI online while nothing worked.** `spend limit|usage limit` added, and the predicate
  extracted as `isFatalBackendReason` so it has tests (four, one per class). `limit` alone is
  deliberately NOT matched — a plain rate limit is worth retrying, and latching it would take the
  desk off AI for five minutes over a hiccup. Found by running a research round by hand, not by
  reading the code.

- **Webull market data moved to production (e1282ed).** UAT was serving a partially refreshed
  fixture set — 15 of 50 large caps stale, price errors to 39.8% (RTX 127.50 vs a real 211.71),
  and it never errored, so nothing downstream could tell. The old "the token is per-session, so a
  cron can never hold one" verdict was **wrong**: create -> approve once in the app -> check ->
  a NORMAL token lives exactly **15.00 days**, and `/token/refresh` returns +15 days with **no**
  second approval. `lib/webull/token*.ts` rolls it forward; **`ensureWebullTokenFresh()` hangs off
  the daily scan tick, not the data path** — Alpaca leads now, so `fetchWebullCandles` is
  essentially never called and a use-triggered refresh would have died 15 days after seeding,
  silently, leaving no fallback exactly when Alpaca finally needed cover. Verified against Alpaca
  on the symbols UAT was stale on: CSX/RTX/PM/SPY/MRK/HON all **0.00% diff, 366 bars,
  last 2026-08-28**. Still data-only; `/openapi/trade/*` untouched and untested.

- **The live bar feed is fixed: Alpaca leads, placeholders are dropped, the gate can be wrong
  again. 2026-08-30.** Three changes, each with a test that failed first:
  **(1) provider order** — `providerOrder()` in `marketData.ts` puts Alpaca ahead of Webull, and
  `fetchCandles`/`fetchCandlesBatch` both walk that order. Webull led before, never threw, and so
  Alpaca was never reached. **(2) placeholder drop in the live path** — `isPlaceholderBar` /
  `sanitizeSeries` moved out of `research/panel.ts` into **`src/lib/bars.ts`** (panel re-exports
  them, so nothing research-side changed) and every provider response now goes through
  `sanitizeResponse`, which also **re-quotes `price` from the surviving bars** — a dropped last
  bar could otherwise leave an invented quote in front of sizing and the facts sheet.
  **(3) the gate refuses an impossible series** — `MAX_TREND_EXTENSION = 0.5` in `marketGate.ts`;
  a benchmark further than 50% from its own SMA200 takes the existing **fail-OPEN BLIND** branch
  instead of reporting a reading. Not a chosen number: SPY's own extension across 2016-2026
  (2,679 Alpaca bars) ran **-25.8%** (2020-03-23) to **+17.8%** (2020-12-04), so no real regime
  can trip it, while the spliced series sat at **+117%**.
  Verified live, not just in tests: `fetchCandles("SPY","2y","1d",300)` now returns **500 Alpaca
  bars, 2024-08-30 → 2026-08-28, closes 489.57–777.88, 0 placeholders** (was 731 Webull bars,
  19.04–771.10), `readMarketGate` reads `SPY 769.35 > SMA200 707.41`, and feeding it the raw
  Webull series still produces `market gate BLIND — SPY 769.35 sits 116% from its own SMA200
  356.49`. All four open positions (KO/AZO/XOM/KMX) now get clean weekly series; **KMX had no
  Webull bar at all after 2024-12**. 393/393 tests pass, typecheck clean.

- **What Webull actually returns, measured 2026-08-30** — the evidence behind the change above,
  and the reason not to re-promote it. Depth is real: 1200 bars is a hard cap, so `1d` reaches
  ~5.11y (`5y` and `max` are the same response), `1h` 0.69y, `5m` 21d, and range labels are
  wrong throughout (`2y/1d` → 731 bars ≈ 3.05y). **The content is not.** Against Alpaca on the
  same dates (Alpaca and Yahoo agree to the cent), closes differ by >1% on **99.4% of SPY bars,
  86.6% of AAPL, 71.3% of KO, 58.0% of NVDA, 28.9% of MSFT**. SPY is a splice, not a
  mis-adjustment: real SPY to 2021-12-22, a different instrument in the $16–33 band for 84% of
  the series, real SPY again from 2026-04-14 (x0.046 down, x20.27 back). SPY's 2025-01 is
  **0 bars** against Alpaca's 20. AZO's "2y" pull is mostly 2019–2022 with a hole from 2022-07 to
  2026-06; **KMX ends at 2024-12**. Frozen `o=h=l=c` counts in one 2y daily pull: WMT 181,
  JNJ 180, AZO 147, XOM 130 — which is what SAGE was vetoing. Alpaca, same probe: `max/1d`
  **2,679 bars = 10.65y, 0 frozen**; `2y/1h` **8,006 bars = 2.00y** against Webull's 0.69y.

- **HAWK and SAGE decide for real now — and they have opened nothing. 2026-08-26 → 08-30.**
  47 new `Counterfactual` rows, every one `aiBackend = "cli"`: **44 no-consensus, 6 SAGE veto,
  0 fills.** This is the first stretch in the project's history where the analysts actually
  decided rather than the mock path deciding for them, so the arm recorder is finally
  collecting the sample §4b and `/scoreboard` were built for. Do **not** read it as evidence
  that the team is appropriately cautious: **5 of the 6 vetoes are about the bar data, not the
  setup** — SAGE is rejecting frozen placeholder prints (`o=h=l=c`, volume 0.23x average,
  multi-month calendar gaps) in the live weekly series, which is the same corruption
  `loadPanel` was taught to drop on 2026-08-25. The live path never got that guard. Next
  entry.
- **The live bar feed is broken, and the market gate is inert because of it. Found 08-30.**
  `fetchCandles("SPY", "2y", "1d", 300)` — the exact call `readMarketGate` makes — returns
  **731 Webull bars whose closes run from $20.67 (2023-08-10) to $769.35 (2026-08-28)**:
  635 of the 731 are below $500. That is not SPY's history at any split adjustment; it is a
  spliced or mis-adjusted series. The consequence is arithmetic: SMA200 computes to **356.49**
  against a $769 close, so `benchAbove` is **true unconditionally** and the one regime leg that
  survived the panel (f890a9d) can never fire. Every gate line since it shipped reads
  `market gate risk-on (SPY 769.35 > SMA200 356.49)`. The gate is not wrong about today's
  regime — it is incapable of being wrong, which is the same thing as not being on. The
  research path is unaffected: it reads `.cache/bars/sp500-1d.json`, never a live fetch.

- **`gap-fade` closed — the last live mechanism. 2026-08-26**,
  `docs/quant/2026-08-26-gap-fade-open-fill.md`. New `ExitOptions.entryAt` lets a rule fill
  at the bar OPEN (stop sized off `atrs[i-1]`, since ATR at i includes bar i's own range;
  entry session managed). Given the price it actually describes, `gap-fade` **loses to the
  control median on both panels** (−0.045 S&P 500, −0.017 broad) against +0.012 at the close
  fill — pre-registered to need MORE than +0.012 to survive. So buying the gapped open is
  0.055R worse than buying that session's close: the edge was never "fade the gap", it was
  "let the gap session finish, then take the reversion", and that version still only loses
  less than random. A `-nomanage` diagnostic prices the intrabar ambiguity at ~0.001R, which
  **closes intraday bars as a response to this** — see §4g.
- **Replicated on a disjoint universe. 2026-08-26**,
  `docs/quant/2026-08-26-broad-universe-rerun.md`. The same six mechanisms and the same
  baseline, re-run unchanged on `.cache/bars/broad-1d.json` — 1,172 liquid US common stocks
  sharing **not one ticker** with the S&P 500, same calendar, same folds, same `PANEL_SEED`.
  **Not one verdict flipped.** The baseline loses to the control median in 5/5 folds there
  too; the same five mechanisms fail; `gap-fade` passes again. So the eleven null results were
  never a statement about where we were looking. Changing the universe is now closed as a
  direction, and `decideSetup()` is closed as a research subject — §4g.
- **The baseline entry rule loses to random. 2026-08-26**, `scripts/mechanism-screen.mts`,
  full table in `docs/quant/2026-08-26-mechanism-screen-results.md`. Against the matched
  random control — same symbols, same trade count, same long/short mix, same exits, same
  costs, only the entry timing randomised — `decideSetup()`'s avgR is below the control
  **MEDIAN in all five folds** (−0.003/−0.034/+0.010/−0.024/−0.014 vs med
  +0.010/+0.067/+0.032/+0.001/+0.014). Not "roughly zero", which is how it was recorded
  before: **negative-value entry timing, in every fold, including the two it was built on.**
  Everything tuned around it — the exit ladder, the 13 vetoes, the market gate — was tuned
  around that. Read this before spending another round on the same rule.
- **Six new entry mechanisms screened. 2026-08-26**, same run.
  `nr7`, `turn-of-month`, `vol-dryup`, `range-expand` — **do not re-tune**, all failed on the
  screening folds (fit/select). `gap-fade` is the only row beating the control
  p95 in 5/5 folds, but its raw avgR is negative in 4/5 because its control is negative too:
  an information result, not a tradeable one, and its entry fills at the CLOSE of the gap bar,
  which is the wrong price for the mechanism. Open, undecided — §4g.
- **CORRECTION 2026-09-05 — `mr-down3` was not one of the five.** This line read "all failed
  on the screening folds" for ten days and hid the only interesting row in the log.
  `mr-down3` (long after 3 consecutive lower closes, **zero fitted parameters**) fails
  **SELECT only** — the single 2019 melt-up year whose control median is +0.146 against FIT's
  +0.078, the same fold that killed the ATR trail. Its margin over the control median, from
  `scripts/mechanism-screen-control.log` and `mechanism-screen-broad-control.log`:

  | fold | S&P 500 (491 names) | broad (1,172 names, zero ticker overlap) |
  |---|---|---|
  | FIT | +0.002 | +0.012 |
  | SELECT | −0.013 | −0.014 |
  | TEST1 | +0.056 | +0.033 |
  | TEST2 | +0.010 | +0.011 |
  | TEST3 | +0.047 | +0.034 |

  Beats the control median in **9 of 10 cells across two ticker-disjoint universes**, with raw
  avgR positive 5/5 on both — against a baseline that loses to the median 10/10 and a
  `gap-fade` that beats the control while losing money. **Three of those four winning cells
  are TEST folds whose numbers have now been read**, so it could not be selected from them
  without spending the hold-out. That is what `scripts/deep-holdout.mts` exists to settle, on
  pre-2016 data no fold has ever touched — §4g.
- **Stocks-only pivot finished.** Gold/forex/crypto/options desks and watchlist seeds gone.
- **All 13 confluence filters rejected** IS/OOS — loop closed (§5),
  `docs/quant/2026-08-23-confluence-filter-sweep-results.md`.
- **Exit-geometry sweep**: ATR **trail 1.5/1.5 passed the full protocol**, and stayed passing
  after `score()` was risk-normalised to compute PF over R rather than lot-1 dollars.
  Evidence only, **shipped nowhere** — §4d and
  `docs/quant/2026-08-24-exit-geometry-sweep-results.md`.
- **Research pipeline rigor** (86d489b → 565fd55): approval gated on a held-out blind test
  that fails **closed**; #7, #28 and **research-29** retro-demoted by
  `revet-research-strategies.mts`; each candidate sweeps and carries its own `exitLadder`.
  Desk #11 is off research-29.
- **The loop can now pick the validated trail** (a70c1c4). `sweepLadder` selects on **avgR**,
  not dollar PF. Two side effects worth knowing: **1.0 and 1.2 are gone from
  `LADDER_TP_MULTS`** (sub-1:1 against the 1.5 ATR stop, so §4c is legacy-only), and the old
  `profitFactor ?? -Infinity` had ranked a zero-loss ladder strictly *worst* — no trail could
  ever have won that comparison.
- **Blind-test gate was broken; fixed** (0c43b2e). Cause was **silent provider truncation**,
  not the 400-day floor: Webull caps every request at 1200 bars (~256 days at `1h`) and
  `fetchCandles` accepted that short response as data, so both `DEEP_RANGES` hit the cap and
  **every intraday candidate was rejected forever** — non-deterministically, since the verdict
  followed whichever flaky provider answered. `fetchCandles` now takes `minDays` and treats a
  short response as a miss (Yahoo stays last, so genuinely young listings still return).
  `runBlindTest(212)` returns **236 held-out trades / 3981 bars / 364 days**.
- **Mock cycle cut, both halves.** Research (4dd946d): `isBankableRound` fails closed on a
  mock-proposed round — banked `skipped` with zero strategies instead of persisting the
  `Mock *` snippets as approvable research (manual candidates exempt). Backlog purged: 87 rows
  matched by **exact code** against `mockCandidates()`, the 34 still approved demoted, none
  live on a portfolio. Desk (8cbfea0): `runTradeTick` returns **`no-ai-backend`** instead of
  opening, and both *mid-flight* fallbacks refuse the same way — the SAGE one had been turning
  the risk veto into a rubber stamp exactly when risk review was unavailable. `manage.ts` has
  no AI dependency and is untouched, so open positions still exit normally.

- **Validation replaced with a walk-forward panel** (70fcec6) — the whole of §4f and the §6 window-policy
  blocker, closed. `docs/PROPOSAL-panel-validation.md` is now a record of what was built, not a
  request. Seven steps, all shipped:
  `panel.ts` (491-symbol cache, five disjoint folds, 250-bar Wilder warm-up, never falls back to
  a live fetch) · entry/exit separation in the sweep · `control.ts` (matched random-entry control
  + monthly block bootstrap, both on a fixed `PANEL_SEED` so a verdict reproduces from the cache
  alone) · research fits on **FIT 2016-2018** and is gated on **SELECT 2019** ·
  `runBlindTest` measures **TEST 2020-21 / 2022-23 / 2024-26** and requires **all three**, ANDed
  not averaged (research-29 is why) · a `validation` column with `getResearchStrategy` as the
  single enforcement point · the rotation moved to weekly.
  Three things worth carrying forward:
  **(1)** the proposal's expanding-window layout was *not* shipped — split 3's TRAIN contained
  splits 1-2's TEST windows, so a candidate required to pass all three splits would have been
  fitted to the folds it had already survived. One FIT + one SELECT + three later TEST folds is
  the only layout that keeps every TEST fold untouched at once.
  **(2)** a round measures **8-10 min**, not the 1-2 h the proposal estimated, so weekly rests on
  **multiple testing** (3/week ≈ 156 tests/yr vs 3/day ≈ 1,100 against a p95 bar), not on cost.
  **(3)** every removed parameter **refuses** rather than being ignored: `runResearch` lost its
  `symbol`/`interval`/`range` params, `POST /api/research` 400s on them, the UI pickers are gone,
  and seven `scripts/dispatch-*.ts` one-offs were deleted (git retains them).
  Tests: **356 pass / 0 fail**; `panel.test.ts` asserts the folds are disjoint and correctly
  ordered, so the layout cannot drift silently.
- **First real research round** — run **#110**, 08-25, fired through Task Scheduler:
  `status: done` with three novel mechanism labels. The proposer had never actually run
  before; all 109 prior rounds banked mocks. All three were rejected by `autoReview` on 4–5
  trades, which is the in-sample gate working. **Trap: `costUsd = 0` no longer proves a round
  was mock** — the CLI backend bills $0 too. Check labels against `mockCandidates()` instead.
- **Blind-test pass bar raised** (158df23). It ran, but asked almost nothing: ≥20 held-out
  trades and `expectancy > 0`, which passed a candidate that fell from **in-sample avgR 0.63
  to held-out 0.063**. `evaluateHoldout` now also requires held-out PF ≥ `MIN_PROFIT_FACTOR`
  (the same 1.1 `autoReview` applies in-sample — asking it only of the fitted half was asking
  the easy question twice) and held-out ≥ **50%** of the in-sample edge
  (`MIN_HOLDOUT_RETENTION`), compared on **avgR** where both sides have it because dollar
  expectancy scales with the period's ATR level. 0.5 was **pre-registered before looking at
  any further candidate** and is the conventional walk-forward bar, chosen for being
  conventional rather than fitted here. The 6 legacy approvals were *not* re-vetted against
  it — they have no blind test at all (§4b).
- **Runtime moved local** (6eab8bf). Both Actions `schedule:` triggers are commented out
  (`workflow_dispatch` kept, and each file carries its re-enable condition); `vercel.json`
  crons were already `[]`, so **nothing in the cloud can open a trade or bank a strategy** —
  Vercel is the read-only UI. (`cleanup-signals.yml` is still scheduled weekly by design; it
  curls Vercel for pure DB maintenance and decides nothing.) The backend was verified by a
  live `callAgent` returning `cli:haiku`, *not* by a `claude --version` probe, which passes on
  an expired login. Three scheduled tasks remain, all intended: `Stocks scan` 05:00,
  `Manage positions` /15min, `Research round` 06:00; the four dead desk tasks are
  unregistered. `~/.local/bin` is on the persisted **User** PATH, so Task Scheduler resolves
  the CLI too.
- **The survivor condition is now readable from three places** — it was previously derivable
  only by reading `adapter.ts`. It is `status="approved" AND validation="panel-v1"`, and it is
  unforgeable: `applyBlindTestVerdict` rewrites status to `rejected` on anything short of
  `passed` on all three TEST folds, **errors included** (fails closed), and
  `adapter.getResearchStrategy` filters on the same pair — so the desk stays safe even if
  nobody looks. `scripts/list-survivors.mts` (new) prints per-fold TEST numbers and, crucially,
  **splits rows that failed the bar from rows whose gate never completed** (a mid-run
  `NeonDbError` fails closed to `rejected`, which is correct but is *not* a verdict — those are
  re-runnable). `runScheduledResearchRound` logs the same per-fold lines and now labels its
  in-sample numbers `fit=[...]`; bare FIT numbers next to `[approved]` read as evidence for the
  approval when the evidence is the fold lines. `/research` renders the three states distinctly.
  `list-approved` tags each row DESK-ELIGIBLE / not eligible. **Live state 08-25: 0 survivors,
  0 `panel-v1` rows, 6 legacy approvals.**

- **The panel cache was serving fake bars, and one of them owned a whole fold.** Found while
  measuring the market gate: TEST2's avgR read **-8,952,720**. Cause was three trades on frozen
  placeholder bars (`o==h==l==c`, zero volume) — no range → ATR ~0 → an ATR-multiple stop
  landing ~1e-14 from entry → `pnl/risk` = -5.6e10. The old guard `risk > 0` is not a guard;
  `1e-14 > 0`. The cache holds **1,886 such bars across 6 symbols** (PARA 946 including a run of
  **652 consecutive**, FI 421, SMCI 349, CTRA 167, BIIB 2, DXCM 1) out of 1,277,489. Fixed in two
  layers: `loadPanel` drops them on load and reports `droppedBars` per symbol (a gap is the
  truth — the symbol was not trading; interpolating would put invented history inside a TEST
  fold), and `rMultipleOf` in `backtest/engine.ts` requires risk ≥ `MIN_RISK_FRACTION` (1bp) of
  entry, so bad data degrades to `rMultiple: null` — which every consumer already filters —
  instead of a number no average survives. `trading/manage.ts` uses the same helper, so the live
  desk degrades identically. TEST2 now reads **-0.024**. Timing was deliberate: this changes
  every panel number, and the DB holds **0 `panel-v1` rows**, so the blast radius is zero. Only
  the unambiguous shape is dropped — ~98 zero-range-with-volume (halts) and ~310
  zero-volume-with-range (stale quotes) bars are left alone on purpose.
- **Market gate shipped — one leg of the three that were measured.** `src/lib/market/regime.ts`
  (pure: SPY-vs-SMA200, breadth, 20d realized vol) + `scripts/regime-conditional.mts`, which
  buckets all 91,236 baseline trades across all five folds by the regime on their **entry** day.
  Verdict, in `scripts/regime-conditional.log`:
  **SPY vs its own SMA200 is the only leg that survives** — avgR above/below is
  `+0.017/-0.071` (FIT), `+0.002/-0.293` (SELECT), `+0.012/-0.004` (TEST1), `+0.018/-0.077`
  (TEST2), `-0.004/-0.109` (TEST3): same sign 5/5. **Breadth and realized vol both fail** (§5).
  `marketGate.ts` ships that one leg, wired into `scanUniverse` **before** the universe fetch and
  logging its reading on every scan; kill switch is the `marketGate` setting (`"off"`).
  Three things to carry forward: **(1)** the surviving feature is the only one with **no free
  parameter to fit** — "above its own trailing mean" is self-normalising, and the two features
  with a number in them are the two that died. **(2)** it **removes a loss, it does not create an
  edge**: gated fold avgR is `{+0.017, +0.002, +0.012, +0.018, -0.004}`, i.e. ~0, and TEST3 is
  still negative. **(3)** it fails **open** — a blind benchmark passes slots through with a
  `BLIND` log line, because a data outage silently halting the desk is worse than missing a
  filter worth ~0.02R. Opposite of how the research gates fail, and intentional.

## 4. Next steps, highest value first

**(a) and (f) are both resolved** (§3). Research and every blind test read
`.cache/bars/sp500-1d.json`, so the provider's window policy no longer decides what a stored
`backtestSummary` means; and as of 2026-08-30 the live path is on Alpaca, drops placeholder bars,
and the gate refuses a series it cannot believe. **(b) is the top of the list**, and §0 records
what the first completed panel round did to it: the eligible pool is still empty, but it is now
empty because three candidates were tested and lost, not because the gate had never run.

### 0. The panel gate ran, and it works — **DONE 2026-08-31**

Owner's chosen direction on 2026-08-30 was **"unlock the research round first"**. Both halves are
now done: the Task Scheduler block (§6) and, on 08-31, the AI budget came back and a hand-run
round completed. What it produced:

```
research run 112: panel 491 symbols — fit 474, select 476
run #112 status: done
research-216 [rejected] "MACD Momentum Continuation"        fit trades=3     win 100%  pnl $1
research-217 [rejected] SAFETY-FLAGGED "RSI Extreme Reversion"  fit trades=8401  win 48.7%  pf 0.70
research-218 [rejected] "Volume-Confirmed Range Breakout"   fit trades=363   win 48.2%  pf 0.23
```

**The result worth keeping is not the three rejections — it is `status: done`.** No panel round had
ever completed before, so "the pool is empty" had two possible causes: a strict gate, or a gate
that had never run. It was the first.

**All three rejections are correct, and none of them was decided by the numbers printed above.**
`runResearch.ts:311` decides `status` on `selectRun.summary` — the SELECT fold, 2019, held out from
the refinement loop and the ladder sweep — while the row stores `backtestSummary = swept.summary`
(FIT) and the round prints that. On the numbers that actually decided:

| | SELECT 2019 | verdict |
|---|---|---|
| research-216 | **0 trades**, 0/476 symbols | fires essentially never; rejected on the trade floor |
| research-217 | 2869 trades, **avgR −0.040**, PF 0.777 | a real anti-edge, and safety-flagged besides |
| research-218 | 90 trades, 85/476 symbols, **avgR −0.407**, PF 0.549 | thin participation, badly negative |

Do not read them as a market finding — they are the proposer producing weak candidates, which is
expected and cheap. But do read the *pattern*: not one of the three survived contact with a single
held-out year, and 216 could not even fire.

**The reporting defect this exposed — both halves FIXED 2026-08-31, before any new round:**

1. **The headline numbers were not the deciding numbers.** The round printed `fit=[…]` and the row
   stores the FIT summary, but approval is decided on SELECT. That is why 216 read
   "trades=3 win 100%" when its actual verdict was "0 trades in 2019" — anyone reading a round
   without knowing that would re-tune against the wrong fold. Fixed: `strategyResultLine`
   (`scheduledResearch.ts`, tested in `scheduledResearch.test.ts`) reads SELECT back out of
   `iterations` — the one place `runResearch.ts:301` persists it — and leads with it. FIT stays on
   the line, after SELECT and labelled, because FIT-strong/SELECT-collapsed is the overfit
   signature worth seeing; it just must not be read first. Run #112 now renders as:
   ```
   research-216 [rejected] "MACD Momentum Continuation" select=[trades=0 symbols=0/476 win%=0.0 avgR=— pf=—] fit=[trades=3 win%=100.0 pnl=$1 pf=—]
   research-218 [rejected] "Volume-Confirmed Range Breakout" select=[trades=90 symbols=85/476 win%=31.1 avgR=-0.407 pf=0.55] fit=[trades=363 win%=48.2 pnl=$-150 pf=0.23]
   ```
2. **`list-survivors.mts` could not tell a pre-blind-test rejection from a TEST-fold one.** It
   bucketed on `blindTest.error`, so a row rejected before the gate (`blindTest = "{}"`) landed
   under **FAILED THE BAR** reading `0 reason(s): (no reason recorded)` — indistinguishable from a
   candidate that genuinely lost out-of-sample, which is how all three of run #112's rows were
   filed. Fixed: `classifyPanelRow` (`blindTest.ts`, tested) names the three ways a row can read
   rejected — `failed-bar` / `blind-test-incomplete` / `never-reached-gate` — and the script grew a
   fourth section that prints the SELECT line as the reason.

Note also that the dollar columns in a fixed-lot backtest are not the ones to read: `runResearch.ts`
already selects on avgR precisely because a fixed 0.1 lot makes expectancy and profit factor weight
each trade by its own stop width. `autoReviewStatus` still gates on `expectancy`/`profitFactor`,
which is a live inconsistency — it did not change any verdict here (all three were negative on avgR
too, or had no trades) but it will eventually.

### 0b. Direction, decided 2026-08-31: **stop researching entries; research exits and risk**

> **Flagged 2026-09-03 — evidence now cuts against the first half of this heading.** The premise
> was that the entry space is exhausted, so effort should move to exits. The lateness run says the
> entry rule is not merely edgeless, it has *negative* selection value at the bar level (30 of 30
> control cells), and that entering the same names earlier beats random by ~+0.18R at three bars.
> That is an entry finding with a specific, untried direction — **reduce confirmation lag** — which
> is the opposite of what the 13 confluence filters did. It also does not rescue the second half:
> `runControl` shares its `exit` object with the rule, so the gate cannot credit an exit's
> standalone value and "research exits" has no valid null until a second control exists. Both
> halves of this direction need re-deciding. **That decision is the owner's, not the agent's — this
> paragraph records the evidence, it does not overturn the choice.** See
> `docs/quant/2026-09-03-entry-lateness.md`.

The question was genuinely open — (b) says the eligible pool is empty, (g) says the daily-OHLCV
mechanism space is exhausted across two disjoint universes — and the owner chose deliberately.
Writing another entry rule is the low-value move: run #112 is a fair sample of what the proposer
generates unprompted, and the track record is one-sided.

| entry-rule research | exit / risk research |
|---|---|
| cross-sectional mean reversion — rejected | ATR trail 1.5/1.5 — **passed IS *and* OOS, 10/10 weekly years** |
| cross-sectional momentum — rejected | |
| 13 confluence filters — all failed OOS | |
| Donchian / breakout — dead on gold | |
| run #112's three — none survived one held-out year | |

The one change that ever cleared a full IS/OOS gate in this project was a change to exit geometry,
not to an entry. The baseline itself is weak (trend-pullback, ~+0.04R/trade at t=1.08 OOS on weekly
bars), so the aim is not a new signal — it is to find whether exits, position sizing, or a regime
filter can lift what the existing signal already produces.

**The proposer was re-aimed on 2026-08-31 — and doing it surfaced a hard limit that changes what
"research exits" can mean here.**

**The proposer cannot express an exit rule or a position size. At all.** A candidate's code returns
`{ side, note } | null` per bar, and `adapter.ts:134` consumes exactly `?.side` — nothing else it
returns reaches the backtest. Exits come from `sweepLadder` over the six fixed `LADDER_OPTIONS`
(4 TP mults + 2 ATR trails), and the backtest lot is a fixed `0.1` (`engine.ts:414`). A brief asking
for a trailing-stop variant would produce a candidate that cannot implement one, and the round would
silently measure whatever entry rule the model wrote instead. So the chosen direction splits into
three separate pieces of work, only one of which lives in the proposer:

| | reachable via the proposer? | what it actually takes |
|---|---|---|
| **Trade geometry / entry timing** | **yes** — done, see below | brief + angles; no engine change |
| **Exit geometry** | no | widen `LADDER_OPTIONS` in `runResearch.ts:110`. No AI involved. Note the ladder is already picked per candidate on FIT, so every option added is another draw against the same fold — widening it is a multiple-testing decision, not a free improvement |
| **Position sizing** | no | the engine must size to risk (`riskUsd / slDistance`, as `computeLot` already does live) before sizing is measurable at all |

What *is* expressible is which bar the trade opens on — and that is not cosmetic: entry price
relative to a 1.5-ATR stop sets the R of every trade that follows. That is genuine risk geometry
inside the existing contract, and it is what the rotation now asks for.

**Changed:**
- `propose.ts` hardcoded `"one momentum, one mean-reversion, one breakout"` into the candidates
  prompt. That sentence outranked the brief: re-aiming the loop by editing rotation text alone would
  have been close to a no-op, because the prompt would have pulled the candidates back to entry
  rules regardless. The diversity axis is now the caller's (`candidatesPrompt`, `angles`), threaded
  rotation → `runResearch` → `proposeCandidates`, and dropped on a manual override.
- `RESEARCH_ROTATION` went from four entry-mechanism slots (momentum / mean-rev / trend-pullback /
  volatility) to two trade-geometry slots — `stocks-entry-timing` and `stocks-trade-geometry` — each
  naming three explicit angles, all varying the *same* trend-pullback baseline.
- **Regime filters are deliberately not in the rotation.** That is the confluence-veto family swept
  IS/OOS on 2026-08-23: 13 tested, all rejected, and all three pre-registered picks flipped sign out
  of sample. Proposing them through the AI loop would spend a round re-deriving a closed result.
  There is a test asserting the rotation text never names them.

**Both rotation entries were replaced on 2026-09-03, and the sentence that used to stand here was
wrong twice over.** It said the 09-06 round would run `stocks-entry-timing`; `pickRotationEntry`
keys on `floor(Date.now()/MS_PER_WEEK) % 2`, which lands on **index 1** that week — the round was
going to run `stocks-trade-geometry`. Do not restate a rotation pick from this file without
evaluating the function. Both entries were compromised anyway:

- `stocks-entry-timing` asked for "require one confirmation close" and "wait for a pullback back
  toward the trigger bar's extreme". The 09-03 lateness result predicts both fail — the rule
  already commits late — and its third angle was the baseline itself. **Replaced by
  `stocks-entry-anticipation`**, which requires a candidate to fire *at or before* the baseline's
  trigger bar and forbids adding a test that must pass first. That is the one bar-based direction
  the evidence points at, and it is not the same as loosening a threshold (§6-8 of the study).
  **Then removed entirely on 2026-09-05**, after §9 tested that direction and closed it: four
  pre-registered anticipation pairs, no candidate, and the pad that predicted the baseline's own
  trigger *better* scored *worse*. Owner's call, taken 2026-09-05 — option (1) of three, the other
  two being engine work. **The rotation is now a SINGLE entry, `stocks-trade-geometry`**, and it is
  deliberately not being kept full: nothing replaced the entry slot because nothing that could
  replace it is expressible as a brief. A rule reaches the panel as `(i) => "long" | "short" | null`
  over a `ScanSnapshot`, which is price and volume only, so both remaining directions — a different
  data class, and exits — are engine work. A one-entry rotation repeats the same axis weekly, which
  is correct while one axis is open; the panel gate is what stops a repeat banking a duplicate.
  A test now asserts the rotation is never empty: at length 0 `pickRotationEntry`'s modulo is NaN,
  it returns `undefined`, and the weekly cron throws on `pick.brief` — indistinguishable from a bad
  round. Verified by evaluating the function, not by reading this file: 2026-09-06 picks
  `stocks-trade-geometry`.
- `stocks-trade-geometry` kept its brief but lost two angles: "small trigger-bar range relative to
  ATR" is `nr7`, already screened and rejected on both universes, and "scale participation by where
  the entry sits inside the trigger bar's range" asks for **position sizing, which the proposer
  cannot express** — the same limit this section's own header warns about. Replaced with two
  stop-versus-target geometry angles that a `{ side } | null` rule can actually implement.

A new test asserts the rotation never asks for another entry confirmation, so the refuted angle
cannot come back quietly. Nothing about the gate changed — the bar to beat is still ~+0.04R at
t=1.08. 492/492 tests pass.

**Costs no AI, still open:** `git rm -r --quiet rl mt5-bridge/__pycache__` (§6), and settling why
desk #11 runs `combo-vote` rather than `trend-pullback` (§6 — whichever is intended, the other is a
silent mismatch). Also unpushed: **23 commits** on `stocks-only-pivot` — pushing has not been requested.

### a. ~~Fix the live bar feed~~ — **RESOLVED 2026-08-30**, see §3

Both halves are done: the live path prefers Alpaca, `sanitizeResponse` drops frozen prints before
any consumer sees them, and `gateSlots` takes its BLIND branch on an implausible benchmark rather
than reporting a reading off a broken series. Re-probe with `fetchCandles("SPY","2y","1d",300)`
— a healthy answer is ~500 Alpaca bars whose closes stay inside a plausible band.

Two things survive this item and are worth keeping in view:

**Webull's window policy is unchanged and still wrong**, it just no longer decides anything.
`rangeToWebullCount` (`src/lib/webull.ts:53`) asks for **N bars counted back from now**, not a
date range, so the window slides one bar per trading day and a range label is never the same
series twice; **1200 bars is a hard cap** (higher `count` → 417 `ILLEGAL_PARAMETER`,
`timestamp`/`endTime` ignored, no paging). Do **not** re-cite the old Yahoo bar-count numbers —
Yahoo is only the tail fallback.

**Webull is still second in the chain, not deleted.** With Alpaca healthy it is never reached for
a US equity, and the two guards above catch the shapes that hurt. Removing it outright is a
reasonable call — it is the only provider here that is also the broker, which is the only reason
it is still there — but it should be taken explicitly, not by leaving it first.

Also unfixed and harmless: strategy **212 is still `rejected`** on the old data error — a smoke
test, not a verdict.

### b. The approved pool is empty — now literally, not just effectively

As of the panel change every row carries `validation = "legacy-single-symbol"`, and
`getResearchStrategy` requires `panel-v1`, so **no research strategy can be attached to a desk at
all** until one passes a panel round. That is intended. The older statement of the same problem:
the 6 surviving approvals are on **BTC-USD, GC=F, NG=F** — instruments the pivot removed —
and **not one has a blind test**. There is no validated stock strategy at all. Decide whether
the 6 get demoted as off-universe or re-validated on stocks; do not read "6 approved" as "6
usable". Until the loop produces one, the other route is a hand-authored candidate through
`runResearch`'s `manualCandidates` path.

### c. Retire the legacy 0.8:1 research ladder — legacy rows only, now

New candidates can no longer be assigned a sub-1:1 ladder. What is left: `RESEARCH_ATR_TP_MULT
= 1.2` / `SL 1.5` (`src/lib/trading/engine.ts:49-51`) is still `resolveExitOverride`'s
fallback for rows persisted before `exitLadder` existed, and `LEGACY_TP1_MULT` is the same
fallback in `blindTest.ts` — though that one is nearly dead, since only pre-ladder rows reach it
and every pre-ladder row is `legacy-single-symbol`, which `runBlindTest` now refuses outright.
Backfill those rows by re-sweeping, or refuse to activate a row without a ladder. Do **not** simply swap 1.2 → 2.5: that variant failed OOS as a pick. The
defensible claim is only "0.8:1 is measurably bad".

### d. Decide whether the desk's own default exit becomes a trail

**Reweighted 2026-08-26 and probably not worth doing yet.** The trail's +0.021 avgR was
measured on top of an entry rule now shown to be worse than random (§3). A better exit on a
negative-value entry is still a negative-value strategy, so this is a refinement of the wrong
layer. It stays on the list because the measurement is sound and cheap to ship later; it
should not be worked before §4g.

**`resolveExitOverride`'s no-override path and the backtest engine's `ATR_TP_MULT` are
untouched** — a built-in strategy like desk #11's `combo-vote` still exits on the 1.5/2.5
ladder. On weekly, the desk's timeframe, the trail is +0.021 avgR and ~36% more trades.
Blockers: idealised stop fills (gaps aren't modelled, and a trail hits its stop far more often
than a ladder) and survivorship bias in `.cache/bars/sp500-1d.json`. `1.0/1.5` performs nearly
as well — do not present 1.5/1.5 as an optimum.

### e. Unswept: the ADX-descending candidate ranking in `runScan.ts` (697b295)

It replaced alphabetical order — better, but never swept as a ranking.

### f. ~~The validation set is too small AND not held out~~ — **RESOLVED 2026-08-25**, see §3

Both findings (median 4 trades per candidate; the blind test overlapping its own training window
by 66%) are fixed by the panel. The measurements that motivated it — the per-window %-up /
correlation / N_eff table, and the AAPL overlap arithmetic — are preserved in
`docs/PROPOSAL-panel-validation.md` §1, which is where to look before re-deriving any of it.

What is left of this item, and it is not small: **the pool is empty by construction.** Every
existing row is `legacy-single-symbol`, so nothing is desk-eligible. The next step is to run a
panel round and see whether anything clears a bar that is, deliberately, much harder than the
one the 6 legacy approvals cleared. Expect most rounds to produce nothing; that is the gate
working, not a fault. **Check with `npx tsx scripts/list-survivors.mts`**, not `list-approved` —
approved alone is not the survivor condition (§3).

### g. Change the input, not the rule — **run 2026-08-26, ANSWERED: it was not the universe**

Ten mechanisms across five families had been measured against the matched control and none was
tradeable. All ten were functions of daily OHLCV, and all ten were measured on the 491 most
heavily analysed securities on earth. So the input was changed rather than the rule.

`scripts/cache-broad-universe.mts` built `.cache/bars/broad-1d.json` — **1,172 liquid US
common stocks disjoint from the S&P 500** (5,196 candidates from the NASDAQ symbol directory,
floored at $2M median daily dollar volume and $5 close, sampled by an alphabetical stride so
the kept set is not just the next-largest caps). Alpaca SIP, `adjustment=all`, span
2016-01-04..2026-08-25 — identical to the existing panel, so `FOLDS` and `PANEL_WARMUP_BARS`
transferred unchanged. The same six mechanisms, same baseline row, same folds, same ladder,
same `PANEL_SEED`, same `--control=200`, via the new `--panel=` flag on
`scripts/mechanism-screen.mts`. Only the universe differed.

**Result — `docs/quant/2026-08-26-broad-universe-rerun.md`. Not one verdict flipped.**

- **The baseline is dead independently of universe.** It loses to the control MEDIAN in 5/5
  folds on the broad panel too (−0.024 / −0.119 / −0.016 / −0.011 / −0.042 vs the S&P 500's
  −0.019 / −0.112 / −0.030 / −0.033 / −0.034). Ten fold-cells, two symbol sets with zero
  overlap, never once positive. The pre-registered consequence, written before the run, was
  "no further work belongs on it". **`decideSetup()` is closed as a research subject.**
- **`gap-fade` replicated** — positive margin in 10/10 cells across both universes, and again
  the only mechanism passing BOTH screening folds. Caveats in §5 and in the doc.
- **The other five failed again, identically.** Do not re-tune them.
- **Changing the universe is now itself closed.** Two disjoint equity universes produced the
  same answers throughout, so further universe-swapping on daily OHLCV should not be funded.

**Correction to how this was framed earlier in the day:** "find data without survivorship
bias" was the wrong reason. The matched control re-places entries within the SAME symbols, so
a name that is only in the cache because it survived and tripled helps the rule and the
control equally — the margin was already survivorship-neutral, and broad-1d.json is in fact
*more* survivorship-biased than sp500-1d.json, because small caps delist far more often. The
real reason to change the universe was arbitrage intensity, not bias. Read margins off that
panel; never levels.

**The last thread, and it is now closed too.** `gap-fade` was re-run under a corrected fill
(`entryAt: "open"`) the same day and **failed against its own control on both panels** —
`docs/quant/2026-08-26-gap-fade-open-fill.md`. The pre-registration required it to beat
+0.012; it printed −0.045 and −0.017. **Intraday bars are closed as a response to this**: the
`-nomanage` diagnostic shows the same-session ambiguity daily bars cannot resolve is worth
~0.001R against a −0.045 effect, so a 5m/15m pipeline would settle a rounding error and could
not turn a negative fill-price result positive. If intraday data is ever built it must be
justified by a NEW mechanism that needs it, never by this one.

**Where that leaves the programme:** ten mechanisms, five families, two disjoint universes,
one corrected fill — nothing tradeable, and `decideSetup()` itself worse than random in 10/10
fold-cells. There is no candidate left to promote and no queued direction that the evidence
supports. That is a real state of the project, not a gap in it, and the next direction should
be chosen deliberately rather than inherited.

**SUPERSEDED IN PART, 2026-09-05.** The sentence above — "no candidate left to promote" — was
written from a summary that had `mr-down3` in the failed list, and it was wrong. `mr-down3`
failed SELECT only, and on 2026-09-05 it **passed a pre-registered hold-out on 1998–2016 Yahoo
data no fold had ever touched**, median 3/3 and p95 3/3, with the survivorship objection
measured and dismissed — §3, `docs/quant/2026-09-05-deep-holdout.md`. Everything else in this
section stands: the baseline is still dead, the other mechanisms still failed, and swapping the
universe is still closed. What changed is that there is now exactly one live candidate, and the
open question about it is **position sizing and same-day signal selection at ~5 whole-share
slots**, not another entry rule.

**UPDATED 2026-09-08 — the weekly-bar screen adds a second live candidate, and both now have
the same next step.** `scripts/weekly-mechanism-screen.mts` re-ran the same six mechanisms,
unmodified, on weekly bars at the only fill the owner can trade (§3). `mr-down3` and
`gap-fade` both cleared the promotion bar; the other four did not and are not to be re-tuned.
**Next step, named by the script's own header: read the survivors' TEST rows, then write a
separate pre-registration before spending the deep hold-out.** Neither is done yet — TEST is
still unread for either mechanism on weekly bars, and the deep fold stays untouched until that
pre-registration exists.

## 5. Traps — read before touching these areas

- **A raw avgR from the panel carries no information on its own.** Demonstrated three times
  now (regime features, the mechanism screen, then the broad-universe re-run — where
  `turn-of-month`, a rule that reads no price at all, again showed a test-fold avgR of +0.268
  at 70.6% win while failing both screening folds). On this universe 69-87% of names rose in
  every window, so any long-biased rule prints a good-looking number for free. On 2026-08-26
  the three best raw rows were all long-only and all died to the control; `turn-of-month`,
  which reads **no price at all**, showed test1 avgR **+0.355 at 75.5% win** against a control
  p95 of +0.124. Quote the margin over the matched control (`src/lib/research/control.ts`) or
  do not quote the number.
- **Yahoo treats `interval` as a request and `range` as the contract.** `/v8/finance/chart`
  answers `range=max&interval=1d` with **weekly, monthly or quarterly bars** and no error, no
  warning, and no field saying so: AAPL comes back with 169 bars for 42 years, NVDA with 333.
  Every one of those bars is a real, well-formed, correctly adjusted session aggregate, so
  `sanitizeSeries` passes all of them — there is nothing wrong with any bar individually, and
  the only evidence is the SPACING between them. A panel built on such a cache runs every
  indicator, every fold and every control without complaint and reports numbers for a strategy
  nobody could trade. Use explicit `period1`/`period2` epoch seconds (AAPL: 4,048 daily bars
  1999→2016) and check `isDailySeries` from `src/lib/bars.ts` before writing a cache;
  `scripts/cache-deep-history.mts` aborts the whole run on one failure rather than writing a
  file that is 99% right. `fetchYahooCandles` in `src/lib/yahoo.ts` still sends `range=` and is
  correct for the 2-year live pulls it serves — do not reuse it for history.
- **Yahoo has no chart history at all for a handful of live tickers.** Deterministic, verified
  on both `query1` and `query2` and at every window including `range=1mo`: MMC, K, BK and HES
  return `Not Found`, EA and AVB return `Bad Request`. Nothing to retry and nothing to fix —
  the deep cache is 453 of the 491 S&P names for this reason plus ~20 genuinely post-2016
  entities (CARR, OTIS, CTVA, KVUE, GEHC, VLTO, SOLV, GEV, VST, CEG, DOW, UBER, MRNA …). The
  two Yahoo failure codes mean *different* things and both mean "no data, do not retry":
  `Not Found` = no such ticker, `Bad Request` = real ticker, listed after this window.
- **A failure classifier is only as good as the strings it was checked against.** `FATAL_BACKEND`
  in `anthropic.ts` was written from what a dead login looks like and shipped without a test, so it
  missed `You've hit your monthly spend limit` — the one failure most likely to actually happen.
  The result was the worst shape available: no latch, no banner, every call retried and failed, and
  War Room reporting AI online throughout. It was found by **running the thing**, not by reading the
  regex. Before adding a pattern, get the literal string out of the tool; before removing one, ask
  whether the failure it names is retryable. `limit` alone must stay unmatched — a rate limit is
  retryable and latching it is the same bug pointing the other way.
- **`scanner.ts:274`** — a portfolio with a `strategy` key set bypasses `decideSetup()`
  entirely, confluence block included. Filters are unreachable in that path, not merely inert.
- **`--split=all`** in the sweep script has **no held-out half**. It exists only for `--byYear`
  regime checks on an already-chosen variant. Never select anything with it.
- **Do not re-tune the 13 confluence filters, cross-sectional mean reversion, or
  cross-sectional momentum.** All three loops are closed and documented as rejected.
- **Do not re-tune breadth or realized vol as regime features.** Measured on all five folds and
  rejected: breadth is monotone in FIT then inverts in SELECT and TEST3; vol's top bucket is
  consistently bad but its Q1–Q4 ordering holds nowhere. Both died the same way — **FIT-derived
  absolute cut points do not transfer.** The breadth quintile holding 17% of FIT's trades holds
  **79%** of TEST2's, and TEST2's top quintile is empty. A threshold fitted on 2016-2018 is
  measuring a different market by 2022. Evidence: `scripts/regime-conditional.log`.
- **Do not re-tune "regime × trade side" as an edge. Measured 2026-09-03 on all five folds
  with a 200-run matched control, and rejected.** The raw cross-tab looks like the strongest
  regime result the panel has ever produced — `above × long` is positive in **5/5** folds
  (+0.092 / +0.091 / +0.064 / +0.025 / +0.049) against a shipped gate that measures ~0. The
  control erases it: random entries with the same symbols, the same trade count, the same
  long/short mix and the same exits earn **more** (ctrl median +0.110 / +0.136 / +0.109 /
  −0.017 / +0.074), so the rule beats p95 in **1/5** folds and loses in the other four. Across
  all four cells × five folds, only **4 of 20** beat p95 and no cell does it twice in a row.
  This is trap #1 in this section landing on the largest sample we have: **+0.09 in a bull
  regime is beta, and the entry rule contributes nothing on top of it.** Evidence:
  `scripts/regime-by-side.log`, produced by `scripts/regime-conditional.mts --control=200`.
- **What survived that run is an exposure fact, not an edge, and must be labelled that way.**
  Shorts opened while SPY > SMA200 lose in 4/5 folds (−0.113 / −0.209 / −0.136 / **+0.009** /
  −0.104) — and the matched control loses the same amount (−0.114 / −0.087 / −0.104 / +0.024 /
  −0.066). Both halves matter: the cell is a reliable bleed, **and** the rule is not picking bad
  shorts, so there is nothing to improve by tuning the entry. Dropping the cell outright moves
  panel avgR by +0.038 / +0.028 / +0.052 / **−0.035** / +0.028 on 22-32% of all trades. The
  negative fold is TEST2 (2022-23) and it is not noise: in a bear market the stretches when SPY
  sits above its SMA200 are exactly the bounces a short wants. So this is the same *kind* of
  claim as the shipped market gate — a removable loss, not alpha — with one honest cost, and it
  must never be written up as "the desk learned not to short into strength."
- **Adding another entry confirmation makes the rule worse, and this is now measured, not
  suspected.** The baseline entry loses to a matched random entry in 30 of 30 ladder×fold cells,
  and replaying the same signals earlier flips that margin positive at t−2/t−3 in 5/5 folds and
  both exit geometries. The rule's conditions — ADX > 20, a completed pullback, DI alignment, a
  MACD histogram not rolling over — are each true only *after* the move starts. So the 13 rejected
  confluence filters are one result, not thirteen: every one of them added a further condition to
  a rule already committing late. **Any proposal whose mechanism is "wait for one more signal
  before entering" is predicted to fail, and needs a reason why it is different before it gets
  panel time.** Evidence: `docs/quant/2026-09-03-entry-lateness.md`.
- **Relaxing the gate that causes the lag does not recover the lateness gain, and the
  RSI band is the gate.** Measured 2026-09-03. At the bar before a signal onset the RSI
  band is the *sole* refusing gate in **53-58% of onsets in all five folds** (vs ~19%
  alignment, ~13% ADX, ~11% MACD), and in 4/5 the binding end is **RSI > 70** — the rule
  standing aside from a trend that is running. But eight pre-registered relaxations, scored
  on margin over the matched control, leave the margin **negative in every cell**, and the
  three RSI relaxations are the **worst** of the eight (`rsi high 80`: −0.009 / −0.020 /
  −0.035 / −0.051 vs baseline). Shifting an entry earlier keeps the same trades and moves
  only their price; relaxing a gate admits a **new population**, and the control median rises
  with it (+0.018 → +0.036 on fit/single), i.e. the relaxation buys exposure. **Three of the
  eight raise raw avgR while losing to their own control** — trap #1 in this section, caught
  in the act. The one variant that passed selection, **`adx 15`, replicated 6/6 on the
  held-out folds (10/10 overall) with the correct signature** — its control median FALLS
  while its own avgR rises, i.e. the extra bars are ones random entry does worse on — but
  it is worth **+0.009R** and leaves the margin negative in all ten cells. A smaller loss,
  not an edge; the gate asks for a margin over control **p95**. **The ADX floor is set too
  late and that is now replicated; do not read it as an approval.** Evidence:
  `scripts/entry-gate-lag.log`, `scripts/entry-lag-variants.log`,
  `scripts/entry-lag-variants-holdout.log`, and §6-8 of
  `docs/quant/2026-09-03-entry-lateness.md`.
- **Do not propose "fire earlier on the same setup" as if it were untested — and do not
  treat predicting the rule's own trigger as progress.** Measured 2026-09-05, the closing
  test of the entry axis. Four pre-registered anticipation pairs (a pad on the RSI band or
  the ADX floor, each with and without a "closing on the threshold" requirement read from
  bars i and i-1): **no candidate**, best 3/4. The instrument to keep is `lead%` — of the
  bars a variant signals on that the baseline does not, the share followed by a baseline
  signal within 3 bars. On the ADX pad the direction test raised `lead%` from **18.0% to
  31.4%** and **lost** to plain widening in 4/4; on the RSI pad it beat widening 4/4 while
  `lead%` did **not** move (60.1 vs 61.5), having thrown away 69% of the extra signals — so
  it helped by trading less, not by anticipating. *Firing earlier* and *predicting the
  trigger* are different things here, and they point opposite ways. Read together with the
  30/30 control loss this says the baseline's trigger bar is **negatively selected**: a rule
  that homes in on it more accurately inherits the selection. `lead%` is confounded with
  which gate is padded — only the within-gate pairs are clean. Evidence:
  `scripts/entry-anticipation.log` and §9 of `docs/quant/2026-09-03-entry-lateness.md`.
- **The lateness numbers past t−3 are lookahead and must never be quoted as an available edge.**
  `scripts/entry-lateness.mts` shifts entries *k* bars earlier using the knowledge that the rule
  will fire at bar *t* — knowledge you do not have at bar *t−k*. That is most of the +0.635 at
  t−8. What the diagnostic legitimately establishes is direction and mechanism (the loss lives in
  the waiting) and a rough size for three bars of lag on daily data. The desk trades **weekly**,
  where three bars is three weeks; the lag was measured on the daily panel, not there.
- **A wider fixed target is a way of buying drift, and its delta must not be read as an exit result.**
  Measured 2026-09-05: `single 2/1.5`, `single 2.5/1.5` and `single 3/1.5` beat the 1.5/1.5 ladder
  on LONG trades in 4/5 folds and lose on SHORT trades in 5/5 folds each, both halves growing with
  `tp1Mult`. On a panel that drifted up, holding a long target further out collects more drift; the
  aggregate delta is whatever the fold's long/short mix makes of that. `single 3/1.5`'s +0.041 on
  TEST1 is the number to be suspicious of. Any exit claim gets the side split
  (`scripts/trail-is-geometry.mts`) before it is believed; an aggregate delta alone cannot tell a
  mechanism from a mix. Duration is NOT the confound to reach for first — the rank correlation
  between holding longer and delta is negative in all five folds.
- **`runControl` still cannot credit an exit, and must not be changed so it can.** It hands the
  control the *same* `exit` object as the rule, so a better exit lifts both arms and the margin
  barely moves. That is the correct null for an *entry* claim — an entry has to be measured at a
  fixed geometry or it is a claim about two things — and it stays as it is. The second null it
  needed now exists: **`runExitControl` / `exitFoldVerdict` (2026-09-05)**, same entries, baseline
  ladder, paired monthly block bootstrap on the difference. Use `runControl` for an entry change
  and `runExitControl` for an exit change; a proposal that moves both is two claims and gets
  neither gate.
- **The market gate's sample is ~a dozen episodes, not 91,236 trades.** Its variable changes only
  when SPY crosses its 200-day mean. Five folds of ONE benchmark series are not five independent
  observations. Never quote the trade counts as the evidence base.
- **`MIN_RISK_FRACTION` exists because `risk > 0` let 1e-14 through.** Do not relax it, and do not
  "fix" a null `rMultiple` by winsorizing — null means the trade cannot be measured in R, which is
  the honest report of a bar that never traded.
- **Live trading cannot measure an edge.** 5 slots on weekly bars ≈ 15–25 closed trades per
  8 weeks; sd(R) ≈ 1.39 → SE ±0.31R against an effect size ~0.04R. n comes from the sweep
  harness, not from waiting. Live runs verify plumbing, nothing else.
- **Blind-test a research strategy before approving it — every time, without asking.**
- **`PANEL_SEED` is a constant, not a parameter.** A caller who can choose the seed is a caller
  who can re-roll until the random-entry control loses. Same reasoning as the next bullet.
- **`MIN_HOLDOUT_RETENTION` is pre-registered.** Its value (0.5) was fixed before any
  candidate was measured against it. Re-tuning it after seeing a candidate fail turns the
  gate into a rubber stamp with extra steps — that is what "pre-registered" is protecting.
- **Never restore a mock fallback that can decide something.** Both halves were cut on
  2026-08-25 (§3). `mockHawk`/`mockSage` and `mockCandidates` still exist — as the
  counterfactual baseline and as the purge script's fingerprint — but the moment either can
  open a trade or bank a strategy the record becomes unreadable again. The failure mode is not
  dishonesty (the old code labelled everything correctly); it is that a correctly-labelled
  placeholder accumulates into the majority of the dataset while nobody reads labels.
- Next.js 16 here has breaking changes vs. training data; read `node_modules/next/dist/docs/`
  before writing app code (`AGENTS.md`).
- **Four things about the web layer that reviewers get wrong every single time.**
  (1) `fmtPct` (`src/lib/utils.ts:31`) **divides by 100**, and every `*Pct` field in this repo
  is already in percent units (`1` = 1%), so passing one straight to `fmtPct` is correct —
  "fixing" the apparent double conversion is what breaks it. (2) `Stat`
  (`src/components/ui.tsx:19`) renders its **own** `<Card>`; a grid of `Stat` must sit in a
  plain `<section>`, never inside a second `Card`. (3) **Nothing under `src/app/` is tested**
  in this repo, by design — a route or page is verified against a running dev server, so
  "these files have no tests" is not a finding. (4) Repo-wide `npm run lint` carries a
  **263-problem pre-existing baseline** (102 errors, 161 warnings) in files nobody is touching;
  judge lint scoped to the files a change actually edits, or every diff looks broken.
- **Start dev servers through the harness's preview tooling, never `npm run dev` in Bash.**
  A Bash-launched server outlives the turn that started it and holds port 3275 against the
  next one. Related, and it costs a wasted verification round every time: the pane renames
  `launch.json` configurations, so `"dev:web"` must be started as `nexmind-dev-web`, and the
  first `navigate` after a cold start fails while Next is still compiling — check
  `preview_logs` for "Ready in" before treating that failure as a permission problem.

## 6. Blocked on the user (still open)

**Not on this list: anything about cloud credentials.** The runtime is local by decision
(§3), and locally `aiBackend()` resolves to `cli` — `claude.exe` is on the persisted User
PATH, so Task Scheduler resolves it and the desk can decide. Both key items below are
**dormant preconditions for re-enabling a cloud schedule**, not open questions, and must not
be reported as blockers while the runtime stays local:

- *(dormant)* Vercel has no `ANTHROPIC_API_KEY`, and the GH runner installs the CLI and passes
  `CLAUDE_CODE_OAUTH_TOKEN` yet still produced `mock` — unexplained. Diagnose `aiBackend()`'s
  CLI probe on the runner **before** re-enabling either schedule. Nothing depends on it today.
- *(dormant)* `FINNHUB_API_KEY` is empty as a GitHub Actions secret; the local loops read it
  from `.env`, where it is set. It matters again the day a schedule is re-enabled:
  `gh secret set FINNHUB_API_KEY --repo CrispyBacoN-12/Nexmind` (user runs it — do not handle
  the key).
- ~~**Pick a window policy**~~ — **answered and implemented** (§3). Adopting it made every stored
  `backtestSummary` non-comparable, exactly as warned; that is what the `validation` column
  records rather than hides.
- ~~**Register the weekly research schedule.**~~ — **DONE 2026-08-26**, verified by
  `(Get-ScheduledTask -TaskName "NEXMIND Research round").Triggers`: `DaysOfWeek 1` /
  `WeeksInterval 1`, no surviving `DaysInterval`. The loop now tests ~156 candidates/yr against
  the fixed p95 bar, which is the number the multiple-testing argument in §3 assumes.
- **The AI budget is spent, and that is now the only thing stopping a research round.**
  A hand-run round on **2026-08-30** died in seconds:
  `claude CLI: You've hit your monthly spend limit`. Nothing in the repo can fix this —
  raise it at `claude.ai/settings/usage` (**owner runs it; do not handle the account**), or
  wait for the monthly reset. Until then `runScheduledResearchRound` cannot propose, and
  HAWK/SAGE cannot decide: expect every scan to log `no-ai-backend`, which is the desk
  refusing correctly, not a fault. The failure is at least **visible** now — see §3.
  ~~**The weekly research round has not run once** (battery veto)~~ — **the scheduler half is
  FIXED, 2026-08-30.** `NEXMIND Research round` had been returning **0x800710E0** on every
  firing: `DisallowStartIfOnBatteries` and `StopIfGoingOnBatteries` were both `True` and
  `StartWhenAvailable` `False` on **that task only** — `Stocks scan` and `Manage positions`
  already had all three set correctly, which is exactly why the desk ran daily for a week
  while research never ran at all. All three now match. Next automatic attempt **2026-09-06
  06:00**, and `StartWhenAvailable` means a missed slot is caught up rather than lost. The DB's
  newest `ResearchRun` is still **#110 from 08-24** and **0 `panel-v1` rows** exist; that will
  not change until the budget above is restored.
- `git rm -r --quiet rl mt5-bridge/__pycache__` — `rl/` is still tracked after the pivot.
- ~~Confirm why desk #11 runs **`combo-vote`** and not `trend-pullback`~~ — **ANSWERED and
  switched, 2026-09-02** (§3). `combo-vote` was never intended on weekly bars: `orb` cannot fire
  there, so the rule was a 2-of-2 AND selecting the most extended bars on the board. Desk #11 is
  on `trend-pullback`.

## 7. Housekeeping for whoever writes here next

1. Update §2 only from a **real query**, never from what this file used to say.
2. Move anything finished out of §4 into §3 with its commit hash.
3. A rejected mechanism goes in §5 so it is never re-tuned; link its `docs/quant/` file.
4. Keep this file under ~150 lines. Deep evidence belongs in `docs/quant/` and in commit
   bodies, not here. When §3 outgrows its space, compress its oldest entries to one line
   each — the reasoning is already in git.
