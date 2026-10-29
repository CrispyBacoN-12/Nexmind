//+------------------------------------------------------------------+
//| NX_045_Rsi50Flip_LowAdx.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #45 REJECTED 1d GC=F (run 20): trades 4, win 0.0%, avgR -1.098, PF 0.00
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "RSI-50 Momentum Flip (Low-ADX Ranging Regime)"

#define NX_NAME "RSI-50 Momentum Flip (Low-ADX Ranging Regime)"
#define NX_MAGIC 7700045
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 6) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   NexSnap pp = snaps[i - 2];
   if(NA(s.rsi) || NA(p.rsi) || NA(s.adx) || NA(s.macdHist) || NA(p.macdHist) || NA(pp.macdHist)) return NX_NONE;
   if(s.adx > 18) return NX_NONE;
   double rng = bars[i].h - bars[i].l;
   double closePos = rng > 0 ? (bars[i].c - bars[i].l) / rng : 0.5;
   bool wasLow = false, wasHigh = false;
   for(int k = i - 5; k < i; k++)
     {
      if(NA(snaps[k].rsi)) continue;
      if(snaps[k].rsi < 42) wasLow = true;
      if(snaps[k].rsi > 58) wasHigh = true;
     }
   bool accL = s.macdHist > p.macdHist && p.macdHist > pp.macdHist && s.macdHist > 0;
   bool accS = s.macdHist < p.macdHist && p.macdHist < pp.macdHist && s.macdHist < 0;
   if(p.rsi < 50 && s.rsi >= 50 && accL && closePos >= 0.63 && wasLow) { note = "RSI flip up " + NxF(s.rsi, 1); return NX_LONG; }
   if(p.rsi > 50 && s.rsi <= 50 && accS && closePos <= 0.37 && wasHigh) { note = "RSI flip down " + NxF(s.rsi, 1); return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
