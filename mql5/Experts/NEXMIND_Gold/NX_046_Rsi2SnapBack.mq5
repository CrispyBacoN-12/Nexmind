//+------------------------------------------------------------------+
//| NX_046_Rsi2SnapBack.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #46 REJECTED 1d GC=F (run 20): trades 10, win 50.0%, avgR -0.209, PF 1.00
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "2-Period RSI Snap-Back (Trend-Aligned Mean Reversion)"

#define NX_NAME "2-Period RSI Snap-Back (Trend-Aligned Mean Reversion)"
#define NX_MAGIC 7700046
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 10) return NX_NONE;
   NexSnap s = snaps[i];
   if(NA(s.adx) || NA(s.sma50) || NA(s.atr)) return NX_NONE;
   if(s.adx > 20) return NX_NONE;
   if(s.atr < bars[i].c * 0.003) return NX_NONE;
   double d1 = bars[i].c - bars[i - 1].c, d2 = bars[i - 1].c - bars[i - 2].c;
   double avgG = (MathMax(0, d1) + MathMax(0, d2)) / 2;
   double avgL = (MathMax(0, -d1) + MathMax(0, -d2)) / 2;
   double r2 = avgL == 0 ? (avgG == 0 ? 50 : 100) : 100 - 100 / (1 + avgG / avgL);
   double mid = (bars[i].h + bars[i].l) / 2;
   if(r2 < 3 && d1 < 0 && d2 < 0 && bars[i].c > s.sma50 && bars[i].c > mid) { note = "2-RSI " + NxF(r2, 1) + " oversold snap-back"; return NX_LONG; }
   if(r2 > 97 && d1 > 0 && d2 > 0 && bars[i].c < s.sma50 && bars[i].c < mid) { note = "2-RSI " + NxF(r2, 1) + " overbought snap-back"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
