//+------------------------------------------------------------------+
//| NX_102_VolExpansionMomentum.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #102 REJECTED 1h GC=F (run 64): trades 386, win 57.0%, avgR 0.003, PF 1.00
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Volatility-Expansion Momentum Continuation"

#define NX_NAME "Volatility-Expansion Momentum Continuation"
#define NX_MAGIC 7700102
#include "NexCore.mqh"

void BbAt(const NexBar &bars[], const int end, double &mean, double &sd)
  {
   double sum = 0;
   for(int k = end - 19; k <= end; k++) sum += bars[k].c;
   mean = sum / 20;
   double sq = 0;
   for(int k = end - 19; k <= end; k++) { double d = bars[k].c - mean; sq += d * d; }
   sd = MathSqrt(sq / 20);
  }

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i + 1 < 45) return NX_NONE;
   double m0, d0, m1, d1, m2, d2;
   BbAt(bars, i, m0, d0); BbAt(bars, i - 1, m1, d1); BbAt(bars, i - 2, m2, d2);
   double w0 = 4 * d0 / m0, w1 = 4 * d1 / m1, w2 = 4 * d2 / m2;
   if(!(w0 > w1 && w1 > w2)) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.macdHist) || NA(s.adx) || NA(s.plusDI) || NA(s.minusDI) || NA(p.macdHist) || NA(p.adx)) return NX_NONE;
   bool adxRising = s.adx > p.adx;
   if(s.macdHist > 0 && s.macdHist > p.macdHist && s.plusDI > s.minusDI && adxRising && s.adx > 15) { note = "bbWidth expanding, MACD rising, ADX " + NxF(s.adx, 1); return NX_LONG; }
   if(s.macdHist < 0 && s.macdHist < p.macdHist && s.minusDI > s.plusDI && adxRising && s.adx > 15) { note = "bbWidth expanding, MACD falling, ADX " + NxF(s.adx, 1); return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
