# Candlestick Pattern Strategies — Design

## Problem

The strategy registry (`src/lib/trading/strategies.ts`) currently has no
pure price-action strategies based on classic candlestick reversal patterns.
Existing price-action strategies (`bull-flag`, `vol-spike`, `liquidity-sweep`)
detect momentum/structure setups, but nothing recognizes textbook single/
multi-candle reversal shapes (Hammer, Engulfing, Star patterns, etc.), which
are a common, well-understood signal family traders expect to be able to
select per portfolio or backtest.

## Goal

Add 10 individually-selectable candlestick reversal-pattern strategies (5
bullish, 5 bearish) plus one `combineStrategies("any")` meta-strategy that
fires when any of the 10 trigger, following the existing `Strategy` contract
and registry convention exactly — no new DB tables, no new routing, no new
config surface beyond what `getStrategy(key)` already resolves everywhere.

## Scope

- 10 patterns, 5 bullish (long) / 5 bearish (short), each a reversal pattern
  that requires a prior opposing trend to be valid — textbook Doji is
  excluded because it has no inherent direction and would need extra
  disambiguation logic to fit the `side: "long" | "short"` contract:
  - Bullish: Hammer, Bullish Engulfing, Piercing Line, Morning Star,
    Three White Soldiers
  - Bearish: Shooting Star, Bearish Engulfing, Dark Cloud Cover,
    Evening Star, Three Black Crows
- Each pattern requires a prior-trend filter (opposing SMA-slope trend over
  a lookback window) before it counts as a valid reversal signal — this
  mirrors `liquidity-sweep`'s SMA50 trend filter and avoids firing on
  shapes that match geometrically but have no reversal context.
- One combo strategy, `candlestick-any`, built via the existing
  `combineStrategies(key, label, memberKeys, "any")` helper.
- Wire the new keys into the Backtest Lab's comparison config arrays in
  `src/app/backtest/page.tsx`.
- Out of scope: Doji / neutral-pattern handling, volume-based confirmation
  filters beyond the existing trend filter, a dedicated strategy-picker UI
  (there isn't one today — selection is via `PATCH /api/portfolios/[id]`,
  same as every other strategy), and `SECONDARY_PASSES` registration (that
  file is portfolio-specific config, not something a new strategy needs to
  self-register into).

## Components

### 1. `src/lib/trading/candlestickPatterns.ts` (new, pure)

Pure, side-effect-free detector functions operating on `Candle[]` from
`@/lib/indicators`, mirroring the style of `src/lib/swings.ts`. Each
detector returns `boolean` for whether the pattern completes *at* index `i`
(i.e., the day/bar that closes the pattern).

```ts
import type { Candle } from "@/lib/indicators";
import { sma } from "@/lib/indicators";

export type TrendDirection = "up" | "down" | "flat";

/** Trend of the N bars strictly before index i, via SMA(lookback) slope. */
export function priorTrend(bars: Candle[], i: number, lookback = 10): TrendDirection;

// Single-candle
export function isHammer(bars: Candle[], i: number): boolean;
export function isShootingStar(bars: Candle[], i: number): boolean;

// Two-candle
export function isBullishEngulfing(bars: Candle[], i: number): boolean;
export function isBearishEngulfing(bars: Candle[], i: number): boolean;
export function isPiercingLine(bars: Candle[], i: number): boolean;
export function isDarkCloudCover(bars: Candle[], i: number): boolean;

// Three-candle
export function isMorningStar(bars: Candle[], i: number): boolean;
export function isEveningStar(bars: Candle[], i: number): boolean;
export function isThreeWhiteSoldiers(bars: Candle[], i: number): boolean;
export function isThreeBlackCrows(bars: Candle[], i: number): boolean;
```

