# Volatility- and Correlation-Adjusted Position Sizing — Design

## Problem

`runTradeTick` in `src/lib/trading/engine.ts:102` uses a single constant `DEFAULT_LOT = 0.1`
for every trade, regardless of:

1. **Volatility** — `applyIronRules` computes `worstCaseLoss = |entry - sl| × pipValue × lot`.
   SAGE sets `sl` from ATR (e.g. `entry - 1.5×ATR`), so a more volatile symbol already gets a
   wider SL distance. With a fixed `lot`, its dollar risk per trade is therefore *larger* than
   a calm symbol's — the opposite of sound risk management.
2. **Correlation** — the engine has no awareness of how many currently-open positions move
   together with the new candidate, so it can stack correlated exposure without limit.

This mirrors `Src/Agent/risk_manager.py` in `GITHUB HEDGE FUND`, but that implementation is
built around portfolio-NAV percentages and a volatility-percentile lookup that don't map onto
NEXMIND's `$`-based risk model (`dailyLossCapUsd`, `pipValueUsdPerLot`, `maxLotPerTrade`).

## Goal

Replace `DEFAULT_LOT` with a computed lot that:

- Targets a roughly constant **dollar risk per trade** (`riskUsd`), regardless of the symbol's
  ATR/SL distance — fixes the volatility gap.
- **Shrinks** (never grows) when the new symbol is highly correlated with currently-open
  positions — fixes the correlation gap.
- Stays within the existing `maxLotPerTrade` ceiling (Iron Rules already enforce this) and a
  new `minLot` floor.

## New setting: `riskPctPerTrade`

Same pattern as `startingBalance` (`src/lib/settings.ts`):

```ts
export async function getRiskPctPerTrade(): Promise<number> {
  const n = parseFloat(await getSetting("riskPctPerTrade", "1"));
  return Number.isFinite(n) && n > 0 ? n : 1;
}
```

- Default `1` (= 1% of `startingBalance`). At the $10,000 default starting balance, that's
  $100 risk per trade.
- `riskUsd = startingBalance × riskPctPerTrade / 100`.
- Exposed via `/api/settings` (GET/POST) and a new "Risk per trade (%)" number input in
  `src/app/command/safety-panel.tsx`, alongside "Max open positions" and "Starting balance ($)".

## `src/lib/trading/correlation.ts` (new, pure)

```ts
import type { Candle } from "@/lib/indicators";

/** Daily % returns from a candle series (close-to-close). */
export function dailyReturns(candles: Candle[]): number[];

/**
 * Pearson correlation of two return series, trimmed to the same trailing
 * length (most recent N points of each — an approximation, not date-aligned).
 * Returns null if either series has fewer than 5 points after trimming.
 */
export function pearsonCorrelation(xs: number[], ys: number[]): number | null;
```

No I/O — operates on candle arrays already fetched by the caller. Trimming to a common
trailing length is a deliberate simplification: NEXMIND trades both US and Thai (`.BK`)
symbols with different trading calendars, and exact date-alignment isn't worth the
complexity for a paper-trading risk dampener.

## `src/lib/trading/positionSizing.ts` (new, pure)

```ts
export interface SizingInput {
  entry: number;
  sl: number;
  riskUsd: number;                  // startingBalance * riskPctPerTrade / 100
  maxLotPerTrade: number;
  minLot?: number;                  // default 0.01
  avgCorrelation: number | null;    // null = no open positions, or no usable price data
}

export interface SizingResult {
  lot: number;
  riskUsd: number;
  slDistance: number;
  corrMultiplier: number;
  avgCorrelation: number | null;
  reasoning: string;
}

export function computeLot(input: SizingInput): SizingResult;
```

Logic:

1. `slDistance = |entry - sl|`.
2. If `slDistance <= 0` (degenerate levels): `lot = minLot`, `reasoning` notes the fallback,
   `corrMultiplier = 1`, skip steps 3-4.
