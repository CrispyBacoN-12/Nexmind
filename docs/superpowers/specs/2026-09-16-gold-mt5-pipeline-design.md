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
3. **Build on the general-purpose MT5 bridge that already exists, not the stale branch.**
   `wip/mt5-xauusd` is 400+ days stale (`git merge-base` predates most of current history)
   and carries a dead mechanism and app-page symbol migrations that don't apply to a
   from-scratch build — it is not the port source. `mt5-bridge/bridge.py` and
   [src/lib/mt5.ts](../../../src/lib/mt5.ts) already exist on `master`, uncommitted, as a
   mature, gold-agnostic MT5 read/write provider (`/health`, `/quote`, `/candles`,
   `/symbols`, `/account`, `/margin`, `/ticks`, `/positions`, `/order`, `/close`), discovered
   during planning and confirmed with the owner. It already covers a substantial share of
   what this spec originally set out to build fresh: magic-number idempotency with an
   in-process order lock, a demo/real trading gate (`MT5_BRIDGE_ALLOW_TRADING` /
   `MT5_BRIDGE_ALLOW_REAL`, checked against `account_info.trade_mode` read live), a
   reconciliation read (`/positions`) deliberately served outside the trading gate, live
   contract specs (contract size, volume step, stops/freeze level, swap) instead of
   hardcoded assumptions, and tick-level bid/ask for spread modeling. This spec now treats
   that bridge and client as the foundation, not as something to port. See §1a for exactly
   what it already provides versus what the gold module still adds.
4. **MT5-only for now.** OANDA/PAXG from the old branch are not ported; MT5 serves both data
   and execution. Added later only if a real need appears.

## 1. Architecture

```
mt5-bridge/
  bridge.py        # EXISTING (uncommitted on master) — general-purpose MT5 HTTP bridge,
                    # not gold-specific. Reused as-is; see §1a for what it already covers.
src/lib/
  mt5.ts           # EXISTING (uncommitted on master) — TS client for bridge.py. Reused
                    # as-is; the gold module calls its exports, does not fork them.
src/lib/gold/
  types.ts         # Gold*-prefixed domain types + Zod schemas for the values that cross
                    # the mt5.ts boundary (candle, position, order result) — the shared
                    # contract that keeps the fake bridge (§4) honest against bridge.py
  retcodes.ts       # MT5 retcode -> typed bucket classification (RetriableWithNewQuote /
                    # TerminalRejection / MarketCondition), and the IN_FLIGHT_UNKNOWN
                    # resolver that queries positions/orders by magic after a timeout
  marketData.ts    # gold OHLCV: wraps mt5.ts's fetchMt5Candles/fetchMt5CandleRange with
                    # UTC normalization, gap detection + weekend-aware backfill, spread
                    # capture (via fetchMt5Ticks), and the staleness -> DEGRADED heartbeat
  broker.ts        # wraps mt5.ts's sendMt5Order/closeMt5Position/fetchMt5Positions with
                    # boot-up reconciliation, the live isDemoAccount() assertion before any
                    # order call, and the IN_FLIGHT_UNKNOWN resolver from retcodes.ts
scripts/
  gold-desk.mts    # entrypoint: env/config guard -> preflight healthcheck (bridge.py's own
                    # /health) -> boot reconciliation
```

## 1a. What the existing bridge already provides, and what the gold module adds

`mt5-bridge/bridge.py` and [src/lib/mt5.ts](../../../src/lib/mt5.ts) were discovered mid-planning: uncommitted, on `master`,
already implementing a mature, gold-agnostic MT5 provider. Nothing below is ported or
rewritten — the gold module is a thin, gold-specific layer on top of these exports.

