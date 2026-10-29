//+------------------------------------------------------------------+
//| NX_075_BbPctB_StochTurnFade.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #75 REJECTED 1h GC=F (run 49): trades 96, win 55.2%, avgR -0.033, PF 1.00
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Bollinger %B + Stochastic Fade (gold)"

#define NX_NAME "Bollinger %B + Stochastic Fade (gold)"
#define NX_MAGIC 7700075
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.adx) || NA(s.bbPercentB) || NA(p.bbPercentB) || NA(s.stochK) || NA(p.stochK)) return NX_NONE;
   if(s.adx > 25) return NX_NONE;
   bool turnDown = p.stochK > 80 && s.stochK < p.stochK;
   bool turnUp = p.stochK < 20 && s.stochK > p.stochK;
   if(p.bbPercentB > 1 && turnDown) { note = "band breach + stoch turn down"; return NX_SHORT; }
   if(p.bbPercentB < 0 && turnUp) { note = "band breach + stoch turn up"; return NX_LONG; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
