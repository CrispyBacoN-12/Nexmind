# Hybrid RL Allocation (Gold Desk, Shadow Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an offline-trained RL risk-adjusted sizer for the gold desk that runs in shadow mode alongside the real `computeLot()` sizing — logged for review, never controlling real trades in this phase.

**Architecture:** An offline Python pipeline (dataset export → FinRL-X-style PPO training via Gymnasium/stable-baselines3 → ONNX export with normalization baked into the graph) produces `rl/gold-sizer.onnx`, committed into the repo. The live Node app loads it lazily via `onnxruntime-node` and, only for the gold desk (`symbol === "GC=F"`), computes a shadow weight/lot alongside the real trade and logs it to the existing `TickStep` decision trail. `computeLot()` remains the only sizer that controls real trades.

**Tech Stack:** TypeScript/Node (existing stack: Prisma, `node:test`), Python 3.11+ (Gymnasium, stable-baselines3, PyTorch, ONNX) for offline training only, `onnxruntime-node` for live inference.

## Global Constraints

- Training data source: proxy confidence computed from existing indicators — no live HAWK/SAGE replay (too costly to run thousands of LLM calls over history).
- Decision granularity: per-trade sizing conditioned on portfolio state, not a joint multi-asset weight vector.
- Asset scope: gold desk only (`symbol === "GC=F"`) — no other portfolio is touched.
- Training/inference split: offline training in Python → export ONNX → infer in Node (`onnxruntime-node`). No Python runtime in production (Vercel serverless has none).
- Rollout: shadow mode only. RL proposes a size, logged alongside the real `computeLot()` size, but never controls a real trade in this phase.
- Normalization is baked into the exported ONNX graph itself, not shipped as a side-channel `scaler.json` — `rlSizer.ts` always passes raw, unscaled feature values.
- Zero/below-`minLot` model output is a veto (`vetoed: true, lot: 0`), never rounded up to `minLot`.
- `available: false` (ONNX load/inference failure) must be treated by callers as "fall back to `computeLot()`", never as "size zero this trade."
- Out of scope for this phase: replacing HAWK/SAGE, multi-asset joint allocation, any portfolio besides gold, a live/hosted Python inference service, automated retraining, and actually flipping gold to live RL sizing (a follow-up decision after reviewing shadow-mode output).
- `computeLot()` is never removed and remains the default/fallback in every failure case.

---

## Decision Log

**2026-07-25 — `exposurePct`/`cashPct`/`drawdownPct` definition, resolved by SaladPak.**

Task 2's implementation (`scripts/rl/build-gold-dataset.ts`, commit `b92e992`) computes these
three features as *continuous, single-position* quantities: `exposurePct = RISK_USD / balance`
(a running simulated balance), `cashPct = 1 - exposurePct`, and `drawdownPct` as the running
simulated peak-to-trough equity drawdown. This was flagged in review as a mismatch against this
plan's original Task 5 draft, which computed `exposurePct` from the discrete
`openPositions / maxOpenPositions` slot fraction and `drawdownPct` from
`dailyLossUsd / dailyLossCapUsd` (an Iron-Rules gate threshold, not an equity curve). Feeding a
model trained on one definition with the other at inference time would silently make every
feature except `proxyConfidence`/`atr`/`adx`/`bbWidth` meaningless to the trained policy.

**Resolution: Task 5's `buildRLState` is redefined to match Task 2's continuous definitions
exactly**, not the discrete slot/cap-fraction ones. Rationale:
- This phase's scope (Global Constraints above) is gold-desk shadow mode with the desk holding
  at most one simulated position at a time in training — exactly what Task 2 already simulates.
  There is no multi-position portfolio concept in scope to make a discrete slot-fraction
  meaningful, so there's no competing use case the continuous definition would sacrifice.
- The original design doc (`docs/superpowers/specs/2026-07-23-hybrid-rl-allocation-design.md`,
  Component 2) already specified `exposurePct`/`drawdownPct` as continuous, running,
  peak-balance-derived quantities — the discrete slot/cap-fraction version was a drift introduced
  only in this plan's Task 5 transcription, not a deliberate design choice.
- A live equivalent already exists and needs no new tracker: `circuitBreaker.ts`'s
  `getCurrentDrawdownPct`/`currentDrawdownPct` already compute peak-to-trough drawdown over
  realized equity (`startingBalance + cumulative closed-trade P/L`) for the existing circuit
  breaker. Task 5 (below) adds a sibling `currentEquity`/`getCurrentEquity` to the same file to
  expose the equity figure `exposurePct = riskUsd / balance` needs, reusing the same
  closed-trades query/fold pattern rather than inventing a new one.
- This does not touch the Global Constraint 7-feature vector (`proxyConfidence, atr, adx,
  bbWidth, exposurePct, cashPct, drawdownPct`) — only how the last three are computed at
  inference time.

No changes to Task 1–4 or Task 6 result from this. Task 2 requires no code changes — its
definitions were correct all along; the plan's Task 5 draft was wrong. This is recorded here
(and in `buildRLState`'s doc comment) so the reasoning survives independent of any one
conversation's context.

---

**2026-07-25 — `proxyConfidence` exact-antisymmetry test assertion, resolved by SaladPak.**

Task 5's brief (`rl-task-5-brief.md`, Step 5) specified a test asserting
`long.proxyConfidence === -short.proxyConfidence` for identical (non-mirrored) indicator
readings with only `side` flipped. Against Task 1's actual, already-committed, already-reviewed
`rlProxyConfidence.ts` (commit `c670f31`), this assertion is mathematically false whenever the
raw indicators favor one side: `rsiConviction`/`diConviction` are each `clamp01`'d per side before
averaging with the side-independent `trendStrength` term, so the side that disagrees with the raw
indicators clamps its conviction terms to 0 instead of going negative — breaking exact negation.
Hand-verified for the brief's own fixture (`adx=30, rsi=60, plusDI=25, minusDI=10`):
`trendStrength=0.5` (side-independent); long: `(0.5+0.2+0.3)/3=0.333`; short:
`(0.5+0+0)/3=0.167`. Exact antisymmetry only holds in the degenerate all-neutral case
(`rsi=50`, `plusDI=minusDI`, `adx=adxFloor`), which is not a meaningful test of anything.

**Resolution: the test is changed to assert sign polarity instead of exact negation** —
`long.proxyConfidence > 0` and `short.proxyConfidence < 0` — which still confirms the thing the
test exists to catch (that `buildRLState` forwards `side` into `proxyConfidence` rather than
hardcoding `"long"`), without asserting an invariant the formula was never designed to satisfy.
`rlProxyConfidence.ts` itself is deliberately left unchanged: `rl/gold-sizer.onnx` (Task 3) is
already trained against its current output, via Task 2's dataset builder using this exact formula
to label real historical rows. Changing the formula now — even to "fix" this asymmetry — would
alter `proxyConfidence`'s value for ordinary (non-edge-case) indicator combinations broadly, not
just this pathological identical-indicator-flip scenario, silently invalidating the trained
model's learned relationship to that feature (the same train/inference mismatch class as the
Decision Log entry above). Retraining is out of scope for Task 5 (shadow-mode wiring only).

