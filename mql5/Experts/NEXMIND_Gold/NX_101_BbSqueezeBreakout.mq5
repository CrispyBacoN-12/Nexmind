//+------------------------------------------------------------------+
//| NX_101_BbSqueezeBreakout.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #101 REJECTED 1h GC=F (run 64): trades 2, win 50.0%, avgR -0.132, PF 6.94
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "BB Squeeze Breakout (volatility contraction release)"

#define NX_NAME "BB Squeeze Breakout (volatility contraction release)"
#define NX_MAGIC 7700101
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
   if(i + 1 < 65) return NX_NONE;
   double cm, csd, pm, psd;
   BbAt(bars, i, cm, csd);
   BbAt(bars, i - 1, pm, psd);
   double cu = cm + 2 * csd, cl = cm - 2 * csd, pu = pm + 2 * psd, pl = pm - 2 * psd;
   double curWidth = (cu - cl) / cm;
   double minWidth = curWidth;
   for(int j = i - 39; j < i; j++)
     {
      double m, sd;
      BbAt(bars, j, m, sd);
      double w = (4 * sd) / m;
      if(w < minWidth) minWidth = w;
     }
   if(!(curWidth <= minWidth * 1.08)) return NX_NONE;
   if(cu == cl || pu == pl) return NX_NONE;
   double pctB = (bars[i].c - cl) / (cu - cl);
   double prevPctB = (bars[i - 1].c - pl) / (pu - pl);
   NexSnap s = snaps[i];
   NexSnap s2 = snaps[i - 2];
   if(NA(s.adx) || NA(s.atr) || NA(s.plusDI) || NA(s.minusDI)) return NX_NONE;
   bool adxRising = !NA(s2.adx) && s.adx > s2.adx;
   if(!(s.adx > 18 && adxRising)) return NX_NONE;
   double barRange = bars[i].h - bars[i].l;
   if(!(s.atr > 0 && barRange > s.atr * 1.0)) return NX_NONE;
   if(prevPctB <= 1 && pctB > 1.01 && s.plusDI > s.minusDI) { note = "BB squeeze breakout long"; return NX_LONG; }
   if(prevPctB >= 0 && pctB < -0.01 && s.minusDI > s.plusDI) { note = "BB squeeze breakout short"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
