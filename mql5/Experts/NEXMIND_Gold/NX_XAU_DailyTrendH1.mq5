//+------------------------------------------------------------------+
//| NX_XAU_DailyTrendH1.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| xau-v1 hypothesis "xau-daily-trend" (pre-registered 2026-09-08)
//|   daily trend, H1 execution: one-day breakout taken only in the direction of the 20-day mean
//|   Source: src/lib/research/mechanisms.ts on branch xau-v1-phase0-1-unblock
//|   Tested: Exness XAUUSDm H1, 5 folds, flat ladder TP 1.2 / SL 1.5 ATR,
//|   fill at the next bar's open, flat over the weekend.
//|   VERDICT 2026-10-01: REJECT (docs/quant/2026-10-01-xau-v1-results.md)
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule copied verbatim from the TypeScript mechanism.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "xau-v1 xau-daily-trend"

#define NX_NAME "xau-v1 xau-daily-trend"
#define NX_MAGIC 7790004
#define NX_WEEKEND_FLAT true
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 479) return NX_NONE;
   double sum = 0;
   for(int k = i - 479; k <= i; k++) sum += bars[k].c;
   double m = sum / 480;   // ~20 days of H1 bars
   if(i < 24) return NX_NONE;
   double hi = -DBL_MAX, lo = DBL_MAX;
   for(int k = i - 24; k < i; k++) { if(bars[k].h > hi) hi = bars[k].h; if(bars[k].l < lo) lo = bars[k].l; }
   if(bars[i].c > m && bars[i].c > hi) { note = "1-day breakout up, above 20-day mean"; return NX_LONG; }
   if(bars[i].c < m && bars[i].c < lo) { note = "1-day breakout down, below 20-day mean"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
