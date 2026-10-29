//+------------------------------------------------------------------+
//| NX_019_DiDominance_Adx25.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #19 REJECTED 1h GC=F (run 7): trades 234, win 27.4%, avgR 0.085, PF -
//| #22 REJECTED 1h GC=F (run 8): trades 504, win 56.9%, avgR 0.025, PF -
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "DI-Dominance Continuation (widening gap)"

#define NX_NAME "DI-Dominance Continuation (widening gap)"
#define NX_MAGIC 7700019
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.plusDI) || NA(s.minusDI) || NA(p.plusDI) || NA(p.minusDI) || NA(s.adx)) return NX_NONE;
   if(s.adx < 25) return NX_NONE;
   double gap = MathAbs(s.plusDI - s.minusDI), pGap = MathAbs(p.plusDI - p.minusDI);
   if(s.plusDI > s.minusDI && gap > pGap) { note = "DI gap widening, +DI dominant"; return NX_LONG; }
   if(s.minusDI > s.plusDI && gap > pGap) { note = "DI gap widening, -DI dominant"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
