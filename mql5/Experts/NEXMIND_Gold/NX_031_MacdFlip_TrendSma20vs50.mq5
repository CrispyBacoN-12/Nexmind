//+------------------------------------------------------------------+
//| NX_031_MacdFlip_TrendSma20vs50.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #31 REJECTED 1h GC=F (run 14): trades 165, win 61.2%, avgR 0.102, PF -
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "MACD Hist Flip + Trend Filter (sma20 vs sma50)"

#define NX_NAME "MACD Hist Flip + Trend Filter (sma20 vs sma50)"
#define NX_MAGIC 7700031
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.macdHist) || NA(p.macdHist) || NA(s.sma20) || NA(s.sma50)) return NX_NONE;
   if(p.macdHist <= 0 && s.macdHist > 0 && s.sma20 > s.sma50) { note = "MACD hist flips positive, uptrend"; return NX_LONG; }
   if(p.macdHist >= 0 && s.macdHist < 0 && s.sma20 < s.sma50) { note = "MACD hist flips negative, downtrend"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