No changes to Task 1–4 or Task 6 result from this. See `rl-task-5-report.md` for the full
derivation and `engine.test.ts`'s inline comment on the corrected test.

---

## File Structure

- `src/lib/trading/rlProxyConfidence.ts` (new) — pure function producing the -1..1 signed proxy confidence label used only for offline training-data generation.
- `src/lib/trading/rlProxyConfidence.test.ts` (new) — unit tests for the above.
- `scripts/rl/build-gold-dataset.ts` (new) — offline Node script; walks gold candle history, drives one continuously-simulated position via `positionRules.ts`, emits training rows to stdout as CSV.
- `rl/requirements.txt` (new) — Python dependencies for offline training.
- `rl/train_gold_sizer.py` (new) — offline PPO training script; consumes the CSV, exports `rl/gold-sizer.onnx` with normalization baked into the graph.
- `src/lib/trading/rlSizer.ts` (new) — loads the ONNX model (lazy singleton), converts model weight → lot using the same risk math as `computeLot()`, implements the veto/available semantics.
- `src/lib/trading/rlSizer.test.ts` (new) — unit tests against a mocked ONNX session (no model file needed in CI).
- `package.json` (modify) — add `onnxruntime-node` dependency.
- `src/lib/trading/circuitBreaker.ts` (modify) — add `currentEquity`/`getCurrentEquity`, a sibling to the existing `currentDrawdownPct`/`getCurrentDrawdownPct`, exposing the realized-equity figure `buildRLState`'s `exposurePct` needs (see Decision Log above).
- `src/lib/trading/circuitBreaker.test.ts` (modify) — add tests for `currentEquity`.
- `src/lib/trading/engine.ts` (modify) — add optional `TickStep.data` field, hoist `account` construction earlier, add `buildRLState()`, wire shadow-mode `rl-shadow` logging gated to `symbol === "GC=F"`.
- `src/lib/trading/engine.test.ts` (modify) — add tests for `buildRLState()`.
- `scripts/rl/compare-shadow-sizing.ts` (new) — offline review script; reports counterfactual P/L from the `rl-shadow` log entries.

---

### Task 1: `rlProxyConfidence.ts` — offline training-label function

