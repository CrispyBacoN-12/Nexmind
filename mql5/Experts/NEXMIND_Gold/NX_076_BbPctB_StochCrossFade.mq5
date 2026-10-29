//+------------------------------------------------------------------+
//| NX_076_BbPctB_StochCrossFade.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #76 REJECTED 1h GC=F (run 50): trades 61, win 57.4%, avgR 0.006, PF 1.06
//| #80 REJECTED 1d GC=F (run 54): trades 13, win 38.5%, avgR -0.317, PF 0.42
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Bollinger %B + Stoch %K/%D Crossover Fade (gold)"

#define NX_NAME "Bollinger %B + Stoch %K/%D Crossover Fade (gold)"
#define NX_MAGIC 7700076
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.adx) || NA(s.bbPercentB) || NA(p.bbPercentB)) return NX_NONE;
   if(NA(s.stochK) || NA(s.stochD) || NA(p.stochK) || NA(p.stochD)) return NX_NONE;
   if(s.adx > 25) return NX_NONE;
   bool crossDown = p.stochK >= p.stochD && s.stochK < s.stochD && p.stochK > 80;
   bool crossUp = p.stochK <= p.stochD && s.stochK > s.stochD && p.stochK < 20;
   if(p.bbPercentB > 1 && crossDown) { note = "band breach + stoch K/D bear cross"; return NX_SHORT; }
   if(p.bbPercentB < 0 && crossUp) { note = "band breach + stoch K/D bull cross"; return NX_LONG; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
