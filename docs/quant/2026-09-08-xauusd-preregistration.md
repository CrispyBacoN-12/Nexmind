# XAUUSD (`xau-v1`) — pre-registration

**Written 2026-09-08, before a single gold strategy number exists.** No broker
history has been cached, no fold has been sliced, no mechanism has been run. That
is the whole point: everything below is fixed while it is still impossible to
choose it to fit a result.

Anything that must be filled in later is marked **[PENDING]** and names exactly
what unblocks it. A `[PENDING]` item may be *filled*; a non-pending item may not
be *changed*. If a number here turns out to be inconvenient once results exist,
that is the gate working — see "Amendment" at the bottom.

Governing plan: `~/.claude/plans/automated-trading-xauusd-fuzzy-bubble.md`.

---

## 0. What is being claimed, and what could refute it

**Claim under test:** that XAUUSD on H1 contains a tradeable edge reachable by a
rule with no fitted parameters, after the real costs of a real broker.

**Refutation:** failing the PASS bar in §5 closes XAUUSD as an instrument. Not
"try another timeframe", not "try another parameter", not "try M15 instead". The
reason is measured, not stylistic: `scripts/probe-selection-strength.log` showed
that picking the best of 20 zero-edge candidates buys FIT avgR **+0.028** for
free, and gold is a **single symbol** with N smaller than the equity panel's by
roughly fifty times — so the free lift from re-drawing is larger here, not
smaller.

**Structural weakness, stated up front because it cannot be fixed:** the stocks
programme's strongest evidence came from replicating on a universe sharing not
one ticker (`docs/quant/2026-08-26-broad-universe-rerun.md`). Gold is one series.
There is no disjoint universe, no cross-sectional breadth, and the broker is both
counterparty and data source with no consolidated tape to check against. Every
`xau-v1` verdict must carry this sentence. Passing this gate is **weaker evidence**
than passing `panel-v1`, and the namespace exists so the two can never be quoted
as if they were the same.

---

## 1. Namespace

`XauFoldName`, `XAU_FOLDS`, `validation = "xau-v1"` — separate types, separate
constants, separate validation tag, in the same way `DeepFoldName` is deliberately
not assignable to `FoldName`.

`MIN_PANEL_SYMBOLS = 100` and `MIN_PANEL_TRADES = 200` in `panelRun.ts` are **not
touched**. Lowering the equity desk's bar so gold can clear it would weaken a
working gate silently, and `getResearchStrategy` keeps filtering on `panel-v1`, so
a gold candidate cannot reach a stocks desk even by mistake.

## 2. Data

- **Timeframe:** H1 primary. D1 gives ~5,500 bars for all of history, which is the
  sample size that produced research-29 (8 trades, auto-approved, −$379). M15 is a
  secondary confirmation read, never a place a verdict is decided.
- **Source:** the broker's own server, cached to `.cache/bars/xau-h1.json` by
  `scripts/cache-xau-history.mts`, which aborts the entire run on any integrity
  failure rather than writing a file that is 99% right.
- **`MetaQuotes-Demo` is not admissible.** Its contract specs are demonstrably
  wrong (`tickValue` off by 10× against the sibling-symbol cross-check;
  XAUCHF/XAUGBP report a contract size 1000× the others), so its spreads, swap and
  history describe no venue that can be traded.
- **Integrity:** `isIntradaySeries(bars, 60)`, `sanitizeSeries` drop counts, and a
  D1 aggregate cross-checked against GC=F (Yahoo, explicit `period1`/`period2`
  epochs — never `range=`) and GLD (Alpaca SIP, `adjustment=all`). These will not
  agree exactly; they exist to expose a splice, the way Webull's SPY sat 117% from
  its own SMA200.

## 3. Folds — rule fixed now, dates **[PENDING]**

**Unblocked by:** Phase 0 re-run against the broker's own server, which reports
the true first H1 bar. The plan's draft `xfit` of 2004–2007 is already known to be
unreachable on at least one server.

The *rule* for cutting them is fixed here and is not up for revision once the
depth is known:

1. Folds are cut by **gold's own regime** — bull, bear, crisis, range — not into
   equal calendar slices.
