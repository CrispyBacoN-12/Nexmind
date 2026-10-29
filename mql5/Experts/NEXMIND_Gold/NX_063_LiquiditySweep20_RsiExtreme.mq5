//+------------------------------------------------------------------+
//| NX_063_LiquiditySweep20_RsiExtreme.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #63 REJECTED 1h GC=F (run 36): trades 213, win 53.5%, avgR -0.061, PF 1.06
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Liquidity Sweep (20-bar, gold, RSI-extreme)"

#define NX_NAME "Liquidity Sweep (20-bar, gold, RSI-extreme)"
#define NX_MAGIC 7700063
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 21) return NX_NONE;
   bool os = false, ob = false;
   for(int j = 1; j <= 8; j++)
     {
      if(NA(snaps[i - j].rsi)) break;
      if(snaps[i - j].rsi < 35) os = true;
      if(snaps[i - j].rsi > 65) ob = true;
     }
   double hi = -DBL_MAX, lo = DBL_MAX;
   for(int k = i - 20; k < i; k++) { if(bars[k].h > hi) hi = bars[k].h; if(bars[k].l < lo) lo = bars[k].l; }
   NexBar c = bars[i];
   if(c.l < lo && c.c > lo && os) { note = "swept below 20-bar low after RSI extreme, closed back above"; return NX_LONG; }
   if(c.h > hi && c.c < hi && ob) { note = "swept above 20-bar high after RSI extreme, closed back below"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