| Concern from §0/§2/§3's original design | Already in `bridge.py` / `mt5.ts` | Gold module still adds |
|---|---|---|
| Demo-only execution gate | `_trading_refusal()` checks live `account_info.trade_mode` against `MT5_BRIDGE_ALLOW_REAL` (bridge-process-start-time switch, not a request-time flag) | `broker.ts` calls `isDemoAccount()` (already exported by `mt5.ts`) as a second, TS-side assertion immediately before every order call — belt-and-suspenders across two processes |
| Execution idempotency | `magicForTrade()` derives a stable key from the trade id; `bridge.py`'s `order_lock`/`find_by_magic` refuses a duplicate order and returns `{duplicate: true}` instead of resending | Nothing — this already is the idempotency design §2 asked for |
| In-flight-after-timeout resolution | Not present — `sendMt5Order` simply throws on a bridge timeout, leaving the caller not knowing if the order landed | New: `retcodes.ts`'s `IN_FLIGHT_UNKNOWN` resolver — on a `bridgePost` timeout, query `fetchMt5Positions`/bridge by the same magic before deciding sent vs. not-sent |
| Retcode handling | Bridge treats any non-`TRADE_RETCODE_DONE` as a single rejection class | New: `retcodes.ts` buckets the numeric retcode from `Mt5OrderResult`/thrown errors into `RetriableWithNewQuote` / `TerminalRejection` / `MarketCondition` (§3) |
| Boot-up reconciliation | `fetchMt5Positions()` exists and is deliberately served outside the trading gate | New: `broker.ts` calls it once at `gold-desk.mts` startup and syncs local state before any order call is allowed |
| Contract specs (lot step, contract size) | `fetchMt5Symbols()` returns live `volumeMin/Max/Step`, `tradeContractSize`, `tradeStopsLevel` — already broker-truth, not hardcoded | Nothing — read these at gold-module init instead of assuming equity-style sizing |
| Spread/bid-ask capture | `fetchMt5Ticks()` returns bid/ask ticks already | New: `marketData.ts` stores them alongside OHLCV on ingest (§2) |
| UTC normalization | Not present — `bridge.py` passes through `int(r["time"])` as epoch seconds from the terminal without a documented timezone contract | New: `marketData.ts` normalizes explicitly and is where the DST-transition fixture (§4) is tested |
| Gap detection + weekend-aware backfill | `fetchMt5CandleRange` handles paging/truncation within one request; nothing diffs expected-vs-present bars over time | New: `marketData.ts`'s gap routine (§2) |
| Staleness heartbeat / `DEGRADED` | Not present | New: `marketData.ts` (§2/§3) |
| Health/connectivity check | `bridge.py` serves `/health`; `bridgeFetch` already fails fast with a clear "bridge unreachable" error on timeout | New: `gold-desk.mts`'s preflight step just calls this before booting, per §1's original healthcheck requirement |

Key boundary decisions, updated for this foundation:

- **No shared runtime state with the stocks desk.** Gold runs as its own process
  (`npm run gold`, its own `scripts/gold-desk.mts`), never folded into `scripts/dev.mts` or
  `scripts/session.mts`. This mirrors the stocks desk's own hard-won lesson
  (`docs/STATE.md` §5: starting `nexmind-dev` instead of `nexmind-dev-web` once triggered a
  real desk session and spent real budget) — a shared entrypoint is exactly the shape that
  incident had. `mt5.ts` and `bridge.py` themselves are shared, general-purpose
  infrastructure (not gold-owned), but nothing under `src/lib/gold/` is imported by the
  stocks desk, and `gold-desk.mts` is the only process that calls `mt5.ts`'s write path.
- **Config guard at boot, scoped to what actually exists.** `bridge.py`/`mt5.ts` already use
  unambiguous, non-gold-prefixed names (`MT5_BRIDGE_SECRET`, `MT5_BRIDGE_URL`,
  `MT5_BRIDGE_ALLOW_TRADING`, `MT5_BRIDGE_ALLOW_REAL`) — there is no Webull/Alpaca naming
  collision to guard against, so a separate `GOLD_MT5_*` namespace would just rename working
  config for no safety gain. `scripts/gold-desk.mts` instead validates that
  `MT5_BRIDGE_SECRET` is set and that `MT5_BRIDGE_ALLOW_REAL` is **not** `"1"` before doing
  anything else, refusing to boot into a session that could reach a real account, then runs
  the preflight healthcheck.
