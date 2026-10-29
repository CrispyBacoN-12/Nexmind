//+------------------------------------------------------------------+
//| NX_025_DiCross.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #25 APPROVED 1h GC=F (run 9): trades 65, win 63.1%, avgR 0.135, PF -
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "DI-Cross (no ADX filter)"

#define NX_NAME "DI-Cross (no ADX filter)"
#define NX_MAGIC 7700025
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.plusDI) || NA(s.minusDI) || NA(p.plusDI) || NA(p.minusDI)) return NX_NONE;
   if(p.plusDI <= p.minusDI && s.plusDI > s.minusDI) { note = "DI cross up"; return NX_LONG; }
   if(p.plusDI >= p.minusDI && s.plusDI < s.minusDI) { note = "DI cross down"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
