# Gold MT5 pipeline — data + real automated execution, demo-gated

**Date:** 2026-09-16
**Status:** design approved, ready for an implementation plan
**Scope:** a new, isolated gold/XAUUSD module built on MT5. Data ingestion and order
execution only. No mechanism/strategy research in this phase — see §0 for why, and §6 for
what is explicitly deferred.

## 0. Why this exists, and why it does not conflict with the 2026-09-15 pivot

`docs/STATE.md` §1 states the pivot plainly: NEXMIND stopped hunting for fully-automated
alpha on stocks and made `/advisor` the point of the repo. §3 records "Stocks-only pivot
finished. Gold/forex/crypto/options desks and watchlist seeds gone" as a deliberate cleanup.

Gold is a different case, for reasons specific to it and not to the pivot's own logic:

- The pivot's rationale was **stocks-specific**: $2-3k capital, whole-share sizing, Webull
  data-only, and — the load-bearing fact — every price-based entry rule, every exit
  geometry, and three non-price data classes were screened and rejected on the S&P 500
  (`docs/STATE.md` §3, §5). None of that evidence is about gold; it never touched XAUUSD.
- Gold was never part of that research program. The one prior attempt
  (`wip/mt5-xauusd`, commit `bb1e409`, 2026-08-15) rejected a specific mechanism
  (Donchian/breakout) on its own evidence, and separately noted gold needs its own broker/
  execution path since Webull doesn't offer it. Neither fact says gold itself is closed —
  only that one entry rule and Webull-as-broker are.
