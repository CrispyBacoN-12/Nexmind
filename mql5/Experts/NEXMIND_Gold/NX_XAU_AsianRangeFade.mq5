//+------------------------------------------------------------------+
//| NX_XAU_AsianRangeFade.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| xau-v1 hypothesis "xau-asia-fade" (pre-registered 2026-09-08)
//|   Asian-range fade: at the London open, fade a break of the 01:00-06:00 range
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
#property description "xau-v1 xau-asia-fade"

#define NX_NAME "xau-v1 xau-asia-fade"
#define NX_MAGIC 7790003
#define NX_WEEKEND_FLAT true
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(NxUtcHour(bars[i].t) != 7) return NX_NONE;   // London open only
   if(i < 6) return NX_NONE;
   double hi = -DBL_MAX, lo = DBL_MAX;
   for(int k = i - 6; k < i; k++) { if(bars[k].h > hi) hi = bars[k].h; if(bars[k].l < lo) lo = bars[k].l; }
   if(bars[i].c > hi) { note = "fade break above Asian range"; return NX_SHORT; }
   if(bars[i].c < lo) { note = "fade break below Asian range"; return NX_LONG; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
