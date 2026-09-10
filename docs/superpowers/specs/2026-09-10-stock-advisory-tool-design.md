# Stock advisory tool — structure and risk, with no edge claim

**Date:** 2026-09-10
**Status:** design approved, ready for an implementation plan
**Scope:** the STOCKS half of the project only. The gold/MT5 half is deferred by
the owner and nothing here touches it.

## 0. Why this exists, and what it deliberately does not do

Every price-only entry rule this project has screened is dead. `mr-down3` and
`gap-fade` cleared FIT, SELECT and all three TEST folds on weekly bars and were
then **rejected** on the 2000-2016 deep hold-out
(`docs/quant/2026-09-08-weekly-mechanism-results.md`). RSI 30/70 and
Bollinger(20,2) did the same and were rejected harder — they beat their control
in 3 of 3 deep folds **while losing money in every fold ever measured**
(`docs/quant/2026-09-08-weekly-indicator-results.md`). The daily `mr-down3` that
did pass its hold-out only pays through drawdowns of 51.7% and 70.8% on a real
5-slot walk (`docs/quant/2026-09-09-portfolio-capacity.md` §1).

The untried axis is the **data class**, not the rule. That research continues
separately. This tool exists because the owner trades stocks **manually on
Webull** in the meantime, and the parts of the desk that are *not* edge claims —
ATR stop distance, whole-share position sizing, slot accounting, correlation
between open positions, the market-regime reading — are useful on their own and
already exist as validated or arithmetic-only code.

**The load-bearing constraint of this whole design:** the tool describes
structure and risk. It never says what to buy, never ranks, never suggests a
name, and never highlights a target. Naming a stock would be an implicit edge
claim, and this project has no edge to claim.

Four owner decisions fix the shape:

1. **Pull, not push.** The owner types a ticker; the tool answers. It does not
   hand over a list of candidates.
2. **Holdings are typed in by hand.** No broker trade API, no key handling.
3. **No target is chosen.** The tool prints an R ladder (1R / 1.5R / 2R / 2.5R /
   3R) as real prices and lets the owner pick. Choosing a target would itself be
   an edge claim.
4. **A pure core with one thin surface.** The core is a pure library; the first
   surface is a web page at `/advisor`.

## 1. Architecture

The single boundary rule this design stands on:

> `src/lib/advisor/` must not import `prisma`, `marketData`, or anything that
> touches the network. It takes candles that the caller already fetched and
> returns an object.

This matches `positionSizing.ts` ("Pure — no I/O") and `correlation.ts`
("operates on candle arrays already fetched by the caller"), and it is what makes
the arithmetic — the part that loses real money when wrong — unit-testable
against fixture candles.

```
src/lib/advisor/
  types.ts     AdvisorInput / Holding / AdvisorCard / ADVISOR_NO_EDGE_CLAIM
  sizing.ts    whole-share position sizing        (new — the project has none)
  rLadder.ts   R ladder as real prices and P/L    (new)
  advise.ts    composes the above into one card   (pure, no I/O)

src/app/api/advisor/route.ts   the ONLY I/O: fetch candles, call advise()
src/app/advisor/page.tsx       static server shell (no Prisma, no force-dynamic)
src/app/advisor/advisor-form.tsx  "use client" form + rendered card
```

### 1.1 Reused as-is, no edits to existing code

| Piece | From | Used for |
|---|---|---|
| `atr(candles, 14)` | `@/lib/indicators` | stop distance |
| `dailyReturns`, `pearsonCorrelation` | `@/lib/trading/correlation` | overlap with holdings |
| `gateSlots(bars, freeSlots, DEFAULT_MARKET_GATE)` | `@/lib/market/marketGate` | regime reading |
| `BENCHMARK`, `TREND_PERIOD` | `@/lib/market/regime` | which series, which period |
| `Card`, `CardTitle`, `Stat`, `Badge` | `@/components/ui` | the page |

`gateSlots` is called directly rather than `readMarketGate`, because
`readMarketGate` requires a `getSetting` dependency that drags Prisma into a tool
that otherwise needs no database. The advisory tool only **reports** the regime;
it enforces nothing, so it does not need the owner's manual on/off switch.

### 1.2 Deliberately not reused

- **`computeLot()` (`src/lib/trading/positionSizing.ts`)** returns a fractional
  "lot" (`minLot` 0.01, `Math.round(x * 100) / 100`) — a forex legacy that cannot
  express a Webull whole-share order. It is **not modified**: the desk still uses
  it. `sizing.ts` is written fresh.
- **`screener.ts` / `runScan.ts`** produce candidate *lists*. That is the
  push model the owner ruled out.

### 1.3 The no-edge claim is code, not decoration

`types.ts` exports a constant:

```ts
export const ADVISOR_NO_EDGE_CLAIM =
  "This tool does not predict anything. It reports structure and risk for a " +
  "ticker you chose. No rule in this project has survived its deep hold-out, " +
  "so nothing here is a reason to buy.";
```