2. **FIT is the oldest window and the TEST folds are the newest**, matching `FOLDS`.
3. **FIT and SELECT must be opposite-direction regimes** (one bull, one bear).
   This is the project's most expensive lesson applied in advance: breadth and
   realised-vol quintiles both died because a cut point fitted on one regime does
   not transfer, and a rule allowed to fit and select inside the same direction
   would never show it.
4. Five folds, disjoint and ordered, asserted by a unit test mirroring the one
   `panel.test.ts` applies to `FOLDS`.
5. The table is committed **before** the first strategy number is computed.

## 4. Costs — measured, era-corrected, three levels

`DEFAULT_COST_MODEL` (0.5bps + 1bp) is **not** used. Its header says it was
calibrated from an MT5 gold account, nobody re-derived it, and
`probe-fill-and-costs.log` measured that moving 0.5bps → 5bps shifts fold avgR by
~0.03R — the same size as every effect being hunted.

**Cost is charged in R, per fold, using that fold's own contemporaneous ATR.**
This is not a refinement; it is the correction that makes the other numbers mean
anything. A broker's spread is a fixed number of *points*, while the 1.5×ATR stop
is a roughly stable *fraction of price* (0.28–0.68% across 2021–2026). So the same
35-point spread is:

| era | median price | median 1.5×ATR stop | 35pt in R |
|---|---|---|---|
| 2021 | $1,794 | $6.20 | **0.0564** |
| 2024 | $2,381 | $8.82 | 0.0397 |
| 2026 | $4,562 | $31.02 | **0.0113** |

A cost pre-registered in bps from a 2026 measurement understates the older folds
by ~3.5×. Charging each fold in its own R removes the distortion instead of
padding for it.

**`XAU_COSTS` = three levels, all from the same measured point-spread
distribution, each priced per fold:**

| level | spread percentile |
|---|---|
| `median` | p50 |
| `p90` | p90 |
| `stress` | p99 |

**The PASS bar is evaluated at `p90`.** `median` and `stress` are reported
alongside as sensitivity, never as the verdict.

Spread percentiles come from `.cache/xau/spread-profile-<server>.json`, built by
`scripts/probe-xau-costs.mts` off exact integer-point histograms, and are
admissible only at **≥ 120 of 168 (dow × hour) cells**.

**`XAU_SESSION_FILTER`, declared now:** exclude any (dow, hour) cell whose **p90
spread exceeds 2× the median p90 across all cells holding ≥ 200 ticks**. It is a
**ratio, not a level**, deliberately: the one regime feature that survived five
folds was the one with no absolute number in it ("above its own trailing mean"),
and both features carrying a fitted cut point died. The filter is derived from the
cost measurement only, and is frozen before any strategy result is read.

**Swap** is applied as a post-simulation R adjustment per trade — entry and exit
times are known, so rollovers past 21:00 broker time are countable, with the
triple charge on Wednesday. Both sides, from `/symbols`.

## 5. The bar — fixed, all conditions ANDed

A candidate passes `xau-v1` only if **every** line holds:

1. beats the matched-random control's **p95** in **≥ 3 of 5** folds
2. beats the control's **median** in **5 of 5** folds
3. block-bootstrap **p5 of the margin > 0** in **≥ 3 of 5** folds
4. all of the above at the **p90** cost level
5. **≥ `MIN_XAU_BLOCKS` = 24** distinct calendar months containing at least one
   trade, per fold, and **≥ `MIN_XAU_TRADES` = 200** trades per fold, per arm
6. **long and short measured separately** (`scripts/trail-is-geometry.mts`'s
   split): a result positive only on the long side is refused as **exposure, not
   edge**, and labelled that way in the log

On (5): 24 months is the sample the bootstrap actually resamples. On one symbol
the block bootstrap is a plain time-series bootstrap — it has **lost its original
reason for existing**, which was to resample every symbol in a month together and
so carry the cross-sectional correlation. That must be written at the point of
every gold verdict, not assumed to read as it does on the equity panel. A fold
whose trades occupy fewer than 24 distinct months is a rule firing in bursts,
which is a regime bet wearing a strategy's clothes.

