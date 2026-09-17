# Gold autonomous trading mechanism — xau-v1 screen + demo-gated execution

**Date:** 2026-09-18
**Status:** design approved, ready for an implementation plan
**Scope:** two sequential efforts. (1) Unblock the `xau-v1` pre-registration
(`docs/quant/2026-09-08-xauusd-preregistration.md`) and get a real PASS/REJECT verdict for
the four pre-registered gold hypotheses — it has never run to completion. (2) Conditional on
at least one PASS, an autonomous decision module wired into the existing gold pipeline
(`docs/superpowers/specs/2026-09-16-gold-mt5-pipeline-design.md`), demo-account-only,
structured so a later move to real trading is a config flip
(`MT5_BRIDGE_ALLOW_REAL`), not a rewrite.

## 0. Why this exists, and the evidence-bar tradeoff being accepted

The 2026-09-16 spec built the gold MT5 pipeline — data in, orders out, safely — and
explicitly deferred all mechanism/strategy logic to "a separate, later effort" (its §6). This
is that effort, plus the decision-module layer that plugs into the pipeline it built.

`xauFolds.ts` already carries its own evidence-bar warning, printed at the top and bottom of
every `xau-screen.mts` run:

> xau-v1 is weaker evidence than panel-v1: one symbol, no cross-section, no ticker-disjoint
> replication, and the broker is both counterparty and data source with no consolidated tape.
> The monthly block bootstrap here is a plain time-series bootstrap — it has lost the
> cross-sectional correlation it exists to carry.

On the stocks side, `docs/STATE.md` records that nothing ever beat its own random-entry
control on a deep hold-out — under `panel-v1`, the *stronger* of the project's two evidence
bars — across every entry rule, exit geometry, and non-price data class tried. Choosing to
autonomously trade a mechanism that clears the *weaker* `xau-v1` bar is a real, informed
tradeoff, not an oversight: the owner decided the outcome of this screen is worth acting on
even though it would not have been enough to unpause the stocks desk. This does not reopen
the stocks Go-Live question and is not a precedent for lowering `panel-v1`'s bar elsewhere —
it is a decision scoped to this one instrument, on record here.

The pre-registration's own amendment discipline governs the outcome either way (§0, quoted in
`xau-screen.mts`'s `main()`):

> Failing this bar closes XAUUSD as an instrument (§0). Not another timeframe, not another
> parameter, not another ladder — the rule already had five folds to be interesting on, and a
> confirmation that can only pass is not one.

## 1. Sequencing

Phase 2 (autonomous execution) does not start until Phase 1 (the screen) produces a verdict,
and does not start at all if the verdict is REJECT on all four hypotheses. No implementation
work on the decision module happens ahead of the verdict.

This means the implementation plan that follows this spec covers Phase 0/1 only (§2): the
data/probe/engine work needed to produce a real verdict. Phase 2 (§4) cannot be planned in
concrete detail yet — which hypothesis it builds around isn't known until Phase 1 finishes —
and gets its own implementation plan afterward, scoped to whichever hypothesis (or
hypotheses) actually passed. §4's architecture is fixed now so that plan has no open design
questions to resolve when its turn comes; only the choice of which passing hypothesis(es) to
wire up is deferred (§3, §8).

## 2. Phase 0/1 — unblocking `xau-v1`

`scripts/xau-screen.mts`'s `blockers()` currently returns six non-empty strings; every one of
them must resolve to run the screen for real:

1. **Bar history.** Pull real OANDA `XAUUSD.sml` H1 history via the existing MT5 bridge and
   cache it to `.cache/bars/xau-h1.json` (`XAU_PANEL_CACHE_PATH`). No probe has ever pulled
   this instrument/broker pair before — the only prior probes (`probe-xau-data.log`,
   `probe-xau-integrity.log`) ran against `GOF_CON`, a Thai futures contract, not this symbol.
2. **Fold table.** From that history, construct `XAU_FOLDS` (`xfit`, `xselect`, `xtest1`,
   `xtest2`, `xtest3`) satisfying `xauFoldViolations()`: disjoint and ordered, FIT oldest /
   TEST newest, and FIT/SELECT in **opposite** market directions.
