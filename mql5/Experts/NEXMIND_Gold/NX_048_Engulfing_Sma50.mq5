//+------------------------------------------------------------------+
//| NX_048_Engulfing_Sma50.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #48 REJECTED 1h GC=F (run 21): trades 329, win 56.2%, avgR -0.013, PF 0.83
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Engulfing + SMA50 trend filter"

#define NX_NAME "Engulfing + SMA50 trend filter"
#define NX_MAGIC 7700048
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   if(NA(s.sma50)) return NX_NONE;
   NexBar c = bars[i];
   NexBar pb = bars[i - 1];
   bool bull = c.c > c.o, bear = c.c < c.o, pBull = pb.c > pb.o, pBear = pb.c < pb.o;
   if(bull && pBear && c.o <= pb.c && c.c >= pb.o && c.c > s.sma50) { note = "bullish engulfing above SMA50"; return NX_LONG; }
   if(bear && pBull && c.o >= pb.c && c.c <= pb.o && c.c < s.sma50) { note = "bearish engulfing below SMA50"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