- **Shared contract schema between TS and the bridge's actual JSON shapes.** `src/lib/gold/
  types.ts` defines Zod schemas matching the JSON `mt5.ts`'s `bridgeFetch`/`bridgePost` already
  parse (candle, symbol, account, tick, position, order-result). This is what keeps the
  in-process fake bridge used in CI (§4) from silently drifting away from what the real
  bridge actually returns.
- **No GC=F->XAUUSD symbol migration touching existing app pages.** That migration in the
  old branch rewired *existing* pages; here there is no existing gold page. New routes are
  built fresh under `/gold/...` from day one, with no shared conditional asset-type branching
  against the stocks pages.
- **Explicit `bridge.py` dependency, checked at boot, not discovered mid-debug.** It requires
  a local MetaTrader terminal — this only runs from a machine with MT5 installed, never CI/
  server. `scripts/gold-desk.mts` calls `bridge.py`'s existing `/health` endpoint with a short
  timeout before doing anything else and throws an actionable error ("MT5 Bridge not detected
  at 127.0.0.1:8787. Start the MT5 terminal and run `python bridge.py` first.") instead of
  hanging on a dead socket. The module's README states the requirement up front.

## 2. Data flow

Two independent flows, deliberately not sharing a pipeline (a CQRS-style split):

**Market data (read path):**
```
MT5 terminal -> bridge.py (existing) -> mt5.ts (existing: fetchMt5Candles/
             fetchMt5CandleRange/fetchMt5Ticks) -> gold/marketData.ts (new: normalize +
             UTC + gap-fill + spread capture) -> storage/consumer
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
manual test harness (no mechanism exists yet) -> gold/broker.ts (new) -> mt5.ts (existing:
    sendMt5Order/closeMt5Position) -> bridge.py (existing) -> MT5
                    ^
    isDemoAccount() assertion, on top of bridge.py's own ALLOW_REAL gate (see §3)
```

Until a mechanism passes review, the only caller of `broker.ts`'s order-placement function is
a manual test harness proving the execution path works end-to-end — there is no auto-signal
generator in this phase. When mechanism research resumes later, its output plugs into this
same `broker.ts` entrypoint; §3's gate is what stops it from reaching a live account
prematurely.

- **Boot-up reconciliation.** Before `broker.ts` allows any order call, it calls `mt5.ts`'s
  existing `fetchMt5Positions()` (backed by `bridge.py`'s `/positions`, deliberately served
  outside its trading gate) and syncs local state — no blind first order after a process
  restart.
- **Execution idempotency with an explicit in-flight state.** `mt5.ts`'s `magicForTrade()` and
  `bridge.py`'s per-magic `order_lock` already make a *repeated* call safe (§1a) — a second
  `sendMt5Order` with the same magic comes back `{duplicate: true}` instead of resending.
  What's missing is the timeout case: if `bridgePost`'s own timeout fires before a response
  arrives, whether the order landed is unknown. `retcodes.ts`'s resolver moves that order to
  `IN_FLIGHT_UNKNOWN` and resolves it by calling `fetchMt5Positions()` for the same magic
  before collapsing to confirmed-sent or confirmed-not-sent. No retry ever fires before that
  resolution completes.

## 3. Error handling and the live-trading gate

This section makes "demo/paper until a mechanism passes review" a property of the code.

- **Two independent demo gates, not one.** `bridge.py` already refuses to trade a non-demo/
  contest account unless it was started with `MT5_BRIDGE_ALLOW_REAL=1` (`_trading_refusal()`,
  checked against a live `account_info.trade_mode` read, not a cached value). `broker.ts` adds
  a second, TS-side assertion — `mt5.ts`'s existing `isDemoAccount()`, also backed by a live
  `/account` read — immediately before every order call. This catches two different mistakes:
  someone starting the bridge with `MT5_BRIDGE_ALLOW_REAL=1` by habit, or someone alt-logging
  the terminal into a real account after the bridge already started. There is no
  gold-module-level `ALLOW_LIVE` flag; going live later means deliberately changing both the
  bridge's launch env and `broker.ts`'s assertion — two reviewable changes, not one.
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

- **`gold/marketData.ts`, `gold/broker.ts`, and `gold/retcodes.ts` unit-tested against an
  in-process fake bridge** that stands in for `bridge.py` at the HTTP layer `mt5.ts` already
  talks to, told to return specific retcodes, timeouts, or stale/missing data on demand. This
  is where the retcode buckets, the `IN_FLIGHT_UNKNOWN` resolver, the `DEGRADED` staleness
  transition, and the demo-mode assert all get exercised deterministically in CI. The shared
  Zod schema (`gold/types.ts`, §1a) is what keeps this fake from drifting away from what the
  real bridge actually returns.
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
  spread-tracked) and order execution (place/query/reconcile), both demo-account-gated,
  built on top of the existing `mt5.ts`/`bridge.py` (§1a) rather than porting or forking them.
- A dedicated `npm run gold` entrypoint with a config guard (§1) and preflight healthcheck.
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
