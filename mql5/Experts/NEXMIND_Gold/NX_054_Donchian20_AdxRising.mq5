//+------------------------------------------------------------------+
//| NX_054_Donchian20_AdxRising.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #54 REJECTED 1h GC=F (run 27): trades 238, win 57.6%, avgR 0.011, PF 0.95
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "20-Bar Donchian Breakout (gold, ADX-rising)"

#define NX_NAME "20-Bar Donchian Breakout (gold, ADX-rising)"
#define NX_MAGIC 7700054
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 21) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.adx) || NA(p.adx)) return NX_NONE;
   if(s.adx < 22 || s.adx <= p.adx) return NX_NONE;
   double hi = -DBL_MAX, lo = DBL_MAX;
   for(int k = i - 20; k < i; k++) { if(bars[k].h > hi) hi = bars[k].h; if(bars[k].l < lo) lo = bars[k].l; }
   double c = bars[i].c, pc = bars[i - 1].c;
   if(pc <= hi && c > hi) { note = "20-bar Donchian breakout long, ADX rising to " + NxF(s.adx, 0); return NX_LONG; }
   if(pc >= lo && c < lo) { note = "20-bar Donchian breakout short, ADX rising to " + NxF(s.adx, 0); return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