- `priorTrend`: computes `sma(closes, lookback)` and compares the slope
  between `sma[i - patternSpan]` and `sma[i - patternSpan - lookback]`
  (`patternSpan` = 1, 2, or 3 depending on the pattern, i.e. measured
  *before* the pattern's own candles) — returns `"down"`/`"up"`/`"flat"`
  (flat = slope within a small epsilon, treated as "no valid trend context",
  so patterns don't fire in a chopfest). Returns `"flat"` when there isn't
  enough history (`i - patternSpan - lookback < 0`).
- Body/wick geometry helpers (`bodySize`, `upperWick`, `lowerWick`, `range`,
  `isBullish`/`isBearish` candle color) are small internal (non-exported)
  helpers at the top of the file — standard textbook ratios (e.g. Hammer:
  lower wick ≥ 2× body, upper wick ≤ small fraction of body, body in upper
  third of range).
- Each multi-candle detector only looks at `bars[i]`, `bars[i-1]`, (and
  `bars[i-2]` for 3-candle patterns) plus calls `priorTrend` anchored before
  the pattern's start — no lookahead.
- Guard every detector with `i >= <patternSpan - 1>` (return `false` if not
  enough bars yet) so `build(bars)` closures are safe to call at any `i`,
  including `i = 0`.

### 2. `src/lib/trading/strategies.ts` (additions)

10 thin `Strategy` wrapper objects, same shape as existing entries, each a
handful of lines, e.g.:

```ts
const hammer: Strategy = {
  key: "hammer",
  label: "Hammer",
  build(bars) {
    return (i) => (isHammer(bars, i) ? { side: "long", note: "hammer reversal" } : null);
  },
};
```

...one per pattern (bearish ones return `side: "short"`), then at the
bottom of the file, appended to `STRATEGIES` alongside the existing
`combo-*` entries:

```ts
combineStrategies(
  "candlestick-any",
  "Candlestick Pattern (Any)",
  [
    "hammer", "bullish-engulfing", "piercing-line", "morning-star", "three-white-soldiers",
    "shooting-star", "bearish-engulfing", "dark-cloud-cover", "evening-star", "three-black-crows",
  ],
  "any",
),
```

No changes needed to `getStrategy`, `runTradeTick`, `scanner.ts`,
`/api/invest`, `/api/scan-all`, `runScheduledScan`, or the portfolio PATCH
validator — all already resolve any `STRATEGIES` member by key.

### 3. `src/app/backtest/page.tsx` (additions)

The Backtest Lab's comparison arrays are `{ interval, range, strategy }`
config rows (e.g. `CHART_GOLD_CONFIGS`), not a `{ key, label }` strategy
catalog — each array is one comparison button's scenario list. Follow that
convention: add a new `CANDLESTICK_CONFIGS` array (one row per pattern key
plus `candlestick-any`, same `{ interval: "1h", range: "3mo", strategy }`
shape as `STRATEGY_CONFIGS`), a `"candlestick"` branch in `run()`'s mode
ternary (mirrors the existing `"chart"` branch), and a new comparison
button ("Candlestick patterns (1h)"), reusing the existing results table
verbatim — no table/column changes needed. No other file in `src/app`
needs changes (no dedicated strategy-picker page exists today).

## Testing

- `src/lib/trading/candlestickPatterns.test.ts` (`node:test`, mirrors
  `indicators.test.ts` conventions): for each of the 10 detectors, two
  cases —
  - a hand-built bar sequence that unambiguously satisfies the pattern
    *and* has an opposing prior trend → detector returns `true`
  - a near-miss fixture (right shape, no prior trend, i.e. flat/agreeing
    trend) → detector returns `false`, proving the trend filter is load-
    bearing and not just decorative
  - `priorTrend` gets its own small test: rising closes → `"up"`, falling
    → `"down"`, insufficient history → `"flat"`.
- `src/lib/trading/strategies.test.ts` (additions): one integration test
  per pattern confirming `getStrategy(key)!.build(bars)(i)` returns the
  expected `side` on the same fixture used in
  `candlestickPatterns.test.ts`, plus one test that `getStrategy(
  "candlestick-any")` fires when exactly one member pattern's fixture is
  used (proving the `combineStrategies("any")` wiring resolves the new
  keys correctly).
- Run via existing `npm test` (`tsx --test "src/**/*.test.ts"`) — no new
  test runner or config.
