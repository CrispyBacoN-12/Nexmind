//+------------------------------------------------------------------+
//| NX_067_RsiExtremeFade_Adx25.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #67 REJECTED 1h GC=F (run 40): trades 28, win 67.9%, avgR 0.199, PF 1.47
//| #68 REJECTED 1h GC=F (run 41): trades 57, win 57.9%, avgR 0.014, PF 1.29
//| #74 REJECTED 15m GC=F (run 48): trades 6, win 50.0%, avgR -0.136, PF 0.68
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "RSI Extreme Fade (low-ADX range, ADX<25)"

#define NX_NAME "RSI Extreme Fade (low-ADX range, ADX<25)"
#define NX_MAGIC 7700067
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.rsi) || NA(p.rsi) || NA(s.adx)) return NX_NONE;
   if(s.adx > 25) return NX_NONE;
   if(p.rsi < 30 && s.rsi >= 30) { note = "RSI back above 30, ADX " + NxF(s.adx, 1); return NX_LONG; }
   if(p.rsi > 70 && s.rsi <= 70) { note = "RSI back below 70, ADX " + NxF(s.adx, 1); return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
