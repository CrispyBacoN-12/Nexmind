//+------------------------------------------------------------------+
//| NX_049_MacdZeroCross_Sma50.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #49 REJECTED 1h GC=F (run 22): trades 193, win 60.6%, avgR 0.066, PF 1.23
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "MACD Histogram Zero-Cross + SMA50"

#define NX_NAME "MACD Histogram Zero-Cross + SMA50"
#define NX_MAGIC 7700049
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.macdHist) || NA(p.macdHist) || NA(s.sma50)) return NX_NONE;
   double c = bars[i].c;
   if(p.macdHist <= 0 && s.macdHist > 0 && c > s.sma50) { note = "MACD hist crossed up through zero, above SMA50"; return NX_LONG; }
   if(p.macdHist >= 0 && s.macdHist < 0 && c < s.sma50) { note = "MACD hist crossed down through zero, below SMA50"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
