# NEXMIND gold strategies as MQL5 Expert Advisors

Every gold strategy NEXMIND ever tested, translated to MT5. There is one EA per unique entry rule:
56 files covering all 60 non-mock `GC=F` rows in `ResearchStrategy`, plus the four pre-registered
xau-v1 hypotheses.

**Every one of these was rejected.** None passed the validation it was put through, and gold is
closed as an instrument by the xau-v1 pre-registration (`docs/STATE.md` §3). These files exist so
the backtests can be re-run in the MT5 Strategy Tester on broker data. They are not a trading
system. Run them on a demo account only.

## Install

1. In MT5: **File → Open Data Folder**, then open the `MQL5` folder inside it. Not the data
   folder itself: a copy placed next to `MQL5` instead of inside it is invisible to MetaEditor.
2. Copy the whole `Experts/NEXMIND_Gold/` folder into `MQL5/Experts/`. `NexCore.mqh` travels
   inside it, so there is nothing to put in `MQL5/Include`.
3. In MetaEditor, compile the folder, or press F7 on each file.
4. In the Strategy Tester, pick an EA, choose the gold symbol and the timeframe from the table
   below, and use "Every tick based on real ticks" if the broker has them.

All 56 files compile with 0 errors and 0 warnings (MetaEditor build on this machine, 2026-10-13).
The translations have **not** been run against the TypeScript backtester on the same bars. Compiling
proves the syntax, not parity.

## Inputs every EA shares (`NexCore.mqh`)