- A rigorous, pre-registered validation framework for XAUUSD already exists independent of
  the old branch: `src/lib/research/xauFolds.ts` (`XAU_VALIDATION_TAG`, `MIN_XAU_BLOCKS`,
  `MIN_XAU_TRADES`, `xauVerdict()`'s 6-condition gate). It was built and then blocked on
  infrastructure (a Phase 0 re-run against the broker's own server, a costs probe) — not
  abandoned as a research direction.

**The owner's explicit sequencing decision governs everything in this spec: build the
pipeline first, research the mechanism afterward.** This spec is therefore infrastructure
only — no mechanism, no signal, no strategy logic. It stands in the same relationship to a
future gold mechanism screen that `docs/superpowers/specs/2026-09-10-stock-advisory-tool-
design.md` stands to the stocks research program: usable machinery, built before or
independent of what will eventually run through it.

**The load-bearing constraint of this whole design:** every order this pipeline can place
goes to a **demo/paper MT5 account only**, enforced in code, until a gold mechanism has
passed some form of review — not by convention, not by a config flag, but by an assertion
against what MT5 itself reports about the connected account (§3). There is no `ALLOW_LIVE`
flag in this build. Flipping to live trading later is a deliberate, reviewable code change,
not a switch anyone can flip by accident.

Four owner decisions fix the shape:

1. **Full automated desk, not manual-confirmation.** Unlike NEXMIND's historical stocks
   practice (Webull data-only, Go-Live always "dead, not deferred", 100% manual orders),
   this pipeline sends real orders through MT5's own API.
2. **Demo/paper until a mechanism passes review.** Chosen over going live from day one on a
   placeholder rule.
3. **Selective port, isolated namespace, no branch merge.** `wip/mt5-xauusd` is 400+ days
   stale (`git merge-base` predates most of current history) and carries a dead mechanism
   and app-page symbol migrations that don't apply to a from-scratch build. Only
   `mt5-bridge/bridge.py` and the shape of `src/lib/mt5.ts` are reused, reviewed line-by-line
   during the port, not merged wholesale.
4. **MT5-only for now.** OANDA/PAXG from the old branch are not ported; MT5 serves both data
   and execution. Added later only if a real need appears.

## 1. Architecture

```
src/lib/gold/
  mt5Bridge.ts     # TS client for the Python bridge's wire protocol (Zod-validated)
  marketData.ts    # gold OHLCV fetch/normalize — independent of src/lib/marketData.ts
  broker.ts        # order placement/positions/account state, demo-gated
  types.ts         # Gold*-prefixed types, no shared inheritance from stocks types
mt5-bridge/
  bridge.py        # ported from wip/mt5-xauusd, trimmed to what broker.ts calls,
                    # payload shapes match mt5Bridge.ts's Zod schema by construction
scripts/
  gold-desk.mts    # entrypoint: env guard -> preflight healthcheck -> boot reconciliation
```

Key boundary decisions:

- **No shared runtime state with the stocks desk.** Gold runs as its own process
  (`npm run gold`, its own `scripts/gold-desk.mts`), never folded into `scripts/dev.mts` or
  `scripts/session.mts`. This mirrors the stocks desk's own hard-won lesson
  (`docs/STATE.md` §5: starting `nexmind-dev` instead of `nexmind-dev-web` once triggered a
  real desk session and spent real budget) — a shared entrypoint is exactly the shape that
  incident had.
- **Env namespace guard at boot.** All gold config reads through `GOLD_MT5_*`-prefixed env
  vars. `scripts/gold-desk.mts` validates these exist before anything else runs, and
  explicitly rejects boot if only stocks-desk credentials (Webull/Alpaca keys) are present —
  a fast, actionable failure instead of silently running unconfigured.
- **`mt5Bridge.ts` ported, not merged, with a fixed review checklist.** Same wire protocol
  to `bridge.py`, rewritten fresh against these points rather than copied: reconnection/
  heartbeat behavior on terminal drop (weekend maintenance, sleep, broker disconnect); every
  MT5 retcode mapped to a typed union, bucketed (see §3); XAUUSD's own contract size (100 oz)
  and 0.01 lot step asserted explicitly, so no equity share-count assumption can leak in.
- **Shared contract schema between TS and Python.** `mt5Bridge.ts` defines Zod schemas for
  every message `bridge.py` can send or receive; `bridge.py`'s dataclasses/payloads are
  written to match them by construction, checked in the manual verification runbook (§4).
  This is what keeps the in-process fake bridge used in CI (§4) from silently drifting away
  from what the real bridge actually speaks.
- **No GC=F->XAUUSD symbol migration touching existing app pages.** That migration in the
  old branch rewired *existing* pages; here there is no existing gold page. New routes are
  built fresh under `/gold/...` from day one, with no shared conditional asset-type branching
  against the stocks pages.
- **Explicit `bridge.py` dependency, checked at boot, not discovered mid-debug.** It requires
  a local MetaTrader terminal — this only runs from a machine with MT5 installed, never CI/
  server. `scripts/gold-desk.mts` pings the bridge port with a short timeout (2s) before doing
  anything else and throws an actionable error ("MT5 Bridge not detected at 127.0.0.1:XXXX.
  Start the MT5 terminal and run `python bridge.py` first.") instead of hanging on a dead
  socket. The module's README states the requirement up front.

## 2. Data flow

Two independent flows, deliberately not sharing a pipeline (a CQRS-style split):

**Market data (read path):**
```
MT5 terminal -> bridge.py (poll/stream ticks+bars) -> mt5Bridge.ts
             -> marketData.ts (normalize + UTC + gap-fill) -> storage/consumer
```

- **UTC normalization at ingest.** MT5's broker-server clock (typically EET/EEST) is
  converted to UTC the moment a bar is written; nothing downstream ever sees broker-local
  time. Fixture tests explicitly cover the EET<->EEST DST transition, where a broker's daily
  bar hour can shift by one.
- **Gap detection and backfill.** On reconnect, and periodically, a routine diffs expected
  vs. present bars and backfills from MT5's history on any gap — a terminal restart never
  leaves a silent hole. The routine distinguishes an **ordinary weekend gap** (skip, no
  backfill attempt) from a **mid-week gap** (missing bars, backfill required) — conflating
  the two would either spam retries every weekend or silently swallow a real gap.
- **Spread/bid-ask stored alongside OHLCV**, not just close prices — needed for realistic
  slippage modeling later, especially around the NY-close/rollover widening window
  (~04:00-05:00 Thailand time). Stored now because it's cheap at ingest and unrecoverable
  retroactively, even though nothing consumes it yet.
- **Staleness heartbeat drives a `DEGRADED` read state independently of socket-disconnect
  events.** During market hours, no tick for 5-10s flips read-path state to `DEGRADED` even
  if the socket itself looks alive — catches a hung terminal that never fires a disconnect
  event.

**Order execution (write path):**
```
manual test harness (no mechanism exists yet) -> broker.ts -> mt5Bridge.ts -> bridge.py -> MT5
                                                      ^
                                        demo-mode account assertion (see §3)
```

Until a mechanism passes review, the only caller of `broker.ts`'s order-placement function is
a manual test harness proving the execution path works end-to-end — there is no auto-signal
generator in this phase. When mechanism research resumes later, its output plugs into this
same `broker.ts` entrypoint; §3's gate is what stops it from reaching a live account
prematurely.

- **Boot-up reconciliation.** Before `broker.ts` allows any order call, it pulls
  `positions_get()`/`orders_get()` from MT5 and syncs local state — no blind first order
  after a process restart.
- **Execution idempotency with an explicit in-flight state.** A socket timeout after
  `bridge.py` sends an order to MT5 but before the response reaches `broker.ts` moves the
  order to `IN_FLIGHT_UNKNOWN` rather than either assuming success or blindly retrying.
  Resolution queries MT5 by `magic_number`/`order_comment` (a unique identifier attached to
  every order this system places) before collapsing to confirmed-sent or confirmed-not-sent.
  No retry ever fires before that resolution completes.

## 3. Error handling and the live-trading gate

This section makes "demo/paper until a mechanism passes review" a property of the code.

- **Defense-in-depth demo assertion.** `broker.ts` checks MT5's own
  `account_info.trade_mode === ACCOUNT_TRADE_MODE_DEMO` (enum `0`) before any order call —
  not a locally-cached flag, but a live check against what MT5 itself reports for the
  connected account. This catches a dev who alt-logs the terminal into a real account without
  updating any local config. There is no `ALLOW_LIVE` flag anywhere in this build; going live
  later means deliberately changing this assertion in a reviewable commit.
- **Fail-closed on connection loss, never silently stale.** If `bridge.py` is unreachable or
  MT5 reports disconnected, both `marketData.ts` and `broker.ts` surface an explicit
  `DEGRADED`/error state rather than returning last-known values — same principle as RAVEN's
  `result.degraded` handling in `advisor-critique.tsx`: never let old data pass for fresh.
- **MT5 retcodes classified into three buckets, not logged as one generic failure:**
  - `RetriableWithNewQuote` — 10004 Requote, 10021 No quotes: refetch price, then retry.
  - `TerminalRejection` — 10014 Invalid volume, 10015 Invalid price, 10016 Invalid stops,
    10019 No money: never retry, log and reject the order.
  - `MarketCondition` — 10018 Market closed, 10027 Auto-trading disabled: pause the
    execution loop, not a per-order failure.
- **No retry loop can double-fill.** Combined with the `IN_FLIGHT_UNKNOWN` resolver from §2,
  a failure path always ends in confirmed-sent or confirmed-not-sent, never "unknown, try
  again blindly."

## 4. Testing

Shaped by one hard constraint: `bridge.py` needs a real MT5 terminal, so nothing that touches
it can run in CI.

- **`mt5Bridge.ts` and `broker.ts` unit-tested against an in-process fake bridge** speaking
  the same Zod-validated wire protocol as `bridge.py`, told to return specific retcodes,
  timeouts, or stale/missing data on demand. This is where the retcode buckets, the
  `IN_FLIGHT_UNKNOWN` resolver, the `DEGRADED` staleness transition, and the demo-mode assert
  all get exercised deterministically in CI. The shared Zod schema (§1) is what keeps this
  fake from drifting away from what `bridge.py` actually speaks.
- **`bridge.py` verified manually against a real MT5 demo account**, via a documented,
  repeatable runbook (not automated, explicitly out of CI's reach):
  - Place order, verify boot-up reconciliation picks it up after a restart.
  - **Hard kill test**: `kill -9` `bridge.py` immediately after sending an order; verify the
    `IN_FLIGHT_UNKNOWN` resolver correctly recovers state once the bridge comes back up.
  - **Terminal lag/desync test**: disconnect the MT5 terminal's network (or its account)
    and verify the read path enters `DEGRADED` within the heartbeat's staleness threshold.
- **Data-flow correctness (UTC normalization, gap backfill, spread capture) unit-tested
  against recorded fixture bar sequences** captured once from a real demo session and
  replayed deterministically. Fixtures explicitly include: an intentional mid-week gap (to
  prove backfill fires), a weekend gap (to prove backfill does *not* fire on it), and a
  DST-transition window (EET<->EEST) to prove the daily-bar hour shift is handled.
- **No mechanism/strategy tests in this phase.** There is no mechanism yet; these tests only
  prove the pipeline — data in, orders out, safely — works, matching the "build pipeline
  first" sequencing.

## 5. Scope

**In scope:**

- `src/lib/gold/` module: MT5 market data ingestion (ticks/bars, UTC-normalized, gap-filled,
  spread-tracked) and order execution (place/query/reconcile), both demo-account-gated.
- Ported, reviewed `mt5-bridge/bridge.py` and a freshly-written `mt5Bridge.ts` client.
- A dedicated `npm run gold` entrypoint with env-namespace validation and preflight
  healthcheck.
- Fresh `/gold/...` routes/pages as needed to observe the pipeline (scope of these pages is
  an implementation-plan decision, not fixed here).
- CI-covered unit tests (fake bridge) and a documented manual verification runbook (real
  bridge, demo account).

**Explicitly out of scope for this spec:**

- Any mechanism, signal, or strategy logic. No `decideSetup()`-equivalent for gold exists
  yet; mechanism research is a separate, later effort, gated on this pipeline existing first.
- OANDA and PAXG integration — MT5-only for both data and execution.
- The dead Donchian/breakout mechanism from `wip/mt5-xauusd` — not ported in any form.
- Live (non-demo) trading of any kind.
- Any change to the stocks desk, `/advisor`, or anything under the existing
  `src/lib/marketData.ts` / `src/lib/trading/` paths.

## 6. Open question, deliberately not resolved here

**What "a mechanism that has passed review" means well enough to flip the demo assertion is
not pinned down.** The owner's answer to the go-live gating question was "connect to demo/
paper until a mechanism has passed review" — not explicitly "must pass `xauFolds.ts`'s
`xauVerdict()`". It's plausible the eventual bar is exactly that 6-condition gate (it already
exists, purpose-built for XAUUSD, and NEXMIND's other research consistently uses formal
gates rather than ad hoc sign-off), but that hasn't been confirmed, and the owner's stated
preference is to defer mechanism/validation decisions until after the pipeline is built. This
spec does not resolve it — the code-level gate (§3's demo-mode assertion) exists regardless
of what eventually satisfies it, and which review standard unlocks removing it is a decision
for whenever mechanism research actually begins.