`AdvisorCard` carries it as a field and the page renders it from that field. This
mirrors `PANEL_SURVIVORSHIP_CAVEAT` (`src/lib/research/panel.ts:295`), which
every panel write-up must print — the point is that a later UI redesign cannot
drop the disclaimer without deleting a field the type requires.

## 2. The arithmetic

### 2.1 Stop distance

```
slDistance = 1.5 × ATR(14)
stop       = entry − slDistance          (long)
```

1.5 is the one exit constant the whole repository agrees on: the backtest engine
(`ATR_SL_MULT = 1.5`), the research engine (`RESEARCH_ATR_SL_MULT = 1.5`), and
the ATR trail that passed IS/OOS 10/10 weekly years all use it. The **target**
multiples do not agree (2.5 live, 1.2 research, 1.5 trail), which is exactly why
§2.3 prints a ladder instead of picking one.

### 2.2 Whole-share sizing — two caps, take the smaller

```
slotBudget       = capital / maxSlots
riskUsd          = capital × riskPct
riskShares       = floor(riskUsd / slDistance)
affordableShares = floor(slotBudget / entry)
shares           = min(riskShares, affordableShares)
actualRisk       = shares × slDistance
```

**The card must always report which cap bound and what the real risk percentage
is.** When the two caps produce the same number — as in the worked example below
— the card reports *both* as binding rather than picking one arbitrarily.

At $2,500 of capital the two caps collide constantly and the binding one is
usually affordability, not risk. A tool that prints only a share count lets the
owner believe they are risking 1% when they are risking whatever the cash allowed.

Worked example — entry $180.00, ATR(14) $6.00, capital $2,500, 5 slots, risk 1%:

| quantity | value |
|---|---|
| `slDistance` = 1.5 × 6 | $9.00 → stop $171.00 |
| `riskUsd` = 2500 × 1% | $25.00 → `riskShares` = floor(25/9) = 2 |
| `slotBudget` = 2500/5 | $500 → `affordableShares` = floor(500/180) = 2 |
| `shares` | **2** (both caps land on the same number) |
| `actualRisk` | 2 × $9 = **$18 = 0.72% of capital**, not 1% |
| capital deployed | $360 |

### 2.3 The R ladder

`targetPrice(k) = entry + k × slDistance`, for k ∈ {1, 1.5, 2, 2.5, 3}. Each row
carries the price, the percentage move from entry, and the dollar P/L at the
`shares` computed in §2.2.

| R | price | % from entry | P/L (2 shares) |
|---|---|---|---|
| 1.0R | $189.00 | +5.0% | +$18 |
| 1.5R | $193.50 | +7.5% | +$27 |
| 2.0R | $198.00 | +10.0% | +$36 |
| 2.5R | $202.50 | +12.5% | +$45 |
| 3.0R | $207.00 | +15.0% | +$54 |

**No row is highlighted, recommended, defaulted, or sorted to the top.**

### 2.4 Cost, expressed in R

```
cost_R = (2 × costBps / 10000 × entry) / slDistance
```

`costBps` is **not a form field**. It is an exported constant in `types.ts`:

```ts
/** Round-trip cost assumption, in basis points. Webull charges no stock
 *  commission, so this is spread plus slippage, not fees. It is an assumption,
 *  not a measurement of the owner's own fills. */
export const ADVISOR_COST_BPS = 5;
```

In the worked example at 5bps round-trip this is 0.02R. It is small, and it must
still be printed: this project's own measurement is that the cost model dominates
every effect size it has found (0.5bps vs 5bps is worth ~0.027R/trade, wider than
any measured edge). Printing a 2R target without saying the ladder is gross would
mislead by omission.

### 2.5 Four edge cases — each returns a stated reason, never a silent 0

1. `affordableShares === 0` (entry exceeds the per-slot budget) → "price per
   share exceeds the per-slot budget at this capital".
2. `riskShares === 0` (`slDistance > riskUsd`) → "one share already exceeds the
   risk target: 1 share = $9.00 vs a $25.00 target", and the owner decides.
3. `atr()` returns null (fewer than 15 bars) → an explicit error naming the
   ticker. No NaN may reach the ladder.
4. The last bar is not today's → the card always prints the last bar's date, so
   the owner can see which price the arithmetic used.

### 2.6 Two decisions taken inside the design

- **Entry is overridable.** Blank means "use the last close", but the owner can
  type the price they actually expect to fill at, because every number in the
  card hangs off `entry` and a real Webull fill is not the previous close.
- **v1 is long-only.** The owner has already ruled that the desk does not short
  in risk-on, and the panel finding is that the short leg is exposure rather than
  alpha. Dropping it halves the test surface.

## 3. Data flow, inputs, and failure

### 3.1 Inputs

| field | default | note |
|---|---|---|
| ticker | — | the name being asked about |
| entry | blank = last close | see §2.6 |
| capital | 2500 | the real capital, not Webull paper's $1M |
| risk per trade | 1% | |
| max slots | 5 | matches `maxOpenPositions` |
| holdings | blank | **tickers only, comma-separated** — correlation needs the names and slot accounting needs the count; share counts and cost basis are not needed and are not asked for |

### 3.2 Flow

