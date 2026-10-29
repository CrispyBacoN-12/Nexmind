//+------------------------------------------------------------------+
//| NX_106_Sma20ReCrossAfterExtension.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #106 REJECTED 1h GC=F (run 65): trades 2, win 100.0%, avgR 0.782, PF -
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "VWAP Re-Cross Breakout (post-extension trend flip)"

#define NX_NAME "VWAP Re-Cross Breakout (post-extension trend flip)"
#define NX_MAGIC 7700106
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.sma20) || NA(s.atr) || NA(s.rsi) || NA(s.adx)) return NX_NONE;
   if(NA(p.sma20) || NA(p.atr) || NA(p.rsi)) return NX_NONE;
   if(s.atr <= 0 || p.atr <= 0) return NX_NONE;
   double dev = (s.price - s.sma20) / s.atr, prevDev = (p.price - p.sma20) / p.atr;
   if(s.adx > 30) return NX_NONE;
   if(prevDev <= -1.5 && dev > 0 && p.rsi <= 35) { note = "crossed above SMA20 after ATR extension below"; return NX_LONG; }
   if(prevDev >= 1.5 && dev < 0 && p.rsi >= 65) { note = "crossed below SMA20 after ATR extension above"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