3. **Cost model.** Run `scripts/probe-xau-costs.mts` against OANDA `XAUUSD.sml` — this probe
   exists in source but has never been executed against any broker. It measures the real
   spread distribution and fills `XAU_COSTS`, `XAU_POINT_SIZE`, `XAU_COMMISSION_POINTS` at
   three cost levels (median/p90/stress).
4. **Session filter.** Derived from the same spread histogram: exclude any (day-of-week,
   hour) cell whose p90 spread exceeds 2x the median p90 across cells with ≥200 ticks →
   `XAU_SESSION_FILTER`.
5. **Swap terms.** Pull `symbol_info(XAUUSD).swap_long` / `swap_short` / `swap_mode` and
   contract size from OANDA's own MT5 server → `XAU_SWAP`. `swapInR()`/`swapCost()`/
   `rolloverNights()` (`@/lib/trading/swap`) already exist to consume this once it's real.
6. **Weekend-flat exit.** Add `ExitOptions.flatBy?: (i: number, candle: Candle) => boolean`
   to the backtest engine — additive, defaults to `undefined`, no existing behavior or number
   changes. Implement gold's "flat before the weekend" rule (Friday 21:00 UTC close / Sunday
   22:00 UTC reopen) as a `flatBy` function, then flip `WEEKEND_FLAT_SUPPORTED = true` in
   `xau-screen.mts`.

**Broker choice for this phase: OANDA `XAUUSD.sml`**, not MetaQuotes-Demo. The
pre-registration's §2 documents MetaQuotes-Demo's contract specs as internally wrong
(tickValue off 10x, contract size off 1000x on sibling symbols) — a verdict built on those
facts would not be trustworthy regardless of how the code runs. MetaQuotes-Demo is still used
in Phase 2 (§4) for execution, where sizing is queried live rather than baked in from here.

Once all six items are real, run `npx tsx scripts/xau-screen.mts | tee scripts/xau-screen.log`
for the actual verdict. `--control=20` smoke runs are not results and are never cited as one.

## 3. Verdict handling

- **All four REJECT.** Per §0's amendment discipline, this closes XAUUSD as an instrument —
  no retry on another timeframe, parameter, or exit ladder. Report the result; Phase 2 does
  not happen.
- **Exactly one PASSES.** That hypothesis becomes the single mechanism built in Phase 2.
- **More than one PASSES.** They are not auto-blended — a blended rule would itself be a new,
  untested mechanism. Each passing hypothesis becomes its own independent decision stream
  (§4). Which of them are actually enabled for live (demo) trading is a decision to revisit
  with the owner once the verdict is known, not assumed here.

## 4. Phase 2 — decision module and desk wiring (Approach B)

Conditional on §3 producing at least one PASS.

**Module.** `src/lib/gold/mechanism.ts` exports one pure, unit-testable function per the
stocks-side `mechanisms.ts` pattern:

```
evaluateGoldSignal(bars, openPosition, config)
  -> { action: "enter-long" | "enter-short" | "flat", stopPrice, lotSize } | null
```

`gold-desk.mts` calls it each cycle and executes whatever it returns through the
already-built order-placement/reconciliation/hard-kill pipeline (`broker.ts`,
`retcodes.ts`) — no new execution path.

**One instance per passing hypothesis.** If two hypotheses pass, two independent
`evaluateGoldSignal` instances run every cycle, each with its own config and its own position
state. Nothing shares state between them.

