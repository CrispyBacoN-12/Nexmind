//+------------------------------------------------------------------+
//| NX_060_LiquiditySweep20_Depth.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #60 REJECTED 1h GC=F (run 33): trades 190, win 51.6%, avgR -0.096, PF 0.84
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Liquidity Sweep (20-bar, gold, depth-filtered)"

#define NX_NAME "Liquidity Sweep (20-bar, gold, depth-filtered)"
#define NX_MAGIC 7700060
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 21) return NX_NONE;
   NexSnap s = snaps[i];
   if(NA(s.atr)) return NX_NONE;
   double hi = -DBL_MAX, lo = DBL_MAX;
   for(int k = i - 20; k < i; k++) { if(bars[k].h > hi) hi = bars[k].h; if(bars[k].l < lo) lo = bars[k].l; }
   NexBar c = bars[i];
   if(c.l < lo && c.c > lo && lo - c.l >= s.atr * 0.3) { note = "swept below 20-bar low, depth >= 0.3 ATR, closed back above"; return NX_LONG; }
   if(c.h > hi && c.c < hi && c.h - hi >= s.atr * 0.3) { note = "swept above 20-bar high, depth >= 0.3 ATR, closed back below"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
