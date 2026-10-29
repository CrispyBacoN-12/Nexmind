//+------------------------------------------------------------------+
//| NX_017_TrendPullback_v2_2BarConfirm.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #17 REJECTED 1h GC=F (run 6): trades 7, win 28.6%, avgR -0.095, PF -
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Trend-Pullback v2 (2-bar confirm + MACD, ADX>=22)"

#define NX_NAME "Trend-Pullback v2 (2-bar confirm + MACD, ADX>=22)"
#define NX_MAGIC 7700017
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 2) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   NexSnap pp = snaps[i - 2];
   if(NA(s.sma20) || NA(s.sma50) || NA(s.adx) || NA(s.macdHist) || NA(p.sma20) || NA(pp.sma20)) return NX_NONE;
   if(s.adx < 22) return NX_NONE;
   bool up = s.sma20 > s.sma50, dn = s.sma20 < s.sma50;
   if(up && pp.price <= pp.sma20 && p.price > p.sma20 && s.price > p.price && s.macdHist > 0) { note = "confirmed pullback reclaim (2-bar)"; return NX_LONG; }
   if(dn && pp.price >= pp.sma20 && p.price < p.sma20 && s.price < p.price && s.macdHist < 0) { note = "confirmed pullback rejection (2-bar)"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