On (6): gold rose for twenty years. A long-only lift is the same finding as
`single 2/2.5/3` — the wider targets that beat the baseline on longs in 4/5 folds
and lost on shorts in 15 of 15 cells, and turned out to be drift.

## 6. Hypotheses — four, fixed

1. **`mr-down3` on H1** — long after three consecutive lower closes. Zero fitted
   parameters. This is the strongest transfer test available: a rule that passed a
   pre-registered hold-out on 1998–2016 US equities, moved to a different asset
   class and a different timeframe. Failing is informative too — equity mean
   reversion is usually attributed to liquidity provision, which spot gold does
   not have.
2. **Session-open breakout** — London 07:00 / NY 13:30 UTC. From the intraday
   seasonality literature, not swept here.
3. **Asian-range fade** — the mirror image of (2).
4. **Daily-trend / H1-execution** — the momentum property managed futures have
   traded in gold for decades.

`decideSetup()` is printed as a reference row and is expected to lose, as it does
everywhere else. Every other mechanism in `mechanisms.ts` is printed as an **audit
trail, not a menu**: nothing may be promoted out of this run. An interesting row
there is a new pre-registration against data that does not exist yet.

## 7. Fill and holding rules

- **Fill at the next bar's open**, never the same bar's close: the signal array is
  shifted right one bar and `entryAt: "open"` is used, so the engine sizes the
  stop off the deciding bar's ATR. On an instrument that trades continuously, a
  same-bar-close fill quotes a price that had not happened when the decision was
  made.
- **Flat before the weekend.** Gold closes Fri 21:00 UTC and reopens Sun 22:00
  UTC; an ATR stop held across that gap is a risk the backtest cannot see. The
  hold-through-weekend variant is reported as an audit row only.

## 7b. Exit geometry — fixed, not swept

Added 2026-09-08, **before any gold number exists**. §7 fixed the fill and the
holding rule and left the exit geometry unstated, which is a gap wide enough to
drive a sweep through.

The geometry is **`LADDERS.flat` — `tp1Mult 1.2`, `slMult 1.5`, single target** —
the same object the equity mechanism screen and the deep hold-out ran. It is not
swept, and the six `LADDER_OPTIONS` are not offered here.

Two reasons, both of which get worse if the decision is deferred:

1. **Hypothesis 1 is a transfer test, and a transfer test may change one thing.**
   `mr-down3` earns its place because it has no fitted parameters and can be moved
   to a new asset class unchanged. Re-choosing the exit on gold would make a
   passing row a claim about the market *and* the exit, and it would stop reading
   line-for-line against `scripts/deep-holdout.log`.
2. **A sweep is draws, and gold cannot afford them.** Six ladders × four
   hypotheses is 24 draws on ONE symbol. `probe-selection-strength.log` measured
   the best-of-20 lift at a free **+0.028 FIT avgR** on a panel with ~50× this
   sample; the free lift here is larger, not smaller. §5's bar is not calibrated
   for it.

**Consequence, stated so it cannot be quietly dropped:** if a hypothesis fails at
1.2/1.5, that is a rejection, not a reason to try 1.5/1.5. An exit claim on gold
is a separate pre-registration, measured against `runExitControl`'s null (same
entries, baseline ladder), on data that does not exist yet.

**One arithmetic dependency runs the other way.** §4's point→bps conversion halves
the spread because `slippageBps` is charged on every fill and a single-target
ladder has exactly two. A three-fill partial ladder would be **under-charged** by
that conversion, so `singleTarget` is load-bearing for the cost model, not merely
a geometry preference.

## 8. Constants that are not parameters

`PANEL_SEED` is unchanged and remains a constant. A caller who can choose the seed
is a caller who can re-roll until the random-entry control loses.

## 9. Amendment

Any change to §5, §6, §7 or the fold *rule* in §3 after the first strategy number
exists must be recorded here as a dated amendment stating what was already known
when it was made. A gate moved after seeing a result is not a gate.

The one pressure to expect: item 4 of the plan's stop conditions says it plainly —
*every time someone wants to move the bar, the fold or the seed after seeing the
numbers, that is the signal that it did not pass.*
