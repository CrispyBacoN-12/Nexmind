//+------------------------------------------------------------------+
//| NX_014_MacdDiMomentumIgnition.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #14 REJECTED 1h GC=F (run 5): trades 35, win 22.9%, avgR 0.248, PF -
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "MACD-DI Momentum Ignition"

#define NX_NAME "MACD-DI Momentum Ignition"
#define NX_MAGIC 7700014
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.macdHist) || NA(p.macdHist) || NA(s.plusDI) || NA(s.minusDI)) return NX_NONE;
   bool cu = p.macdHist <= 0 && s.macdHist > 0;
   bool cd = p.macdHist >= 0 && s.macdHist < 0;
   if(cu && s.plusDI > s.minusDI) { note = "MACD hist turned positive, +DI leading"; return NX_LONG; }
   if(cd && s.minusDI > s.plusDI) { note = "MACD hist turned negative, -DI leading"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
