//+------------------------------------------------------------------+
//| NX_070_MacdExhaustionFade.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #70 REJECTED 1h GC=F (run 43): trades 567, win 54.7%, avgR -0.041, PF 0.93
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "MACD Histogram Exhaustion Fade (gold)"

#define NX_NAME "MACD Histogram Exhaustion Fade (gold)"
#define NX_MAGIC 7700070
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 2) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   NexSnap pp = snaps[i - 2];
   if(NA(s.macdHist) || NA(p.macdHist) || NA(pp.macdHist)) return NX_NONE;
   if(pp.macdHist < p.macdHist && p.macdHist > s.macdHist && s.macdHist > 0) { note = "MACD hist peaked positive and contracting"; return NX_SHORT; }
   if(pp.macdHist > p.macdHist && p.macdHist < s.macdHist && s.macdHist < 0) { note = "MACD hist troughed negative and contracting"; return NX_LONG; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
