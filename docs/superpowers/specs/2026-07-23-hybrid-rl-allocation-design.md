# NEXMIND + FinRL-X Hybrid Position Sizing — Design

## Problem

`computeLot()` (`src/lib/trading/positionSizing.ts`) sizes every trade with a fixed formula:
target dollar risk / SL distance, shrunk by a correlation bucket. It has no notion of how
*confident* the desk is in a given setup, and it doesn't learn from outcomes — the same setup
always gets the same risk %, whether HAWK/SAGE barely agreed or agreed unanimously with a clean
risk picture.

The user wants to explore a hybrid architecture: keep NEXMIND's existing LLM decision flow
(Scanner → HAWK×3 → SAGE) as the **signal generator**, and add a reinforcement-learning
component (trained via [FinRL-X](https://arxiv.org/html/2603.21330v1)) as a **risk-adjusted
sizer** — a policy that learns how much of the portfolio to allocate to a setup given SAGE's
conviction and current portfolio state, trained to maximize risk-adjusted return (Sharpe/Sortino)
rather than following a fixed formula.

## Constraints established during brainstorming

- **HAWK/SAGE today have no usable confidence output for this.** HAWK has a per-persona 0-1
  `confidence` (`hawk.ts:10`) that is never aggregated; SAGE is a plain `approved: boolean`
  (`sage.ts:9`). Adding a real aggregate confidence output is new code, and is **out of scope**
  for this phase — see below.
- **No historical (state, action, reward) data exists.** The existing backtest engine
  (`backtest/engine.ts:1-3`) is explicitly "No AI, no I/O" — it never replays HAWK/SAGE. There is
  no recorded trajectory to train an RL policy on.
- **NEXMIND deploys to Vercel serverless** (`vercel.json`) with no Python runtime in production.
- **Trade flow is per-symbol, not portfolio-joint** — `runTradeTick(symbol, portfolioId, ...)`
  evaluates one candidate setup at a time; there is no simultaneous whole-watchlist rebalance.
- The user's own established practice is to blind-test any new strategy/mechanism against real
  outcomes before it's allowed to act live (see e.g. the `scripts/blind-test-*.mts` pattern) —
  this applies here too.

Given these constraints, the following scope was agreed for phase 1:

| Decision | Choice |
|---|---|
| Training data source | **Proxy confidence** computed from existing indicators (no live HAWK/SAGE replay — too costly/slow to run thousands of LLM calls over history) |
| Decision granularity | **Per-trade sizing** conditioned on portfolio state, not a joint multi-asset weight vector (matches the existing per-symbol trade-tick flow; no scanner rearchitecture) |
| Asset scope | **Gold desk only** — one portfolio, to prove the concept before generalizing |
| Training/inference split | **Offline training in Python (FinRL-X) → export ONNX → infer in Node** (`onnxruntime-node`) — no Python runtime in production |
| Rollout | **Shadow mode first** — RL proposes a size, logged alongside the real `computeLot()` size, but does not control real trades until reviewed and explicitly flipped on |

Explicitly **out of scope** for this phase:

- Replacing HAWK/SAGE's real decision flow, or wiring live SAGE confidence into the sizer (only
  the offline proxy signal is used to train; live proxy-vs-real calibration is future work).
- Multi-asset joint weight-vector allocation across the whole watchlist.
- Any portfolio other than the gold desk.
- A live/hosted Python inference service.
- Retraining automation (retraining is a manual/offline step for now).

## Architecture

```
OFFLINE (Python, outside the app, run manually/periodically)
  gold candle history
    → rlProxyConfidence() [reused from the Node lib via a thin data-export script]
    → state dataset (proxy alpha + market features + simulated portfolio state)
    → FinRL-X Gym env (reward = risk-adjusted return)
    → PPO training
    → export gold-sizer.onnx
    → commit into repo

LIVE / PAPER (Node, in-app, shadow mode)
  Scanner → HAWK×3 → SAGE (unchanged, real veto authority)
    → on approval: computeLot() sizes the REAL trade (unchanged)
    → in parallel: rlSizer.sizeWithRL(state) proposes a shadow weight/lot (logged only)
    → Iron Rules validates only the real computeLot() trade, exactly as today
```

`computeLot()` is never removed. It remains the default and the fallback in every failure case.

## Components

### 1. `src/lib/trading/rlProxyConfidence.ts` (new, pure)

```ts
export interface ProxyConfidenceInput {
  adx: number | null;
  rsi: number | null;
  plusDI: number | null;
  minusDI: number | null;
  side: "long" | "short";
}

/** Deterministic stand-in for what an aggregated HAWK/SAGE confidence might read,
 *  used only to label offline training data — never called on the live path. */
export function proxyConfidence(input: ProxyConfidenceInput): number; // -1..1
```

Derives a -1..1 score from trend strength (ADX above/below `DEFAULT_THRESHOLDS.adxFloor`) and
directional conviction (RSI distance from 50, DI spread), sign-aligned to `side`. Exact weighting
is an implementation detail for the plan phase — the contract that matters here is pure,
deterministic, -1..1 output from already-computed scanner fields.

### 2. Offline state-dataset builder (Node script, `scripts/rl/build-gold-dataset.ts`)

Walks gold candle history reusing the bar-stepping logic already in `backtest/engine.ts`
(warmup, snapshot-per-bar). For each scanner-flagged setup bar, emits one training row:

```ts
interface StateRow {
  proxyConfidence: number;   // from rlProxyConfidence()
  atr: number | null;
  adx: number | null;
  bbWidth: number | null;
  exposurePct: number;       // simulated open-position notional / balance at that point
  cashPct: number;
  drawdownPct: number;       // simulated running drawdown
  // label side/outcome carried alongside for reward computation, not part of state
}
```

Output: a CSV/parquet file consumed by the Python training script. This script has no network
calls beyond the existing candle-fetch path already used by other backtest scripts.

### 3. FinRL-X training script (Python, new `rl/` directory, offline only)

Wraps the dataset as a Gym-style environment: action = target weight (0..1 of allowed risk
budget), reward = risk-adjusted return computed the same way `computeStats` (Sharpe/Sortino)
already does in the existing stats module, ported to match. Trains PPO via FinRL-X, exports the
policy to `gold-sizer.onnx`. This script is never invoked by the running app — it's a manual
research step, run and re-run the same way the existing `scripts/sweep-*` / `blind-test-*`
scripts are today.

### 4. `src/lib/trading/rlSizer.ts` (new)

```ts
export interface RLState {
  proxyConfidence: number; // will be real SAGE-derived confidence in a future phase
  atr: number | null;
  adx: number | null;
  bbWidth: number | null;
  exposurePct: number;
  cashPct: number;
  drawdownPct: number;
}

export interface RLSizingResult {
  weight: number;  // clamped 0..1
  lot: number;     // converted using the same riskUsd/slDistance math as computeLot()
  available: boolean; // false if the ONNX model failed to load — caller must fall back
}

export function sizeWithRL(state: RLState, ctx: { entry: number; sl: number; riskUsd: number; maxLotPerTrade: number }): RLSizingResult;
```

Loads `gold-sizer.onnx` once (lazy singleton) via `onnxruntime-node`. On any load or inference
failure, returns `{ available: false, weight: 0, lot: 0 }` — callers must treat `available:
false` as "use `computeLot()`", never as "size zero this trade." Output weight/lot is clamped
defensively before being handed to anything downstream (belt-and-suspenders on top of Iron
Rules' own `maxLotPerTrade` clamp).

### 5. `engine.ts` wiring (shadow mode)

After SAGE approves and `computeLot()` produces the real `lot` (unchanged), when
`portfolioId` is the gold desk:

```ts
const rl = sizeWithRL(buildRLState(scan, portfolio), { entry: levels.entry, sl: levels.sl, riskUsd, maxLotPerTrade });
if (rl.available) {
  steps.push({ stage: "rl-shadow", note: `RL would size ${rl.lot} lot (weight ${rl.weight.toFixed(2)}) vs actual ${lot}` });
}
```

No behavior changes: the real trade still uses `computeLot()`'s `lot`, and Iron Rules validates
only that. This is purely additive logging via the existing `TickStep` decision-trail mechanism —
no new DB table needed.

### 6. Shadow-mode review script (`scripts/rl/compare-shadow-sizing.ts`)

Queries `Trade` rows for the gold portfolio, parses the `rl-shadow` decision-trail step, and
reports what P/L would have looked like if the RL-proposed lot had been used instead of the
actual lot — the same shape as the existing `scripts/blind-test-*.mts` reports. This is the gate
the user reviews before ever flipping `engine.ts` to use `rl.lot` as the real trade size.

## Error handling

- ONNX missing/fails to load, at any point (shadow or, later, live): `sizeWithRL` returns
  `available: false`. In shadow mode this just skips the log line. If a future phase flips gold
  to use RL sizing live, the wiring must check `available` and fall back to `computeLot()`'s
  `lot` — a trade is never left unsized because the model failed to load.
- Non-finite or out-of-range model output (NaN, weight outside 0..1): clamped inside `rlSizer.ts`
  before returning, same defensive posture as `positionSizing.ts`'s existing `slDistance <= 0`
  fallback.

## Testing

- `rlProxyConfidence.test.ts` — pure unit tests: known ADX/RSI/DI inputs → expected -1..1 output,
  sign flips correctly with `side`.
- `rlSizer.test.ts` — unit tests against a mocked ONNX session (no real model file needed in CI):
  weight→lot conversion math, clamping, and the `available: false` fallback path on a simulated
  load failure.
- `scripts/rl/build-gold-dataset.ts` — no automated test; validated manually by inspecting output
  row counts/ranges, consistent with how existing sweep/dataset scripts are validated today.
- `engine.test.ts` and `positionSizing.test.ts` are unaffected — the real trade path is unchanged
  in this phase.

## Out of scope (recap)

- Real HAWK/SAGE confidence replay for training data.
- Multi-asset joint weight-vector allocation.
- Any portfolio besides gold.
- A live Python inference service.
- Automated/scheduled retraining.
- Actually flipping the gold desk to use RL sizing live — that is a follow-up decision made
  after reviewing the shadow-mode comparison script's output.
