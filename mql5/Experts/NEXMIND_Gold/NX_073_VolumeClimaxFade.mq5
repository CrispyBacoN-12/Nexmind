//+------------------------------------------------------------------+
//| NX_073_VolumeClimaxFade.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #73 REJECTED 1h GC=F (run 46): trades 243, win 48.6%, avgR -0.152, PF 0.74
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Volume Climax Fade (gold)"

#define NX_NAME "Volume Climax Fade (gold)"
#define NX_MAGIC 7700073
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 20) return NX_NONE;
   NexSnap s = snaps[i];
   if(NA(s.adx)) return NX_NONE;
   if(s.adx > 25) return NX_NONE;
   double volSum = 0;
   for(int k = i - 20; k < i; k++) volSum += bars[k].v;
   double avgVol = volSum / 20;
   if(avgVol <= 0) return NX_NONE;
   NexBar c = bars[i];
   if(c.v > avgVol * 2 && c.c < c.o) { note = "volume climax on bearish bar (" + NxF(c.v / avgVol, 1) + "x avg)"; return NX_LONG; }
   if(c.v > avgVol * 2 && c.c > c.o) { note = "volume climax on bullish bar (" + NxF(c.v / avgVol, 1) + "x avg)"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