3. `riskLot = riskUsd / slDistance`.
4. `corrMultiplier`:
   - `avgCorrelation == null` → `1.0`
   - `avgCorrelation >= 0.8` → `0.7`
   - `avgCorrelation >= 0.6` → `0.85`
   - else → `1.0`

   (Only ever shrinks — high correlation never *increases* size beyond the volatility-based
   baseline.)
5. `lot = clamp(riskLot × corrMultiplier, minLot, maxLotPerTrade)`, rounded to 2 decimals
   (existing `lot` values in the system, e.g. `0.1`, are 1-2 decimals).
6. `reasoning` is a one-line human-readable summary, e.g.
   `"risk $100 / SL dist 2.94 = 0.34 lot · corr 0.62 (×0.85) → 0.29 lot"`.

`minLot` defaults to `0.01`.

## `engine.ts` wiring

Replace the current:

```ts
const lot = opts.lot ?? DEFAULT_LOT;
```

(in `runTradeTick`, after SAGE's `levels = sage.adjusted` is known) with:

1. `opts.lot` still wins if explicitly passed (used by tests / manual ticks) — skip all of
   the below in that case.
2. Otherwise:
   - Fetch open positions' symbols: `prisma.trade.findMany({ where: { status: "open" }, select: { symbol: true } })`.
   - If **no open positions**: `avgCorrelation = null` (no fetches needed).
   - Else: fetch daily candles for the current symbol + each *unique* open-position symbol via
     `fetchYahooCandlesSmart(sym, "3mo", "1d")`. For each open symbol whose fetch succeeds,
     compute `pearsonCorrelation(dailyReturns(currentCandles), dailyReturns(openCandles))`.
     Average the non-null correlations. If **none** succeed (all fetches fail or all return
     `null`), `avgCorrelation = null` (i.e. a fetch failure for one symbol just excludes that
     symbol from the average — it does not blank out the whole correlation step unless *every*
     symbol fails).
   - `riskUsd = (await getStartingBalance()) * (await getRiskPctPerTrade()) / 100`.
   - `const sizing = computeLot({ entry: levels.entry, sl: levels.sl, riskUsd, maxLotPerTrade: DEFAULT_ACCOUNT.maxLotPerTrade, avgCorrelation })`.
   - `const lot = sizing.lot`.
3. Push a step to the decision log: `{ stage: "sizing", note: sizing.reasoning }` (only when
   `opts.lot` was not provided — manual/test lots don't need a sizing explanation).

Candle fetches happen via `fetchYahooCandlesSmart`, the same helper already used by
`invest/analyze.ts` and `scanner.ts` — no new external dependency, no API key required.

## Testing

- `src/lib/trading/correlation.test.ts`:
  - `dailyReturns`: known candle series → known % returns.
  - `pearsonCorrelation`: identical series → `1`; inverted series → `-1`; short series
    (<5 points) → `null`.
- `src/lib/trading/positionSizing.test.ts`:
  - Larger `slDistance` → smaller `lot` (volatility scaling).
  - `lot` clamped to `maxLotPerTrade` when `riskLot` would exceed it.
  - `lot` clamped to `minLot` when `riskLot` would fall below it.
  - `avgCorrelation` buckets (`0.85`, `0.65`, `0.3`, `null`) produce the expected
    `corrMultiplier` and resulting `lot`.
  - `slDistance <= 0` → `lot === minLot`, reasoning mentions the fallback.

`engine.ts`'s `runTradeTick` itself has no existing unit tests (it's an integration of
DB + network + AI calls) and this change doesn't add any — the new logic is fully covered via
the pure `positionSizing.ts` / `correlation.ts` units, matching the existing pattern
(`ironRules.ts` is pure + tested; `engine.ts` wiring is not).

## Out of scope

- Date-aligned correlation (vs. trailing-length trim).
- Per-symbol volatility *percentile* (vs. simple ATR-implied SL distance, which already
  reflects current volatility).
- Increasing lot size for low/negative correlation (only-shrink, per discussion).
