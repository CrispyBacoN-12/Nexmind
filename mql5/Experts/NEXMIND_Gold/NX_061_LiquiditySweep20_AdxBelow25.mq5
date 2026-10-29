//+------------------------------------------------------------------+
//| NX_061_LiquiditySweep20_AdxBelow25.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #61 REJECTED 1h GC=F (run 34): trades 192, win 51.0%, avgR -0.108, PF 0.83
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Liquidity Sweep (20-bar, gold, ADX<25)"

#define NX_NAME "Liquidity Sweep (20-bar, gold, ADX<25)"
#define NX_MAGIC 7700061
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 21) return NX_NONE;
   NexSnap s = snaps[i];
   if(NA(s.adx) || s.adx >= 25) return NX_NONE;
   double hi = -DBL_MAX, lo = DBL_MAX;
   for(int k = i - 20; k < i; k++) { if(bars[k].h > hi) hi = bars[k].h; if(bars[k].l < lo) lo = bars[k].l; }
   NexBar c = bars[i];
   if(c.l < lo && c.c > lo) { note = "swept below 20-bar low, ADX<25, closed back above"; return NX_LONG; }
   if(c.h > hi && c.c < hi) { note = "swept above 20-bar high, ADX<25, closed back below"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
