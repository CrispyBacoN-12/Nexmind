//+------------------------------------------------------------------+
//| NX_021_RsiExtremeFade_Adx20.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #21 REJECTED 1h GC=F (run 7): trades 11, win 27.3%, avgR 0.197, PF -
//| #65 REJECTED 1h GC=F (run 38): trades 11, win 72.7%, avgR 0.288, PF 1.77
//| #66 REJECTED 1h GC=F (run 39): trades 23, win 52.2%, avgR -0.087, PF 1.02
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "RSI-Cross-Back Range Fade"

#define NX_NAME "RSI-Cross-Back Range Fade"
#define NX_MAGIC 7700021
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.rsi) || NA(p.rsi) || NA(s.adx)) return NX_NONE;
   if(s.adx > 20) return NX_NONE;
   if(p.rsi < 30 && s.rsi >= 30) { note = "RSI back above 30, ADX " + NxF(s.adx, 1); return NX_LONG; }
   if(p.rsi > 70 && s.rsi <= 70) { note = "RSI back below 70, ADX " + NxF(s.adx, 1); return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
