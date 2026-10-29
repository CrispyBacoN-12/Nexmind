//+------------------------------------------------------------------+
//| NX_XAU_MrDown3.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| xau-v1 hypothesis "mr-down3" (pre-registered 2026-09-08)
//|   time-series mean reversion: long after 3 consecutive lower closes
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
#property description "xau-v1 mr-down3"

#define NX_NAME "xau-v1 mr-down3"
#define NX_MAGIC 7790001
#define NX_WEEKEND_FLAT true
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 3) return NX_NONE;
   if(bars[i].c < bars[i - 1].c && bars[i - 1].c < bars[i - 2].c && bars[i - 2].c < bars[i - 3].c) { note = "3 consecutive lower closes"; return NX_LONG; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