**Files:**
- Create: `src/lib/trading/rlProxyConfidence.ts`
- Test: `src/lib/trading/rlProxyConfidence.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_THRESHOLDS` from `./scanner` (`{ adxFloor: number; rsiLow: number; rsiHigh: number }`).
- Produces: `ProxyConfidenceInput { adx: number | null; rsi: number | null; plusDI: number | null; minusDI: number | null; side: "long" | "short" }` and `proxyConfidence(input: ProxyConfidenceInput): number` — consumed by Task 2 (`build-gold-dataset.ts`) and Task 5 (`engine.ts`'s `buildRLState`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/trading/rlProxyConfidence.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { proxyConfidence } from "./rlProxyConfidence";

test("proxyConfidence: strong long conviction produces a positive value", () => {
  const v = proxyConfidence({ adx: 40, rsi: 65, plusDI: 30, minusDI: 10, side: "long" });
  assert.ok(v > 0, `expected positive, got ${v}`);
  assert.ok(v <= 1);
});

test("proxyConfidence: mirrored indicators for the opposite side produce the negated magnitude", () => {
  const long = proxyConfidence({ adx: 40, rsi: 65, plusDI: 30, minusDI: 10, side: "long" });
  const short = proxyConfidence({ adx: 40, rsi: 35, plusDI: 10, minusDI: 30, side: "short" });
  assert.equal(short, -long);
});

test("proxyConfidence: missing indicator data returns exactly 0", () => {
  assert.equal(proxyConfidence({ adx: null, rsi: 60, plusDI: 20, minusDI: 10, side: "long" }), 0);
  assert.equal(proxyConfidence({ adx: 30, rsi: null, plusDI: 20, minusDI: 10, side: "long" }), 0);
});

test("proxyConfidence: side alone flips the sign when indicators are neutral", () => {
  const neutral = { adx: 30, rsi: 50, plusDI: 20, minusDI: 20 };
  const long = proxyConfidence({ ...neutral, side: "long" });
  const short = proxyConfidence({ ...neutral, side: "short" });
  assert.equal(short, -long);
  assert.ok(long > 0); // trend strength alone still contributes above the ADX floor
});

test("proxyConfidence: ADX at the setup-gate floor contributes zero trend-strength", () => {
  const v = proxyConfidence({ adx: 20, rsi: 50, plusDI: 20, minusDI: 20, side: "long" });
  assert.equal(v, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/trading/rlProxyConfidence.test.ts`
Expected: FAIL — `Cannot find module './rlProxyConfidence'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/trading/rlProxyConfidence.ts
// Deterministic stand-in for what an aggregated HAWK/SAGE confidence might
// read, used only to label OFFLINE training data (scripts/rl/build-gold-dataset.ts)
// — never called on the live decision path (HAWK/SAGE keep real veto authority).

import { DEFAULT_THRESHOLDS } from "./scanner";

export interface ProxyConfidenceInput {
  adx: number | null;
  rsi: number | null;
  plusDI: number | null;
  minusDI: number | null;
  side: "long" | "short";
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Computes an unsigned magnitude 0..1 of how strongly indicators support
 * `side`, then applies the sign mechanically as the last step: positive for
 * "long", negative for "short" — so +1.0 always means "strong long
 * conviction" regardless of which raw readings produced it.
 */
export function proxyConfidence(input: ProxyConfidenceInput): number {
  const { adx, rsi, plusDI, minusDI, side } = input;
  if (adx == null || rsi == null || plusDI == null || minusDI == null) return 0;

  // Trend strength: how far ADX sits above the setup-gate floor, saturating at 2x floor.
  const trendStrength = clamp01((adx - DEFAULT_THRESHOLDS.adxFloor) / DEFAULT_THRESHOLDS.adxFloor);

  // RSI distance from 50, read in the direction `side` wants (long wants >50, short wants <50).
  const rsiSigned = side === "long" ? rsi - 50 : 50 - rsi;
  const rsiConviction = clamp01(rsiSigned / 50);

  // DI spread, read in the direction `side` wants (long wants +DI>-DI, short the mirror).
  const diSigned = side === "long" ? plusDI - minusDI : minusDI - plusDI;
  const diConviction = clamp01(diSigned / 50);

  const magnitude = clamp01((trendStrength + rsiConviction + diConviction) / 3);
  return side === "long" ? magnitude : -magnitude;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/trading/rlProxyConfidence.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/trading/rlProxyConfidence.ts src/lib/trading/rlProxyConfidence.test.ts
git commit -m "feat(rl): add proxyConfidence, the offline training-label function"
```

---

### Task 2: Offline gold dataset builder (`scripts/rl/build-gold-dataset.ts`)

**Files:**
- Create: `scripts/rl/build-gold-dataset.ts`

**Interfaces:**
- Consumes: `fetchCandles` (`@/lib/marketData`), `sma/rsi/macd/atr/adx` (`@/lib/indicators`), `decideSetup`/`DEFAULT_THRESHOLDS` (`./scanner`), `decideAction`/`applySlippage`/`OpenPosition`/`LadderState` (`./positionRules`), `proxyConfidence` (Task 1), `DEFAULT_COST_MODEL` (`@/lib/backtest/engine`).
- Produces: a CSV on stdout with columns `proxyConfidence,atr,adx,bbWidth,exposurePct,cashPct,drawdownPct,side,reward` — consumed by Task 3's Python training script (`FEATURES` list there must match this column order/name set exactly, minus `side`/`reward`).

No automated test — this is an offline research script, same category as `scripts/blind-test-gold.ts`, validated manually per the design doc's Testing section.

- [ ] **Step 1: Write the script**

```ts
// scripts/rl/build-gold-dataset.ts
// Offline dataset builder for the RL sizer's training data. Walks gold candle
// history, driving ONE continuously-simulated position via the same
// position-lifecycle state machine (OpenPosition/LadderState/decideAction/
// applySlippage) the live desk and backtester use, so exposurePct/cashPct/
// drawdownPct are genuine running values, not per-row artifacts.
// Usage: npx tsx scripts/rl/build-gold-dataset.ts > rl/data/gold-dataset.csv

import { fetchCandles } from "../../src/lib/marketData";
import { sma, rsi, macd, atr, adx, type Candle } from "../../src/lib/indicators";
import { decideSetup, DEFAULT_THRESHOLDS, type ScanSnapshot } from "../../src/lib/trading/scanner";
import { decideAction, applySlippage, type OpenPosition, type LadderState } from "../../src/lib/trading/positionRules";
import { proxyConfidence } from "../../src/lib/trading/rlProxyConfidence";
import { DEFAULT_COST_MODEL } from "../../src/lib/backtest/engine";

const SYMBOL = "GC=F";
const WARMUP = 60;
const STARTING_BALANCE = 10000;
const RISK_USD = 100;
const ATR_SL_MULT = 1.5;
const ATR_TP_MULT = 2.5;
const TP2_FACTOR = 1.6;

interface StateRow {
  proxyConfidence: number;
  atr: number | null;
  adx: number | null;
  bbWidth: number | null;
  exposurePct: number;
  cashPct: number;
  drawdownPct: number;
  side: "long" | "short";
  reward: number; // filled in with the realized R-multiple once the position this row opened closes
}

function snapshots(candles: Candle[]): ScanSnapshot[] {
  const closes = candles.map((c) => c.c);
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const r = rsi(closes, 14);
  const { histogram } = macd(closes);
  const atrArr = atr(candles, 14);
  const { adx: adxArr, plusDI, minusDI } = adx(candles, 14);
  return candles.map((c, i) => ({
    price: c.c, sma20: s20[i], sma50: s50[i], rsi: r[i], adx: adxArr[i],
    plusDI: plusDI[i], minusDI: minusDI[i], macdHist: histogram[i], atr: atrArr[i],
  }));
}

/** Bollinger bandwidth at bar i, matching scanner.ts's bbWidth definition: (upper-lower)/middle. */
function bbWidthAt(closes: number[], i: number, period = 20, mult = 2): number | null {
  if (i < period - 1) return null;
  const slice = closes.slice(i - period + 1, i + 1);
  const mean = slice.reduce((s, x) => s + x, 0) / period;
  const variance = slice.reduce((s, x) => s + (x - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return mean === 0 ? null : (2 * mult * sd) / mean;
}

async function main() {
  const resp = await fetchCandles(SYMBOL, "5y", "1h");
  const candles = resp.candles;
  const closes = candles.map((c) => c.c);
  const snaps = snapshots(candles);

  let openPos: OpenPosition | null = null;
  let ladder: LadderState = {};
  let openLot = 0;
  let balance = STARTING_BALANCE;
  let peakBalance = STARTING_BALANCE;

  const rows: StateRow[] = [];
  let pendingRows: StateRow[] = []; // rows waiting for their position to close

  for (let i = WARMUP; i < candles.length; i++) {
    const bar = candles[i];
    const price = bar.c;

    if (openPos) {
      const action = decideAction(openPos, ladder, price);
      if (action.kind === "partial-tp1") {
        const exit = applySlippage(openPos.side === "long" ? "sell" : "buy", action.exit, DEFAULT_COST_MODEL.slippageBps ?? 0);
        const favorableMove = openPos.side === "long" ? exit - openPos.entry : openPos.entry - exit;
        const partialPnl = favorableMove * (openLot / 2);
        balance += partialPnl;
        ladder = { tp1Hit: true, partialPnl, origSl: openPos.sl };
        openPos = { ...openPos, sl: openPos.entry };
      } else if (action.kind === "close") {
        const exit = applySlippage(openPos.side === "long" ? "sell" : "buy", action.exit, DEFAULT_COST_MODEL.slippageBps ?? 0);
        const remainingLot = ladder.tp1Hit ? openLot / 2 : openLot;
        const favorableMove = openPos.side === "long" ? exit - openPos.entry : openPos.entry - exit;
        const pnl = (ladder.partialPnl ?? 0) + favorableMove * remainingLot;
        balance += pnl;
        const risk = Math.abs(openPos.entry - (ladder.origSl ?? openPos.sl));
        const rMultiple = risk > 0 ? pnl / (risk * openLot) : 0;
        for (const row of pendingRows) row.reward = rMultiple;
        pendingRows = [];
        openPos = null;
        ladder = {};
      }
    }

    peakBalance = Math.max(peakBalance, balance);
    const drawdownPct = peakBalance > 0 ? (peakBalance - balance) / peakBalance : 0;
    const exposurePct = openPos ? RISK_USD / balance : 0;
    const cashPct = 1 - exposurePct;

    if (!openPos) {
      const { side } = decideSetup(snaps[i], DEFAULT_THRESHOLDS);
      if (side) {
        const a = snaps[i].atr ?? bar.c * 0.005;
        const dir = side === "long" ? 1 : -1;
        const entry = applySlippage(side === "long" ? "buy" : "sell", bar.c, DEFAULT_COST_MODEL.slippageBps ?? 0);
        const sl = entry - dir * ATR_SL_MULT * a;
        const tp1 = entry + dir * ATR_TP_MULT * a;
        const tp2 = entry + dir * ATR_TP_MULT * TP2_FACTOR * a;
        openPos = { side, entry, sl, tp1, tp2 };
        ladder = {};
        openLot = RISK_USD / Math.abs(entry - sl);

        const row: StateRow = {
          proxyConfidence: proxyConfidence({ adx: snaps[i].adx, rsi: snaps[i].rsi, plusDI: snaps[i].plusDI, minusDI: snaps[i].minusDI, side }),
          atr: snaps[i].atr,
          adx: snaps[i].adx,
          bbWidth: bbWidthAt(closes, i),
          exposurePct, cashPct, drawdownPct, side,
          reward: 0,
        };
        rows.push(row);
        pendingRows.push(row);
      }
    }
  }

  console.log("proxyConfidence,atr,adx,bbWidth,exposurePct,cashPct,drawdownPct,side,reward");
  for (const r of rows) {
    console.log([r.proxyConfidence, r.atr ?? "", r.adx ?? "", r.bbWidth ?? "", r.exposurePct, r.cashPct, r.drawdownPct, r.side, r.reward].join(","));
  }
  console.error(`\n${rows.length} training rows written; ${pendingRows.length} still open at end of history (reward left at 0)`);
}

main();
```

- [ ] **Step 2: Run it and manually verify the output**

Run: `npx tsx scripts/rl/build-gold-dataset.ts > rl/data/gold-dataset.csv`
Expected: stderr prints a row count in the low hundreds to low thousands (5y of 1h gold bars through the existing setup gate); `rl/data/gold-dataset.csv` has a header line plus that many data rows. Spot-check with `Get-Content rl/data/gold-dataset.csv -TotalCount 5` (PowerShell) that `exposurePct`/`cashPct` alternate between 0/1 and fractional values (not always 0), and that most `reward` values are non-zero (a handful of trailing rows near end-of-history may legitimately stay 0 — still-open positions).

- [ ] **Step 3: Commit**

```bash
git add scripts/rl/build-gold-dataset.ts
git commit -m "feat(rl): add offline gold-dataset builder for RL sizer training"
```

---

### Task 3: FinRL-X-style PPO training + ONNX export (Python, offline)

**Files:**
- Create: `rl/requirements.txt`
- Create: `rl/train_gold_sizer.py`

**Interfaces:**
- Consumes: the CSV produced by Task 2 (`rl/data/gold-dataset.csv`), columns `proxyConfidence,atr,adx,bbWidth,exposurePct,cashPct,drawdownPct,side,reward`.
- Produces: `rl/gold-sizer.onnx` — an ONNX graph with input `state` (shape `[batch, 7]`, raw unscaled features in the exact order `proxyConfidence, atr, adx, bbWidth, exposurePct, cashPct, drawdownPct`) and output `weight` (shape `[batch, 1]`). Consumed by Task 4's `rlSizer.ts`.

No automated test (Python offline research script, no CI harness in this repo) — validated manually per the design doc's Testing section.

> Note on FinRL-X: this script is written directly against Gymnasium + stable-baselines3's `PPO` — the underlying, versioned, verifiable primitives FinRL-style wrappers build on — rather than importing FinRL-X's own wrapper classes, since this plan can't verify FinRL-X's exact current API surface at write time. The Gym env below implements exactly the FinRL-X-style design from the spec (state = market+portfolio features, action = target weight, reward = risk-adjusted return, PPO training). Swap in FinRL-X's own env/trainer wrapper later if desired — the ONNX export contract (Component 3 of the spec) is unaffected either way.

- [ ] **Step 1: Write `rl/requirements.txt`**

```
gymnasium==1.0.0
stable-baselines3==2.4.0
torch==2.5.1
onnx==1.17.0
pandas==2.2.3
numpy==2.1.3
```

- [ ] **Step 2: Write `rl/train_gold_sizer.py`**

```python
"""
Offline PPO training for the gold desk's RL risk-adjusted sizer.

Trains against scripts/rl/build-gold-dataset.ts's output (a CSV of
proxyConfidence/atr/adx/bbWidth/exposurePct/cashPct/drawdownPct/side/reward
rows, one row per historical setup). Exports gold-sizer.onnx with feature
normalization baked into the graph, so rlSizer.ts never scales anything --
see the design doc's Component 3 for why (avoiding a Python/TypeScript
scaling side-channel that could silently drift out of sync).

Usage:
    pip install -r rl/requirements.txt
    python rl/train_gold_sizer.py --dataset rl/data/gold-dataset.csv --out rl/gold-sizer.onnx
"""
import argparse

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import gymnasium as gym
from gymnasium import spaces
from stable_baselines3 import PPO

FEATURES = ["proxyConfidence", "atr", "adx", "bbWidth", "exposurePct", "cashPct", "drawdownPct"]
ANNUAL_TRADING_DAYS = 252  # matches src/lib/trading/stats.ts's ANNUAL_TRADING_DAYS


def sharpe_like_reward(r_multiples: np.ndarray) -> float:
    """Matches stats.ts's sharpeRatio(): sqrt(252) * mean/std. Each row here is
    one trade's realized R-multiple scaled by the chosen weight, standing in
    for one day's P/L in the absence of a real daily equity curve."""
    if len(r_multiples) < 2:
        return 0.0
    std = r_multiples.std()
    if std <= 1e-12:
        return 0.0
    return float(np.sqrt(ANNUAL_TRADING_DAYS) * (r_multiples.mean() / std))


class GoldSizingEnv(gym.Env):
    """One episode = one full pass over the dataset in order. Action = target
    weight 0..1 of the allowed risk budget for that row's setup. Reward is
    given only at episode end (the Sharpe-like ratio over the whole episode's
    weighted R-multiples) so the policy is trained on risk-adjusted return,
    not a per-step P/L signal."""

    metadata = {"render_modes": []}

    def __init__(self, df: pd.DataFrame):
        super().__init__()
        self.df = df.reset_index(drop=True)
        self.observation_space = spaces.Box(low=-np.inf, high=np.inf, shape=(len(FEATURES),), dtype=np.float32)
        self.action_space = spaces.Box(low=0.0, high=1.0, shape=(1,), dtype=np.float32)
        self._i = 0
        self._weighted_r: list[float] = []

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self._i = 0
        self._weighted_r = []
        return self._obs(), {}

    def _obs(self) -> np.ndarray:
        row = self.df.iloc[self._i]
        return row[FEATURES].to_numpy(dtype=np.float32)

    def step(self, action):
        weight = float(np.clip(action[0], 0.0, 1.0))
        row = self.df.iloc[self._i]
        self._weighted_r.append(weight * float(row["reward"]))
        self._i += 1
        terminated = self._i >= len(self.df)
        reward = sharpe_like_reward(np.array(self._weighted_r)) if terminated else 0.0
        obs = self._obs() if not terminated else np.zeros(len(FEATURES), dtype=np.float32)
        return obs, reward, terminated, False, {}


class NormalizedPolicy(nn.Module):
    """Wraps the trained actor pipeline with a baked-in (x-mean)/std layer, so
    the exported ONNX graph accepts raw feature values -- see the design
    doc's Component 3 for why normalization is baked in rather than shipped
    as a side-channel scaler.json."""

    def __init__(self, actor: nn.Module, mean: np.ndarray, std: np.ndarray):
        super().__init__()
        self.actor = actor
        self.register_buffer("mean", torch.tensor(mean, dtype=torch.float32))
        self.register_buffer("std", torch.tensor(std, dtype=torch.float32))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        normalized = (x - self.mean) / self.std
        return self.actor(normalized)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--out", default="rl/gold-sizer.onnx")
    parser.add_argument("--timesteps", type=int, default=200_000)
    args = parser.parse_args()

    df = pd.read_csv(args.dataset)
    df = df.dropna(subset=FEATURES + ["reward"])
    print(f"Loaded {len(df)} training rows from {args.dataset}")

    mean = df[FEATURES].mean().to_numpy(dtype=np.float32)
    std = df[FEATURES].std().replace(0, 1).to_numpy(dtype=np.float32)

    env = GoldSizingEnv(df)
    model = PPO("MlpPolicy", env, verbose=1)
    model.learn(total_timesteps=args.timesteps)

    # mlp_extractor.policy_net turns the observation into a policy latent;
    # action_net turns that latent into the continuous action mean (SB3's
    # standard ActorCriticPolicy pipeline for a Box action space).
    actor = nn.Sequential(model.policy.mlp_extractor.policy_net, model.policy.action_net)
    wrapped = NormalizedPolicy(actor, mean, std)
    wrapped.eval()

    dummy_input = torch.zeros(1, len(FEATURES), dtype=torch.float32)
    torch.onnx.export(
        wrapped, dummy_input, args.out,
        input_names=["state"], output_names=["weight"],
        dynamic_axes={"state": {0: "batch"}, "weight": {0: "batch"}},
        opset_version=17,
    )
    print(f"Exported {args.out} (normalization baked in, feature order: {FEATURES})")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run a smoke test with a small timestep budget before trusting a full run**

Run: `pip install -r rl/requirements.txt && python rl/train_gold_sizer.py --dataset rl/data/gold-dataset.csv --out rl/gold-sizer.onnx --timesteps 2000`
Expected: no shape/dtype errors; prints `Loaded N training rows...`, PPO's training log table, then `Exported rl/gold-sizer.onnx (normalization baked in, feature order: [...])`. A 2000-timestep run won't produce a good policy — it only proves the pipeline runs end-to-end. Once confirmed, re-run with the real `--timesteps 200000` default for the committed model.

- [ ] **Step 4: Commit**

```bash
git add rl/requirements.txt rl/train_gold_sizer.py rl/gold-sizer.onnx
git commit -m "feat(rl): add offline PPO training script and export the gold sizer ONNX model"
```

---

### Task 4: `rlSizer.ts` — ONNX-backed weight/lot conversion

**Files:**
- Create: `src/lib/trading/rlSizer.ts`
- Test: `src/lib/trading/rlSizer.test.ts`
- Modify: `package.json` — add `"onnxruntime-node": "^1.20.1"` under `dependencies`.

**Interfaces:**
- Consumes: nothing from earlier tasks at the type level (loads `rl/gold-sizer.onnx` from Task 3 at runtime only).
- Produces: `RLState`, `RLSizingResult { weight: number; lot: number; vetoed: boolean; available: boolean }`, `RLSizingContext { entry: number; sl: number; riskUsd: number; maxLotPerTrade: number; minLot: number }`, `RLSession { run(features: number[]): Promise<number> }`, and `sizeWithRL(state: RLState, ctx: RLSizingContext, sessionOverride?: RLSession): Promise<RLSizingResult>` — consumed by Task 5's `engine.ts` wiring.

- [ ] **Step 1: Add the dependency**

Edit `package.json`, in `"dependencies"` (alphabetical, after `"next"`):

```json
    "next": "16.2.7",
    "onnxruntime-node": "^1.20.1",
    "react": "19.2.4",
```

Run: `npm install`
Expected: `onnxruntime-node` added to `package-lock.json` / `node_modules`.

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/trading/rlSizer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeWithRL, type RLSession, type RLState, type RLSizingContext } from "./rlSizer";

const state: RLState = { proxyConfidence: 0.6, atr: 2, adx: 30, bbWidth: 0.02, exposurePct: 0, cashPct: 1, drawdownPct: 0 };
// slDistance=3, riskUsd=30 -> fullLot=10, so weight scaling is visible without
// every case hitting the maxLotPerTrade clamp.
const ctx: RLSizingContext = { entry: 2000, sl: 1997, riskUsd: 30, maxLotPerTrade: 5, minLot: 0.01 };

function mockSession(weight: number): RLSession {
  return { run: async () => weight };
}

test("sizeWithRL: full-conviction weight clamps to maxLotPerTrade", async () => {
  const result = await sizeWithRL(state, ctx, mockSession(1.0));
  assert.equal(result.available, true);
  assert.equal(result.vetoed, false);
  assert.equal(result.lot, 5); // fullLot=10 * 1.0 = 10, clamped to maxLotPerTrade=5
});

test("sizeWithRL: partial weight scales the lot proportionally below the clamp", async () => {
  const result = await sizeWithRL(state, ctx, mockSession(0.3));
  assert.equal(result.lot, 3); // fullLot=10 * 0.3 = 3, under maxLotPerTrade=5
});

test("sizeWithRL: weight that converts to a lot below minLot is a veto, not a round-up", async () => {
  const result = await sizeWithRL(state, ctx, mockSession(0.0001));
  assert.equal(result.available, true);
  assert.equal(result.vetoed, true);
  assert.equal(result.lot, 0);
});

test("sizeWithRL: out-of-range model output is clamped to 0..1 before conversion", async () => {
  const result = await sizeWithRL(state, ctx, mockSession(5.0));
  assert.equal(result.weight, 1);
});

test("sizeWithRL: NaN model output is treated as zero weight, not a crash", async () => {
  const result = await sizeWithRL(state, ctx, mockSession(NaN));
  assert.equal(result.weight, 0);
  assert.equal(result.vetoed, true);
});

test("sizeWithRL: a session that throws during inference reports available: false", async () => {
  const throwing: RLSession = { run: async () => { throw new Error("onnx runtime error"); } };
  const result = await sizeWithRL(state, ctx, throwing);
  assert.deepEqual(result, { available: false, weight: 0, lot: 0, vetoed: false });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx tsx --test src/lib/trading/rlSizer.test.ts`
Expected: FAIL — `Cannot find module './rlSizer'`

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/trading/rlSizer.ts
// Loads the gold desk's RL sizer (rl/gold-sizer.onnx, trained offline — see
// rl/train_gold_sizer.py) and converts its output weight into a lot, using
// the same riskUsd/slDistance math computeLot() uses. Shadow-mode only: this
// never controls a real trade in this phase (see engine.ts wiring).

import path from "node:path";

export interface RLState {
  proxyConfidence: number;
  atr: number | null;
  adx: number | null;
  bbWidth: number | null;
  exposurePct: number;
  cashPct: number;
  drawdownPct: number;
}

export interface RLSizingResult {
  weight: number; // clamped 0..1
  lot: number; // 0 when vetoed or unavailable
  vetoed: boolean; // true if the model's weight rounded down to less than minLot
  available: boolean; // false if the ONNX model failed to load or infer — caller must fall back to computeLot()
}

export interface RLSizingContext {
  entry: number;
  sl: number;
  riskUsd: number;
  maxLotPerTrade: number;
  minLot: number;
}

/** Thin seam over the real onnxruntime-node session so tests can inject a mock. */
export interface RLSession {
  run(features: number[]): Promise<number>;
}

const MODEL_PATH = path.join(process.cwd(), "rl", "gold-sizer.onnx");

let cachedSession: RLSession | null | undefined;

async function loadDefaultSession(): Promise<RLSession | null> {
  if (cachedSession !== undefined) return cachedSession;
  try {
    const ort = await import("onnxruntime-node");
    const session = await ort.InferenceSession.create(MODEL_PATH);
    cachedSession = {
      async run(features: number[]): Promise<number> {
        const tensor = new ort.Tensor("float32", Float32Array.from(features), [1, features.length]);
        const results = await session.run({ state: tensor });
        return results.weight.data[0] as number;
      },
    };
  } catch {
    cachedSession = null;
  }
  return cachedSession;
}

// Raw (unscaled) feature values, in the exact order rl/train_gold_sizer.py's
// FEATURES list uses — normalization is baked into the ONNX graph itself, so
// nothing here scales anything (see the design doc's Component 3).
function toFeatureVector(state: RLState): number[] {
  return [
    state.proxyConfidence,
    state.atr ?? 0,
    state.adx ?? 0,
    state.bbWidth ?? 0,
    state.exposurePct,
    state.cashPct,
    state.drawdownPct,
  ];
}

export async function sizeWithRL(
  state: RLState,
  ctx: RLSizingContext,
  sessionOverride?: RLSession,
): Promise<RLSizingResult> {
  const session = sessionOverride ?? (await loadDefaultSession());
  if (!session) return { available: false, weight: 0, lot: 0, vetoed: false };

  let rawWeight: number;
  try {
    rawWeight = await session.run(toFeatureVector(state));
  } catch {
    return { available: false, weight: 0, lot: 0, vetoed: false };
  }

  const weight = Number.isFinite(rawWeight) ? Math.max(0, Math.min(1, rawWeight)) : 0;
  const slDistance = Math.abs(ctx.entry - ctx.sl);
  if (slDistance <= 0) return { available: true, weight, lot: 0, vetoed: true };

  const fullLot = ctx.riskUsd / slDistance;
  const rawLot = Math.min(fullLot * weight, ctx.maxLotPerTrade);
  const lot = Math.round(rawLot * 100) / 100;

  if (lot < ctx.minLot) return { available: true, weight, lot: 0, vetoed: true };
  return { available: true, weight, lot, vetoed: false };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test src/lib/trading/rlSizer.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/trading/rlSizer.ts src/lib/trading/rlSizer.test.ts
git commit -m "feat(rl): add rlSizer.ts, converting the ONNX model's weight into a lot"
```

---

### Task 5: `engine.ts` shadow-mode wiring (gold desk only)

**Files:**
- Modify: `src/lib/trading/circuitBreaker.ts`
- Modify: `src/lib/trading/circuitBreaker.test.ts`
- Modify: `src/lib/trading/engine.ts`
- Modify: `src/lib/trading/engine.test.ts`

**Interfaces:**
- Consumes: `sizeWithRL`/`RLState` (Task 4), `proxyConfidence` (Task 1), the existing
  `currentDrawdownPct`/`getCurrentDrawdownPct` pattern in `circuitBreaker.ts`.
- Produces: `currentEquity(closed: ClosedTrade[], startingBalance: number): number` and
  `getCurrentEquity(portfolioId: number): Promise<number>` in `circuitBreaker.ts` — siblings of
  the existing `currentDrawdownPct`/`getCurrentDrawdownPct`, same query/fold pattern, returning
  the underlying equity figure instead of the drawdown percentage.
  `TickStep { stage: string; note: string; data?: Record<string, unknown> }` (widened — `data` is
  additive and optional, safe for existing consumers: `src/app/command/page.tsx` declares its own
  local `{ stage, note }`-only type, and `memo.ts`'s `summarizeDecisionLog` doesn't touch `data`),
  and `buildRLState(scan: ScanResult, side: "long" | "short", riskUsd: number, balance: number,
  drawdownPct: number): RLState` — a pure helper, unit-tested directly.

**Note — `exposurePct`/`cashPct`/`drawdownPct` definitions:** per the Decision Log above,
`buildRLState` no longer takes `AccountState`. `exposurePct = riskUsd / balance` and `drawdownPct`
is the caller-computed peak-equity fraction — both match Task 2's training-data definitions
exactly, not the discrete `openPositions/maxOpenPositions` slot fraction or
`dailyLossUsd/dailyLossCapUsd` gate fraction from this plan's original (superseded) draft.

- [ ] **Step 1: Write the failing test for `currentEquity`**

Append to `src/lib/trading/circuitBreaker.test.ts` (reusing the existing `trade()` helper already
defined in that file):

```ts
import { currentEquity } from "./circuitBreaker";

test("currentEquity: empty input returns startingBalance", () => {
  assert.equal(currentEquity([], 10000), 10000);
});

test("currentEquity: sums realized pnl onto startingBalance in chronological order", () => {
  const closed = [trade(100, "2026-06-01"), trade(-40, "2026-06-02")];
  assert.equal(currentEquity(closed, 1000), 1060);
});

test("currentEquity: trades with identical closedAt are still summed correctly regardless of order", () => {
  const closed = [trade(-50, "2026-06-01"), trade(100, "2026-06-01")];
  assert.equal(currentEquity(closed, 1000), 1050);
});

test("currentEquity: does not mutate the input array", () => {
  const closed = [trade(-50, "2026-06-02"), trade(100, "2026-06-01")];
  const before = closed.map((t) => ({ ...t }));
  currentEquity(closed, 1000);
  assert.deepEqual(closed, before);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/trading/circuitBreaker.test.ts`
Expected: FAIL — `currentEquity is not a function` (or a TS import error for the not-yet-exported symbol)

- [ ] **Step 3: Implement `currentEquity`/`getCurrentEquity` in `circuitBreaker.ts`**

Add below the existing `currentDrawdownPct`/`getCurrentDrawdownPct` pair:

```ts
/** Current equity: startingBalance plus cumulative realized P/L, in chronological order. No peak-tracking (see currentDrawdownPct for that). */
export function currentEquity(closed: ClosedTrade[], startingBalance: number): number {
  const ordered = [...closed].sort((a, b) => (a.closedAt?.getTime() ?? 0) - (b.closedAt?.getTime() ?? 0));
  let equity = startingBalance;
  for (const t of ordered) equity += t.pnl ?? 0;
  return equity;
}

/** Loads a portfolio's closed trades and computes its current equity. */
export async function getCurrentEquity(portfolioId: number): Promise<number> {
  const startingBalance = await getStartingBalance(portfolioId);
  const closed = await prisma.trade.findMany({
    where: { status: "closed", portfolioId },
    orderBy: { closedAt: "asc" },
    select: { pnl: true, rMultiple: true, outcome: true, closedAt: true },
  });
  return currentEquity(closed.map((t) => ({ ...t, pnl: t.pnl ?? 0 })), startingBalance);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/trading/circuitBreaker.test.ts`
Expected: PASS (all prior tests plus the 4 new `currentEquity` tests)

- [ ] **Step 5: Write the failing tests for `buildRLState`**

Append to `src/lib/trading/engine.test.ts`:

```ts
import { buildRLState } from "./engine";

test("buildRLState: exposurePct is riskUsd/balance (continuous) — matches Task 2's training-data definition", () => {
  const s = scan({ snapshot: { ...snapshot, adx: 30, rsi: 60, plusDI: 25, minusDI: 10 } });
  const state = buildRLState(s, "long", 100, 10000, 0);
  assert.equal(state.exposurePct, 0.01); // 100 / 10000
  assert.equal(state.cashPct, 0.99);
});

test("buildRLState: drawdownPct passes through the caller-computed equity-peak fraction unchanged", () => {
  const state = buildRLState(scan(), "long", 100, 10000, 0.05);
  assert.equal(state.drawdownPct, 0.05);
});

test("buildRLState: carries atr/adx/bbWidth straight from the scan result", () => {
  const s = scan({ atr: 3.2, snapshot: { ...snapshot, adx: 22, bbWidth: 0.015 } });
  const state = buildRLState(s, "long", 100, 10000, 0);
  assert.equal(state.atr, 3.2);
  assert.equal(state.adx, 22);
  assert.equal(state.bbWidth, 0.015);
});

test("buildRLState: proxyConfidence flips sign with side on identical indicators", () => {
  const s = scan({ snapshot: { ...snapshot, adx: 30, rsi: 60, plusDI: 25, minusDI: 10 } });
  const long = buildRLState(s, "long", 100, 10000, 0);
  const short = buildRLState(s, "short", 100, 10000, 0);
  assert.equal(long.proxyConfidence, -short.proxyConfidence);
});

test("buildRLState: zero/negative balance doesn't divide by zero", () => {
  const state = buildRLState(scan(), "long", 100, 0, 0);
  assert.equal(state.exposurePct, 0);
  assert.equal(state.cashPct, 1);
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx tsx --test src/lib/trading/engine.test.ts`
Expected: FAIL — `buildRLState is not a function` (or a TS import error for the not-yet-exported symbol)

- [ ] **Step 7: Implement the `engine.ts` changes**

Widen `TickStep` (line 20):

```ts
export interface TickStep { stage: string; note: string; data?: Record<string, unknown> }
```

Add imports (after the existing `import { computeLot } from "./positionSizing";` line):

```ts
import { sizeWithRL, type RLState } from "./rlSizer";
import { proxyConfidence } from "./rlProxyConfidence";
import { getCurrentDrawdownPct, getCurrentEquity } from "./circuitBreaker";
```

Add the pure helper (near `minRiskRewardFor`, after its closing brace):

```ts
/**
 * Live-side state features for the shadow-mode RL sizer. exposurePct/cashPct/
 * drawdownPct are defined identically to Task 2's offline dataset builder —
 * continuous riskUsd/balance exposure and peak-equity drawdown — NOT the
 * discrete openPositions/maxOpenPositions slot fraction or
 * dailyLossUsd/dailyLossCapUsd gate fraction this file's AccountState uses for
 * Iron Rules (a different concept — gate thresholds, not an equity curve).
 * Feeding the model a differently-defined feature at inference than it saw in
 * training would silently make that feature meaningless to the learned
 * policy. See docs/superpowers/plans/2026-07-23-hybrid-rl-allocation.md's
 * Decision Log (resolved by SaladPak, 2026-07-25) for the full rationale.
 */
export function buildRLState(
  scan: ScanResult,
  side: "long" | "short",
  riskUsd: number,
  balance: number,
  drawdownPct: number,
): RLState {
  const exposurePct = balance > 0 ? riskUsd / balance : 0;
  return {
    proxyConfidence: proxyConfidence({
      adx: scan.snapshot.adx, rsi: scan.snapshot.rsi,
      plusDI: scan.snapshot.plusDI, minusDI: scan.snapshot.minusDI, side,
    }),
    atr: scan.atr,
    adx: scan.snapshot.adx,
    bbWidth: scan.snapshot.bbWidth ?? null,
    exposurePct,
    cashPct: 1 - exposurePct,
    drawdownPct,
  };
}
```

Now reorder and wire inside `runTradeTick`. Replace the whole block from `// 4) IRON RULES` (current line 151) through the `applyIronRules` call assembly (current lines 191-199) with:

```ts
  // 4) IRON RULES
  const levels = sage.adjusted;
  const account: AccountState = {
    ...DEFAULT_ACCOUNT,
    minRiskReward: minRiskRewardFor(scan, isResearch),
    dailyLossUsd: await todaysRealizedLoss(portfolioId),
    killSwitch: await isKillSwitchOn(portfolioId),
    globalTradingHalt: await isGlobalTradingHalt(),
    openPositions: await prisma.trade.count({ where: { status: "open", portfolioId } }),
    maxOpenPositions: await getMaxOpenPositions(portfolioId),
  };

  let lot: number;
  if (opts.lot != null) {
    lot = opts.lot;
  } else {
    const openPositions = await prisma.trade.findMany({
      where: { status: "open", portfolioId },
      select: { symbol: true },
    });
    const openSymbols = [...new Set(openPositions.map((p) => p.symbol))].filter((s) => s !== symbol);

    let avgCorrelation: number | null = null;
    if (openSymbols.length > 0) {
      const currentReturns = await fetchDailyReturns(symbol);
      if (currentReturns) {
        const correlations: number[] = [];
        for (const openSymbol of openSymbols) {
          const openReturns = await fetchDailyReturns(openSymbol);
          if (!openReturns) continue;
          const corr = pearsonCorrelation(currentReturns, openReturns);
          if (corr != null) correlations.push(corr);
        }
        if (correlations.length > 0) {
          avgCorrelation = correlations.reduce((a, b) => a + b, 0) / correlations.length;
        }
      }
    }

    const riskUsd = ((await getStartingBalance(portfolioId)) * (await getRiskPctPerTrade(portfolioId))) / 100;
    const sizing = computeLot({
      entry: levels.entry,
      sl: levels.sl,
      riskUsd,
      maxLotPerTrade: DEFAULT_ACCOUNT.maxLotPerTrade,
      avgCorrelation,
    });
    lot = sizing.lot;
    steps.push({ stage: "sizing", note: sizing.reasoning });

    // Shadow mode: gold desk only, purely additive logging — never affects `lot`.
    if (symbol === "GC=F") {
      const [balance, drawdownPctRaw] = await Promise.all([
        getCurrentEquity(portfolioId),
        getCurrentDrawdownPct(portfolioId),
      ]);
      const rlState = buildRLState(scan, hawk.side, riskUsd, balance, drawdownPctRaw / 100);
      const rl = await sizeWithRL(rlState, {
        entry: levels.entry, sl: levels.sl, riskUsd,
        maxLotPerTrade: DEFAULT_ACCOUNT.maxLotPerTrade, minLot: 0.01,
      });
      if (rl.available) {
        const rlNote = rl.vetoed
          ? "RL would skip this trade (below min lot)"
          : `RL would size ${rl.lot} lot (weight ${rl.weight.toFixed(2)})`;
        steps.push({
          stage: "rl-shadow",
          note: `${rlNote} vs actual ${lot}`,
          data: { rlWeight: rl.weight, rlLot: rl.lot, vetoed: rl.vetoed, actualLot: lot },
        });
      }
    }
  }
```

The subsequent `applyIronRules(...)` call and its `steps.push({ stage: "ironRules", ... })` (previously lines 200-207) are unchanged — they now simply reference the `account` built above instead of a duplicate. Note `getCurrentDrawdownPct` returns a 0-100 percentage (existing contract, unchanged for its other callers in `manage.ts`/`portfolioStats.ts`) — divided by 100 here so `RLState.drawdownPct` stays a 0..1 fraction, matching Task 2's CSV.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx tsx --test src/lib/trading/engine.test.ts`
Expected: PASS (all prior tests plus the 5 new `buildRLState` tests)

- [ ] **Step 9: Run the full test suite to confirm nothing else broke**

Run: `npm test`
Expected: PASS — `positionSizing.test.ts`, `ironRules.test.ts`, `circuitBreaker.test.ts`, `rlProxyConfidence.test.ts`, `rlSizer.test.ts`, `engine.test.ts` all green.

- [ ] **Step 10: Commit**

```bash
git add src/lib/trading/circuitBreaker.ts src/lib/trading/circuitBreaker.test.ts src/lib/trading/engine.ts src/lib/trading/engine.test.ts
git commit -m "feat(rl): wire shadow-mode RL sizing into the gold desk's trade tick"
```

---

### Task 6: Shadow-mode review script (`scripts/rl/compare-shadow-sizing.ts`)

**Files:**
- Create: `scripts/rl/compare-shadow-sizing.ts`

**Interfaces:**
- Consumes: `prisma` (`@/lib/db`), the `rl-shadow` `TickStep.data` shape produced by Task 5 (`{ rlWeight, rlLot, vetoed, actualLot }`).
- Produces: a console report — the gate reviewed before ever flipping the gold desk to live RL sizing (out of scope for this phase).

No automated test — offline review script, same category as `scripts/blind-test-gold.ts`.

- [ ] **Step 1: Write the script**

```ts
// scripts/rl/compare-shadow-sizing.ts
// Reviews the gold desk's rl-shadow decision-trail entries against what
// actually happened, reporting counterfactual P/L if the RL-proposed lot had
// been used instead of the real computeLot() lot. This is the gate reviewed
// before ever flipping engine.ts to use RL sizing live (design doc Component 6).
// Usage: npx tsx scripts/rl/compare-shadow-sizing.ts

import { prisma } from "../../src/lib/db";

const GOLD_SYMBOL = "GC=F";

interface RLShadowData {
  rlWeight: number;
  rlLot: number;
  vetoed: boolean;
  actualLot: number;
}

interface TickStep { stage: string; note: string; data?: Record<string, unknown> }

function parseRLShadow(decisionLog: string): RLShadowData | null {
  let steps: TickStep[];
  try {
    steps = JSON.parse(decisionLog);
  } catch {
    return null;
  }
  const step = steps.find((s) => s.stage === "rl-shadow");
  if (!step?.data) return null;
  const d = step.data as Partial<RLShadowData>;
  if (typeof d.rlLot !== "number" || typeof d.actualLot !== "number") return null;
  return { rlWeight: d.rlWeight ?? 0, rlLot: d.rlLot, vetoed: Boolean(d.vetoed), actualLot: d.actualLot };
}

async function main() {
  const trades = await prisma.trade.findMany({
    where: { symbol: GOLD_SYMBOL, status: "closed" },
    orderBy: { closedAt: "asc" },
  });

  let compared = 0;
  let actualPnlTotal = 0;
  let rlPnlTotal = 0;
  let vetoedCount = 0;

  console.log(
    `${"tradeId".padEnd(8)} ${"actualLot".padStart(9)} ${"rlLot".padStart(7)} ${"actualPnl".padStart(10)} ${"rlPnl".padStart(10)} note`,
  );

  for (const t of trades) {
    const shadow = parseRLShadow(t.decisionLog);
    if (!shadow) continue;
    compared++;
    const actualPnl = t.pnl ?? 0;
    // Same entry/exit/slippage path -> P/L is proportional to lot size.
    const rlPnl = shadow.actualLot > 0 ? (actualPnl / shadow.actualLot) * shadow.rlLot : 0;
    actualPnlTotal += actualPnl;
    rlPnlTotal += rlPnl;
    if (shadow.vetoed) vetoedCount++;
    console.log(
      `${String(t.id).padEnd(8)} ${shadow.actualLot.toFixed(2).padStart(9)} ${shadow.rlLot.toFixed(2).padStart(7)} ` +
      `${actualPnl.toFixed(2).padStart(10)} ${rlPnl.toFixed(2).padStart(10)} ${shadow.vetoed ? "RL vetoed" : ""}`,
    );
  }

  console.log(`\n${compared} trades with an rl-shadow log entry`);
  console.log(`Actual total P/L:      $${actualPnlTotal.toFixed(2)}`);
  console.log(`RL-proposed total P/L: $${rlPnlTotal.toFixed(2)}`);
  console.log(`RL would have vetoed ${vetoedCount} of ${compared} trades`);
}

main();
```

- [ ] **Step 2: Run it and manually verify against a live shadow-mode trade**

Run the bot against the gold desk at least once after Task 5 is deployed (so at least one closed trade has an `rl-shadow` log entry), then:
`npx tsx scripts/rl/compare-shadow-sizing.ts`
Expected: a table row per gold trade with a shadow entry, plus the three summary lines. With zero qualifying trades yet, expect `0 trades with an rl-shadow log entry` and both totals at `$0.00` — not an error.

- [ ] **Step 3: Commit**

```bash
git add scripts/rl/compare-shadow-sizing.ts
git commit -m "feat(rl): add shadow-mode sizing review script"
```

---

## Self-Review

**1. Spec coverage:**
- Component 1 (`rlProxyConfidence.ts`, sign convention) → Task 1. ✓
- Component 2 (dataset builder, continuous position state via `positionRules.ts`) → Task 2. ✓
- Component 3 (FinRL-X training, baked-in normalization, Sharpe/Sortino-matching reward) → Task 3. ✓
- Component 4 (`rlSizer.ts`, veto-vs-round-up, `available: false` fallback contract) → Task 4. ✓
- Component 5 (`engine.ts` shadow wiring, gold-desk-only gate, additive `TickStep`) → Task 5. ✓
- Component 6 (`compare-shadow-sizing.ts`) → Task 6. ✓
- Error handling section (ONNX load/inference failure, out-of-range clamp, below-`minLot` veto) → covered in Task 4's implementation and tests. ✓
- Testing section (`rlProxyConfidence.test.ts`, `rlSizer.test.ts` with mocked session, manual validation for the two scripts, `engine.test.ts`/`positionSizing.test.ts` unaffected) → Tasks 1, 4, 2, 3, 5 respectively. ✓
- Out-of-scope recap → carried into Global Constraints; no task implements live RL sizing, multi-asset allocation, other portfolios, a hosted Python service, or automated retraining. ✓

**2. Placeholder scan:** No `TBD`/`TODO` strings; every step has complete, runnable code (Python steps are the one place execution can't be verified inline — flagged explicitly with real run commands and expected output rather than glossed over). No "similar to Task N" references — Tasks 2, 3, and 6's manual-validation steps each spell out their own expected output.

**3. Type consistency:** `RLState`/`RLSizingResult`/`RLSizingContext`/`RLSession` (Task 4) match their usage in Task 5's `buildRLState`/`sizeWithRL` call exactly. `TickStep.data` (Task 5) matches the shape Task 6's `RLShadowData`/`parseRLShadow` expects (`rlWeight, rlLot, vetoed, actualLot`). The CSV column names emitted by Task 2 (`proxyConfidence,atr,adx,bbWidth,exposurePct,cashPct,drawdownPct,side,reward`) match Task 3's Python `FEATURES` list (`side`/`reward` are dataset-only columns, correctly excluded from `FEATURES`/the ONNX input). `proxyConfidence()`'s signature (Task 1) is used identically in Task 2's script and Task 5's `buildRLState`.