```
POST /api/advisor
  ├─ fetchCandlesBatch([ticker, ...holdings], "6mo", "1d")   → ATR + correlation
  ├─ fetchCandles(BENCHMARK, "2y", "1d", minDays 300)        → regime only
  └─ advise({ candles, holdingCandles, benchmark, ...inputs }) → AdvisorCard
```

**The benchmark is fetched separately and this is not optional.** `gateSlots`
needs SMA200, which needs 200 **sessions** ≈ 290 calendar days. Folding SPY into
the `"6mo"` batch (~126 bars) would make `sma()` return null and the gate would
read BLIND on every single request, silently. `readMarketGate` already carries a
comment naming this exact hazard as "the same silent-truncation failure that made
every intraday blind test fail for weeks".

### 3.3 Failure has three levels, not one

| failure | result |
|---|---|
| the main ticker cannot be fetched, or its ATR is null | **no card** — an explicit error naming the ticker |
| some holdings cannot be fetched | **card still renders**; those names show "correlation: unknown" (matching `pearsonCorrelation`'s own null) and still consume a slot |
| the benchmark cannot be fetched | **card still renders**; regime is **BLIND** with the reason printed |

This is the fail-open behaviour `gateSlots` documents, and its rule that the gate
"must never reduce slots silently" applies here as "the card must never go quiet
about what it could not see".

### 3.4 Slots

`freeSlots = max(0, maxSlots − holdings.length)`, passed to `gateSlots`. If the
ticker being asked about is itself in the holdings list, the card says so at the
top — the arithmetic below it then describes *adding* to an existing position,
which is a different decision from opening one, and the owner must see that
before reading the numbers. The card
reports **both** numbers — raw free slots and the gate's verdict. When the
benchmark is below its SMA200 the existing gate config yields 0; the card states
that plainly ("the desk's gate rule would allow 0 new positions in this market")
as **information**. This tool blocks nothing.

### 3.5 Correlation is reported, not applied

The card shows the correlation against each holding, the average, and the
multiplier the desk's own `corrMultiplierFor` would apply (≥0.8 → 0.7x, ≥0.6 →
0.85x). It renders the result as two lines — "2 shares" and "with the desk's
correlation rule: 1 share" — and **does not silently shrink the number**. The
premise of the tool is that structure belongs to the tool and the decision
belongs to the owner.

### 3.6 The page

`page.tsx` is a static server component. Because it touches no database it needs
no `force-dynamic`, unlike every other page in the app. `advisor-form.tsx` is
`"use client"`, posts to `/api/advisor`, and renders the card with the existing
`@/components/ui` primitives. `ADVISOR_NO_EDGE_CLAIM` sits at the head of every
card, read from the card object.

## 4. Testing

`npm test` is `tsx --test "src/**/*.test.ts"` using `node:test` and
`assert/strict`, as in `positionSizing.test.ts`. The advisor core lives under
`src/`, so it joins the existing suite automatically. Tests are written first
(TDD): each behaviour gets a failing test before the code that satisfies it.

| file | must prove |
|---|---|
| `sizing.test.ts` | affordability binds on a high-priced name; risk binds on a wide-ATR name; the card names which one bound; `actualRisk` is below target whenever affordability binds; all four §2.5 edge cases return a reason; **no input can produce a fractional share** |
| `rLadder.test.ts` | k=1 sits exactly `slDistance` from entry; the percentage matches the price; P/L equals `shares × k × slDistance`; `cost_R` moves with both bps and `slDistance` |
| `advise.test.ts` | a too-short benchmark yields BLIND **and still a card**; one unfetchable holding yields a null correlation **and still a card**; too few bars yields an explicit error; `ADVISOR_NO_EDGE_CLAIM` is present on every card |

**No tests for the route or the page.** There are no tests under `src/app/`
anywhere in this project, and this work will not unilaterally introduce that
convention. Those two layers are verified by running `npm run dev:web` (port
3275) against real cases, with a screenshot handed to the owner.

## 5. Out of scope for v1

Listed so the implementation plan cannot quietly grow:

- **No Webull trade API and no key handling.** `/openapi/trade/*` is untouched
  and untested, and shadow execution was removed on 2026-08-22.
- **No persistence of holdings.** They are typed each time, by the owner's choice.
- **No name suggestions and no screener.** Choosing names is an edge claim.
- **No short side.**
- **No backtest of the advisory tool itself.** It predicts nothing, so there is
  nothing to backtest. If a future version ever starts proposing names, that
  version must go through the panel gate first — this exclusion is the tripwire.
- **No auth.** It runs locally like every other page in this app.

## 6. Open items carried forward

- The exit geometry the repo ships remains unresolved: `docs/STATE.md` §4c still
  wants the legacy 0.8:1 research ladder retired, and §4d still has the validated
  ATR trail parked and shipped nowhere. This tool sidesteps the question by
  printing a ladder rather than choosing, but it does not close either item.
- Membership survivorship stays "open, unmeasurable with this data"
  (`docs/quant/2026-09-09-portfolio-capacity.md` §4). Nothing in this tool depends
  on it, because this tool makes no claim about returns.
