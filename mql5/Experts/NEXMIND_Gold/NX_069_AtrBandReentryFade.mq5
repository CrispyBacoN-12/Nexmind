//+------------------------------------------------------------------+
//| NX_069_AtrBandReentryFade.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #69 REJECTED 1h GC=F (run 42): trades 48, win 64.6%, avgR 0.135, PF 1.40
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "ATR-Band Mean Reversion (gold)"

#define NX_NAME "ATR-Band Mean Reversion (gold)"
#define NX_MAGIC 7700069
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   if(NA(s.sma20) || NA(s.atr) || NA(s.adx)) return NX_NONE;
   if(s.adx > 25) return NX_NONE;
   double upper = s.sma20 + 2 * s.atr, lower = s.sma20 - 2 * s.atr;
   if(bars[i - 1].c > upper && bars[i].c <= upper) { note = "faded back inside upper ATR band"; return NX_SHORT; }
   if(bars[i - 1].c < lower && bars[i].c >= lower) { note = "faded back inside lower ATR band"; return NX_LONG; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
