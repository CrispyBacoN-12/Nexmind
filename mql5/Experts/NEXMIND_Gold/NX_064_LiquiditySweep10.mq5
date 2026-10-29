//+------------------------------------------------------------------+
//| NX_064_LiquiditySweep10.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #64 REJECTED 1h GC=F (run 37): trades 514, win 53.3%, avgR -0.065, PF 0.96
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Liquidity Sweep (10-bar, gold)"

#define NX_NAME "Liquidity Sweep (10-bar, gold)"
#define NX_MAGIC 7700064
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 11) return NX_NONE;
   double hi = -DBL_MAX, lo = DBL_MAX;
   for(int k = i - 10; k < i; k++) { if(bars[k].h > hi) hi = bars[k].h; if(bars[k].l < lo) lo = bars[k].l; }
   NexBar c = bars[i];
   if(c.l < lo && c.c > lo) { note = "swept below 10-bar low, closed back above"; return NX_LONG; }
   if(c.h > hi && c.c < hi) { note = "swept above 10-bar high, closed back below"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
