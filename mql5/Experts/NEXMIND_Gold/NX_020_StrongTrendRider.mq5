//+------------------------------------------------------------------+
//| NX_020_StrongTrendRider.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #20 REJECTED 1h GC=F (run 7): trades 117, win 25.6%, avgR 0.094, PF -
//| #23 REJECTED 1h GC=F (run 8): trades 211, win 57.3%, avgR 0.032, PF -
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Strong-Trend Rider (ADX>28 rising, MACD accelerating)"

#define NX_NAME "Strong-Trend Rider (ADX>28 rising, MACD accelerating)"
#define NX_MAGIC 7700020
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.adx) || NA(p.adx) || NA(s.plusDI) || NA(s.minusDI) || NA(s.sma20) || NA(s.sma50) || NA(s.macdHist) || NA(p.macdHist)) return NX_NONE;
   if(s.adx < 28 || s.adx <= p.adx) return NX_NONE;
   if(MathAbs(s.plusDI - s.minusDI) < 10) return NX_NONE;
   if(s.plusDI > s.minusDI && s.price > s.sma20 && s.sma20 > s.sma50 && s.macdHist > p.macdHist && s.macdHist > 0) { note = "strong trend rider, ADX " + NxF(s.adx, 0) + " rising"; return NX_LONG; }
   if(s.minusDI > s.plusDI && s.price < s.sma20 && s.sma20 < s.sma50 && s.macdHist < p.macdHist && s.macdHist < 0) { note = "strong trend rider, ADX " + NxF(s.adx, 0) + " rising"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
