//+------------------------------------------------------------------+
//| NX_024_AdxIgnitionBreakout.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #24 REJECTED 1h GC=F (run 8): trades 100, win 60.0%, avgR 0.080, PF -
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "ADX-Ignition Breakout (tight target)"

#define NX_NAME "ADX-Ignition Breakout (tight target)"
#define NX_MAGIC 7700024
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.adx) || NA(p.adx) || NA(s.plusDI) || NA(s.minusDI) || NA(s.sma50)) return NX_NONE;
   if(p.adx >= 25 || s.adx < 25) return NX_NONE;
   if(s.plusDI > s.minusDI && s.price > s.sma50) { note = "fresh ADX ignition, +DI dominant, above sma50"; return NX_LONG; }
   if(s.minusDI > s.plusDI && s.price < s.sma50) { note = "fresh ADX ignition, -DI dominant, below sma50"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
