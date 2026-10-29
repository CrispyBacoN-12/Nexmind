//+------------------------------------------------------------------+
//| NX_082_BbReclaimFade.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #82 REJECTED 1h GC=F (run 56): trades 132, win 56.1%, avgR -0.018, PF 1.03
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Bollinger Band Reclaim Fade (gold)"

#define NX_NAME "Bollinger Band Reclaim Fade (gold)"
#define NX_MAGIC 7700082
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.adx) || NA(s.bbPercentB) || NA(p.bbPercentB)) return NX_NONE;
   if(s.adx > 25) return NX_NONE;
   if(p.bbPercentB > 1 && s.bbPercentB <= 1) { note = "reclaimed inside upper band"; return NX_SHORT; }
   if(p.bbPercentB < 0 && s.bbPercentB >= 0) { note = "reclaimed inside lower band"; return NX_LONG; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