**Position concurrency: at most one open position per instance, ever.** No pyramiding, no
averaging into a loser. A Martingale/averaging-down "แก้ไม้" design was explicitly considered
and rejected: it is not a parameter of a tested mechanism but a different money-management
class entirely, with a known failure shape (small wins accumulating while directional
exposure grows, until a trend that doesn't revert erases them all at once) that nothing here
has measured. `xau-v1`'s verdict only speaks to single-entry, single-stop, fixed-R rules; it
says nothing about the safety of adding to a loser. A future averaging-style system is a
separate research effort requiring its own pre-registration and its own verdict, not a flag
on this module. Maximum simultaneous open positions across the whole gold desk is therefore
bounded by the number of enabled hypotheses (at most 4), not by the position size (0.1 lot
was considered and rejected as the basis for "just don't worry about the count" — margin
affordability and tested risk are different questions).

**Sizing.** 1% of the executing account's (MetaQuotes-Demo) equity risked per position, sized
off the ATR-stop distance
computed by the mechanism. Lot size is converted from that risk using **the executing
account's own live `symbol_info`, queried via the MT5 bridge at the moment of entry** — not
the OANDA-derived Phase 1 constants (§2), which describe the instrument's edge, not any
specific account's contract facts. This is correct regardless of which broker executes; here
it also happens to route around MetaQuotes-Demo's documented spec inaccuracies, since sizing
is computed from whatever that account reports about itself right now rather than from a
number carried over from OANDA.

**Execution account: MetaQuotes-Demo, demo only.** `MT5_BRIDGE_ALLOW_REAL` stays unset.
Per `src/lib/gold/README.md`, flipping that flag later is the entire mechanism for going
live — no code change to this module is required.

## 5. Guardrails

- **Daily loss cap: 2% of the executing account's (MetaQuotes-Demo) equity, aggregated across
  all open gold positions.** On breach: the
  desk stops opening new positions for the remainder of that trading day. Positions already
  open are **not** force-flattened — each is already bounded at 1% risk by its own stop, and
  closing at the moment the aggregate cap trips is not obviously better than letting each
  position's own pre-set stop or target decide.
- **`XAU_SESSION_FILTER` is enforced live**, not just in backtest — no new entries during a
  session cell flagged as high-spread. (Exits are never filtered — a position already open
  cannot decline to be stopped out because the spread is wide, matching the backtest's own
  `applySessionFilter()` asymmetry.)
- **Bridge health required before every order.** Reuses the existing `checkBridgeHealth()`
  (already wired into `/api/gold/status`) — `connected: true` is a precondition for every
  order call, not just a boot-time check.
- **Kill switch.** File/env-based, checked every cycle, independent of the daily-loss cap.

## 6. Testing

- `mechanism.ts` is a pure function — bars, open-position state, and config in; a decision
  out — and is unit-tested in isolation exactly like the stocks side's `mechanisms.ts`, with
  no MT5 bridge involved.
- Everything that touches the real MT5 bridge remains outside CI's reach (per the 2026-09-16
  spec's §4 constraint) and is verified through `src/lib/gold/README.md`'s manual runbook,
  extended to cover: multiple simultaneous position slots reconciling independently after a
  bridge restart, the daily-loss-cap trip blocking new entries while an already-open position
  continues to its own stop, and the kill switch halting the loop mid-cycle.

## 7. Scope

**In scope:**

- Filling in `xauFolds.ts`'s six [PENDING] values against real OANDA `XAUUSD.sml` data and
  producing the first real `xau-screen.mts` verdict.
- The additive `ExitOptions.flatBy` engine change.
- `src/lib/gold/mechanism.ts` and its wiring into `scripts/gold-desk.mts`, conditional on a
  PASS.
- The guardrails in §5.

**Explicitly out of scope:**

- Any Martingale/averaging/grid position-management system (§4) — would need its own
  pre-registration and verdict.
- Auto-blending multiple passing hypotheses into one rule (§3).
- Going live (`MT5_BRIDGE_ALLOW_REAL=1`) — a future, separate owner decision; this design
  only ensures the flag is the *only* thing that needs to change.
- Anything on the stocks desk or `/advisor` side.

## 8. Open questions, deliberately not resolved here

- **Which hypothesis/hypotheses get enabled for live (demo) trading if more than one
  passes.** §3 defers this to a conversation with the owner once the actual verdict is known
  — it is not a decision that can be made ahead of seeing which mechanisms actually pass and
  how strongly.
- **Per-hypothesis magic-number/labeling scheme** for the desk to tell concurrently open
  positions apart in `broker.ts`'s reconciliation — an implementation-plan detail, not a
  design-level one.
