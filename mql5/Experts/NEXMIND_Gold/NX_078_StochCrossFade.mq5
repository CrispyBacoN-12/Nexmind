//+------------------------------------------------------------------+
//| NX_078_StochCrossFade.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #78 REJECTED 1h GC=F (run 52): trades 178, win 53.4%, avgR -0.066, PF 0.86
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Stochastic %K/%D Crossover Fade (gold)"

#define NX_NAME "Stochastic %K/%D Crossover Fade (gold)"
#define NX_MAGIC 7700078
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.adx) || NA(s.stochK) || NA(s.stochD) || NA(p.stochK) || NA(p.stochD)) return NX_NONE;
   if(s.adx > 25) return NX_NONE;
   bool crossDown = p.stochK >= p.stochD && s.stochK < s.stochD && p.stochK > 80;
   bool crossUp = p.stochK <= p.stochD && s.stochK > s.stochD && p.stochK < 20;
   if(crossDown) { note = "stoch K/D bear cross from " + NxF(p.stochK, 1); return NX_SHORT; }
   if(crossUp) { note = "stoch K/D bull cross from " + NxF(p.stochK, 1); return NX_LONG; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
