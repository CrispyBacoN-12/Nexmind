//+------------------------------------------------------------------+
//| NX_018_TrendPullback_v3_MacdFilter.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #18 REJECTED 1h GC=F (run 6): trades 3, win 33.3%, avgR 0.667, PF -
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Trend-Pullback v3 (same-bar + MACD filter only)"

#define NX_NAME "Trend-Pullback v3 (same-bar + MACD filter only)"
#define NX_MAGIC 7700018
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.sma20) || NA(s.sma50) || NA(s.adx) || NA(s.macdHist) || NA(p.sma20)) return NX_NONE;
   if(s.adx < 20) return NX_NONE;
   bool up = s.sma20 > s.sma50, dn = s.sma20 < s.sma50;
   if(up && p.price <= p.sma20 && s.price > s.sma20 && s.macdHist > 0) { note = "pullback reclaim + MACD agree"; return NX_LONG; }
   if(dn && p.price >= p.sma20 && s.price < s.sma20 && s.macdHist < 0) { note = "pullback rejection + MACD agree"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
