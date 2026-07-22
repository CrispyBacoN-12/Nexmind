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

**Sign convention (explicit, to avoid ambiguity):** the function first computes an *unsigned*
magnitude 0..1 of how strongly the indicators support the given `side` (trend strength via ADX
above/below `DEFAULT_THRESHOLDS.adxFloor`, directional conviction via RSI distance from 50 and DI
spread, both read in the direction implied by `side`) — then applies the sign mechanically as the
last step: **positive for `side: "long"`, negative for `side: "short"`.** So `+1.0` always means
"strong long conviction," `-1.0` always means "strong short conviction," and `side` is not a
redundant/competing signal — it only determines which raw indicator readings count as
"supportive" before the magnitude is computed. This keeps the meaning of the sign fixed regardless
of which side a given training row happens to be, which is what lets the PPO policy learn a single
consistent relationship between the alpha value and reward.

### 2. Offline state-dataset builder (Node script, `scripts/rl/build-gold-dataset.ts`)

Walks gold candle history reusing the bar-stepping logic already in `backtest/engine.ts`
(warmup, snapshot-per-bar). `exposurePct`, `cashPct`, and `drawdownPct` are time-series by
nature — they must reflect one continuously-simulated portfolio, not be recomputed
independently per setup bar. The script reuses the same position-lifecycle state machine
`backtest/engine.ts` already drives: `OpenPosition`, `LadderState`, `decideAction()`, and
`applySlippage()` from `src/lib/trading/positionRules.ts`. Concretely, the script keeps one
running simulated position/balance/peak-balance as it walks candles in order — on every bar it
first calls `decideAction()` against any currently-open simulated position to settle
holds/partials/closes (updating simulated balance and peak balance for drawdown), and only then,
on bars where the scanner also flags a setup, emits a training row and (for dataset purposes)
opens a new simulated position at that bar's entry. This is the same walk-forward, one-position-
at-a-time simulation `backtest/engine.ts` already performs — the dataset builder is not new
simulation logic, it's the existing logic instrumented to emit rows.

For each scanner-flagged setup bar, emits one training row:

```ts
interface StateRow {
  proxyConfidence: number;   // from rlProxyConfidence()
  atr: number | null;
  adx: number | null;
  bbWidth: number | null;
  exposurePct: number;       // from the running simulated position, not recomputed per-row
  cashPct: number;
  drawdownPct: number;       // running simulated drawdown from peak balance
  // label side/outcome carried alongside for reward computation, not part of state
}
```

Output: a CSV/parquet file consumed by the Python training script. This script has no network
calls beyond the existing candle-fetch path already used by other backtest scripts.

### 3. FinRL-X training script (Python, new `rl/` directory, offline only)

Wraps the dataset as a Gym-style environment: action = target weight (0..1 of allowed risk
budget), reward = risk-adjusted return computed the same way `computeStats` (Sharpe/Sortino)
already does in the existing stats module, ported to match. Trains PPO via FinRL-X, exports the
policy to `gold-sizer.onnx`.

**Normalization is baked into the exported ONNX graph, not shipped as a side-channel file.**
The script fits a scaler (Z-score or Min-Max, per feature) on the training dataset, then, at
export time, prepends the scaling as an explicit input layer to the PyTorch module before calling
the ONNX exporter (e.g. `onnx.helper` / a wrapping `nn.Module` that applies `(x - mean) / std`
before the policy network runs) — so `gold-sizer.onnx`'s graph itself accepts raw, unscaled
feature values and does the transform internally. This was chosen over exporting a separate
`scaler.json` for `rlSizer.ts` to apply, specifically to avoid two independently-maintained
implementations (Python training-time scaling vs. TypeScript inference-time scaling) drifting out
of sync — a class of bug that would be silent (the model would still produce a number, just a
wrong one) and hard to catch outside of the shadow-mode comparison. The training/export script is
never invoked by the running app — it's a manual research step, run and re-run the same way the
existing `scripts/sweep-*` / `blind-test-*` scripts are today.

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
  lot: number;     // converted using the same riskUsd/slDistance math as computeLot(); 0 means veto, see below
  vetoed: boolean; // true if the model's weight rounded down to less than minLot
  available: boolean; // false if the ONNX model failed to load — caller must fall back
}

export function sizeWithRL(state: RLState, ctx: { entry: number; sl: number; riskUsd: number; maxLotPerTrade: number; minLot: number }): RLSizingResult;
```

`state` is passed through as raw (unscaled) feature values — normalization happens inside the
ONNX graph itself (see Component 3), so `rlSizer.ts` never scales anything before building the
input tensor.

Loads `gold-sizer.onnx` once (lazy singleton) via `onnxruntime-node`. On any load or inference
failure, returns `{ available: false, weight: 0, lot: 0, vetoed: false }` — callers must treat
`available: false` as "use `computeLot()`", never as "size zero this trade."

**Zero/below-minimum size is a veto, not a round-up.** When the model's weight converts to a lot
below `ctx.minLot`, `sizeWithRL` returns `{ available: true, weight, lot: 0, vetoed: true }`
rather than rounding up to `minLot`. Rounding up would silently inflate a position the model
scored as not worth taking at all — inconsistent with a "risk-adjusted sizer" whose whole premise
is that size should track conviction, and inconsistent with the project's existing philosophy
(Iron Rules and `computeLot()` already prefer not-trading over forcing a marginal trade). In
shadow mode this only affects the logged comparison (a vetoed row shows as "RL would skip this
trade"); it has no effect on the real trade, which is unchanged in this phase. Output weight/lot
is clamped defensively before being handed to anything downstream (belt-and-suspenders on top of
Iron Rules' own `maxLotPerTrade` clamp).

### 5. `engine.ts` wiring (shadow mode)

After SAGE approves and `computeLot()` produces the real `lot` (unchanged), when
`portfolioId` is the gold desk:

```ts
const rl = sizeWithRL(buildRLState(scan, portfolio), { entry: levels.entry, sl: levels.sl, riskUsd, maxLotPerTrade, minLot });
if (rl.available) {
  const rlNote = rl.vetoed ? "RL would skip this trade (below min lot)" : `RL would size ${rl.lot} lot (weight ${rl.weight.toFixed(2)})`;
  steps.push({ stage: "rl-shadow", note: `${rlNote} vs actual ${lot}` });
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
- Weight that converts to a lot below `ctx.minLot`: not an error — returned as
  `{ vetoed: true, lot: 0 }` per Component 4 above, distinct from `available: false`.

## Testing

- `rlProxyConfidence.test.ts` — pure unit tests: known ADX/RSI/DI inputs → expected -1..1 output,
  sign flips correctly with `side` (positive for long, negative for short).
- `rlSizer.test.ts` — unit tests against a mocked ONNX session (no real model file needed in CI):
  weight→lot conversion math, clamping, the below-`minLot` veto path (`vetoed: true, lot: 0`),
  and the `available: false` fallback path on a simulated load failure. Since normalization is
  baked into the ONNX graph, these tests feed raw (unscaled) feature values, matching what
  `rlSizer.ts` does at runtime.
- `scripts/rl/build-gold-dataset.ts` — no automated test; validated manually by inspecting output
  row counts/ranges and spot-checking that `exposurePct`/`drawdownPct` move continuously bar-to-
  bar (not reset per row), consistent with how existing sweep/dataset scripts are validated today.
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
