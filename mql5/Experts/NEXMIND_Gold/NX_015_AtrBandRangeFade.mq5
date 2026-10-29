//+------------------------------------------------------------------+
//| NX_015_AtrBandRangeFade.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #15 REJECTED 1h GC=F (run 5): trades 10, win 40.0%, avgR 0.267, PF -
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "ATR-Band Range Fade"

#define NX_NAME "ATR-Band Range Fade"
#define NX_MAGIC 7700015
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   if(NA(s.adx) || NA(s.rsi) || NA(s.sma20) || NA(s.atr)) return NX_NONE;
   if(s.adx > 18) return NX_NONE;
   double ub = s.sma20 + s.atr * 1.5, lb = s.sma20 - s.atr * 1.5;
   if(s.price > ub && s.rsi > 65) { note = "range fade above sma20, RSI " + NxF(s.rsi, 0); return NX_SHORT; }
   if(s.price < lb && s.rsi < 35) { note = "range fade below sma20, RSI " + NxF(s.rsi, 0); return NX_LONG; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