| Input | Default | Meaning |
|---|---|---|
| `InpLots` / `InpRiskPercent` | 0.01 / 0 | Fixed lot, or risk % of equity sized off the stop distance |
| `InpSLMult` | 1.5 | Stop = 1.5 × ATR14 of the signal bar (the engine's stop) |
| `InpTPMult` | 1.2 | Single target at 1.2 × ATR14, the ladder these rows were backtested on |
| `InpUseTrail`, `InpTrailActivate`, `InpTrailOffset` | off, 1.5, 1.5 | ATR trailing stop instead of the target, as in `positionRules.ts` |
| `InpDirection` | 0 | 0 both, 1 long only, 2 short only |
| `InpWeekendFlat` | off (on for xau-v1) | Flat from Friday 21:00 UTC until Sunday 22:00 UTC |
| `InpServerGMTOffset` | 0 | Broker server time minus UTC in hours. Exness is 0; many brokers are 2 or 3. The session and hour rules (#39, #40, xau-v1) are wrong if this is wrong |
| `InpHistoryBars` | 1500 | Closed bars used to compute indicators |

## How the EAs differ from the original backtests

- **Fill.** The TypeScript engine booked entries at the signal bar's close. The EA enters at market
  on the first tick of the next bar, which is the tradeable version. xau-v1 already used this fill.
- **Indicators** are line-for-line ports of `src/lib/indicators.ts` (Wilder RSI/ATR/ADX, MACD
  12/26/9, Bollinger 20/2, Stochastic 14/3/3, daily-anchored VWAP), not MT5's built-in `iADX`/`iRSI`,
  which smooth differently. They are recomputed over the last 1500 closed bars, so Wilder seeds
  differ slightly from a full-history run.
- **Volume** is MT5 tick volume. The research rows used Yahoo `GC=F` futures volume, so the volume
  rules (#73, #100, #109, #137) will not fire on the same bars.
- **Data.** Most rows were tested on Yahoo `GC=F` futures, 3 months to 2 years of 1h bars. Spot
  XAUUSD on a CFD broker is a different series.
- **#137** was a TradingView Pine v5 strategy. Pine recomputes its stop from the current ATR on
  every bar. The EA fixes it at the entry ATR, like the rest of the engine. Its PF 1.65 came from
  tuning the stop and trail on the same 34 trades it was scored on.

## The strategies

Stats are the original backtest from the DB. Where several DB rows share one file, the values are
listed in row order. "approved" on a legacy row means it passed the old single-symbol gate, which
was later found too loose (research-29 was approved on 8 trades and lost −3.46R live).

| File | DB rows | TF tested | Trades | avgR | PF | Status |
|---|---|---|---:|---:|---:|---|
| `NX_013_TrendPullback.mq5` | #13, #16 | 1h | 24 / 24 | -0.111 / -0.111 | – / – | rejected |
| `NX_017_TrendPullback_v2_2BarConfirm.mq5` | #17 | 1h | 7 | -0.095 | – | rejected |
| `NX_018_TrendPullback_v3_MacdFilter.mq5` | #18 | 1h | 3 | 0.667 | – | rejected |
| `NX_014_MacdDiMomentumIgnition.mq5` | #14 | 1h | 35 | 0.248 | – | rejected |
| `NX_019_DiDominance_Adx25.mq5` | #19, #22 | 1h | 234 / 504 | 0.085 / 0.025 | – / – | rejected |
| `NX_030_DiDominance_Adx20.mq5` | #30 | 1h | 695 | 0.031 | – | rejected |
| `NX_020_StrongTrendRider.mq5` | #20, #23 | 1h | 117 / 211 | 0.094 / 0.032 | – / – | rejected |
| `NX_024_AdxIgnitionBreakout.mq5` | #24 | 1h | 100 | 0.080 | – | rejected |
| `NX_025_DiCross.mq5` | #25 | 1h | 65 | 0.135 | – | approved |
| `NX_026_DiCross_Adx15.mq5` | #26 | 1h | 47 | 0.149 | – | rejected |
| `NX_041_AdxDiTrendBreakout.mq5` | #41 | 15m | 0 | – | – | rejected |
| `NX_031_MacdFlip_TrendSma20vs50.mq5` | #31 | 1h | 165 | 0.102 | – | rejected |
| `NX_049_MacdZeroCross_Sma50.mq5` | #49 | 1h | 193 | 0.066 | 1.23 | rejected |
| `NX_070_MacdExhaustionFade.mq5` | #70 | 1h | 567 | -0.041 | 0.93 | rejected |
| `NX_098_MaCrossAdxMacdFlip_LongOnly.mq5` | #98 | 1d | 4 | -0.109 | 0.71 | rejected |
| `NX_107_MacdMomentum_Sma50Adx.mq5` | #107 | 1d | 2 | 0.799 | – | rejected |
| `NX_039_Rsi50MacdMomentum_15m.mq5` | #39 | 15m | 45 | -0.448 | 0.29 | rejected |
| `NX_040_AtrBandMeanReversion_15m.mq5` | #40 | 15m | 2 | -0.497 | 0.32 | rejected |
| `NX_015_AtrBandRangeFade.mq5` | #15 | 1h | 10 | 0.267 | – | rejected |
| `NX_021_RsiExtremeFade_Adx20.mq5` | #21, #65, #66 | 1h | 11 / 11 / 23 | 0.197 / 0.288 / -0.087 | – / 1.77 / 1.02 | rejected |
| `NX_067_RsiExtremeFade_Adx25.mq5` | #67, #68, #74 | 1h/15m | 28 / 57 / 6 | 0.199 / 0.014 / -0.136 | 1.47 / 1.29 / 0.68 | rejected |
| `NX_045_Rsi50Flip_LowAdx.mq5` | #45 | 1d | 4 | -1.098 | 0.00 | rejected |
| `NX_046_Rsi2SnapBack.mq5` | #46 | 1d | 10 | -0.209 | 1.00 | rejected |
| `NX_099_LowAdxRsiStretchFade.mq5` | #99 | 1d | 0 | – | – | rejected |
| `NX_069_AtrBandReentryFade.mq5` | #69 | 1h | 48 | 0.135 | 1.40 | rejected |
| `NX_104_Sma20DeviationMeanReversion.mq5` | #104 | 1h | 2 | -1.021 | 0.00 | rejected |
| `NX_106_Sma20ReCrossAfterExtension.mq5` | #106 | 1h | 2 | 0.782 | – | rejected |
| `NX_108_RsiAtrExtensionFade.mq5` | #108 | 1d | 1 | -1.002 | 0.00 | rejected |
| `NX_075_BbPctB_StochTurnFade.mq5` | #75 | 1h | 96 | -0.033 | 1.00 | rejected |
| `NX_076_BbPctB_StochCrossFade.mq5` | #76, #80 | 1h/1d | 61 / 13 | 0.006 / -0.317 | 1.06 / 0.42 | rejected |
| `NX_078_StochCrossFade.mq5` | #78 | 1h | 178 | -0.066 | 0.86 | rejected |
| `NX_079_VwapDeviationFade.mq5` | #79 | 1h | 152 | -0.097 | 0.81 | rejected |
| `NX_082_BbReclaimFade.mq5` | #82 | 1h | 132 | -0.018 | 1.03 | rejected |
| `NX_101_BbSqueezeBreakout.mq5` | #101 | 1h | 2 | -0.132 | 6.94 | rejected |
| `NX_102_VolExpansionMomentum.mq5` | #102 | 1h | 386 | 0.003 | 1.00 | rejected |
| `NX_103_BandExtremeFade_Rangebound.mq5` | #103 | 1h | 2 | -0.126 | 0.35 | rejected |
| `NX_105_Sma20ExtensionMomentum.mq5` | #105 | 1h | 89 | -0.012 | 0.92 | rejected |
| `NX_048_Engulfing_Sma50.mq5` | #48 | 1h | 329 | -0.013 | 0.83 | rejected |
| `NX_050_HammerStar_Rsi50Cross.mq5` | #50 | 1h | 10 | -0.478 | 0.15 | rejected |
| `NX_073_VolumeClimaxFade.mq5` | #73 | 1h | 243 | -0.152 | 0.74 | rejected |
| `NX_047_AtrSqueezeBreakout.mq5` | #47 | 1d | 2 | -1.051 | 0.00 | rejected |
| `NX_052_Donchian20_Adx22.mq5` | #52 | 1h | 277 | 0.015 | 0.99 | rejected |
| `NX_054_Donchian20_AdxRising.mq5` | #54 | 1h | 238 | 0.011 | 0.95 | rejected |
| `NX_100_Donchian20_AdxVolume.mq5` | #100 | 1d | 19 | 0.223 | 1.24 | rejected |
| `NX_109_Donchian20_AdxRising2_Volume.mq5` | #109 | 1d | 1 | 0.798 | – | rejected |
| `NX_059_LiquiditySweep20.mq5` | #59 | 1h | 394 | -0.084 | 0.93 | rejected |
| `NX_064_LiquiditySweep10.mq5` | #64 | 1h | 514 | -0.065 | 0.96 | rejected |
| `NX_060_LiquiditySweep20_Depth.mq5` | #60 | 1h | 190 | -0.096 | 0.84 | rejected |
| `NX_061_LiquiditySweep20_AdxBelow25.mq5` | #61 | 1h | 192 | -0.108 | 0.83 | rejected |
| `NX_062_LiquiditySweep20_Sma50.mq5` | #62 | 1h | 54 | 0.009 | 1.13 | rejected |
| `NX_063_LiquiditySweep20_RsiExtreme.mq5` | #63 | 1h | 213 | -0.061 | 1.06 | rejected |
| `NX_137_LiquiditySweep_VolumeProfile_Sma50.mq5` | #137 | 1h | 34 | – | 1.65 | proposed |

### xau-v1 (pre-registered 2026-09-08, all REJECT on 2026-10-01)

Tested on Exness `XAUUSDm` H1, five folds, flat ladder (TP 1.2 / SL 1.5 ATR), next-bar open fill,
flat over the weekend. Results: `docs/quant/2026-10-01-xau-v1-results.md` on branch
`xau-v1-phase0-1-unblock`.

| File | Rule |
|---|---|
| `NX_XAU_MrDown3.mq5` | Long after 3 consecutive lower closes |
| `NX_XAU_SessionOpenBreakout.mq5` | On the 07:00 or 13:00 UTC bar, trade a close outside the prior 6 hours' range |
| `NX_XAU_AsianRangeFade.mq5` | On the 07:00 UTC bar, fade a close outside the 01:00-06:00 range |
| `NX_XAU_DailyTrendH1.mq5` | Close outside the prior 24 bars' range, in the direction of the 480-bar mean |

## Not included

- The **MACD + Trend** rule in `docs/quant/2026-07-22-di-dominance-retune-proposal.md` was a sweep
  result in a proposal, with no stored rule code. The DB rows it grew from are here (#30, #31).
- The 27 **"Mock …"** rows were placeholder strategies from a fallback that has since been removed.
- `pinescript/nexmind-di-cross-gold.pine` and `nexmind-di-widening-gold.pine` are TradingView
  versions of #25 and #30, which are already here.

`Experts/NEXMIND_Gold/*.mq5` was generated from the DB rows. The rule bodies were translated by
hand from each row's JavaScript.
