//+------------------------------------------------------------------+
//| NX_103_BandExtremeFade_Rangebound.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #103 REJECTED 1h GC=F (run 64): trades 2, win 50.0%, avgR -0.126, PF 0.35
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Band-Extreme Mean-Reversion Fade (rangebound)"

#define NX_NAME "Band-Extreme Mean-Reversion Fade (rangebound)"
#define NX_MAGIC 7700103
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
   if(i + 1 < 27) return NX_NONE;
   double m0, d0, m1, d1, m2, d2;
   BbAt(bars, i, m0, d0); BbAt(bars, i - 1, m1, d1); BbAt(bars, i - 2, m2, d2);
   double upper = m0 + 2 * d0, lower = m0 - 2 * d0;
   double upperPrev = m1 + 2 * d1, lowerPrev = m1 - 2 * d1;
   double upperPrev2 = m2 + 2 * d2, lowerPrev2 = m2 - 2 * d2;
   double price = bars[i].c, open = bars[i].o, pricePrev = bars[i - 1].c, pricePrev2 = bars[i - 2].c;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.adx) || NA(s.rsi) || NA(p.rsi) || NA(s.plusDI) || NA(s.minusDI) || NA(p.adx)) return NX_NONE;
   if(!(s.adx < 18 && MathAbs(s.plusDI - s.minusDI) < 10 && s.adx <= p.adx + 0.5)) return NX_NONE;
   if((upper - lower) / m0 < 0.012) return NX_NONE;
   double buffer = 0.15 * d0;
   bool freshAbove = pricePrev2 <= upperPrev2 && pricePrev > upperPrev;
   if(freshAbove && price <= upper - buffer && p.rsi > 70 && s.rsi < p.rsi && price < open) { note = "fade short: poked above upper BB, closed back inside"; return NX_SHORT; }
   bool freshBelow = pricePrev2 >= lowerPrev2 && pricePrev < lowerPrev;
   if(freshBelow && price >= lower + buffer && p.rsi < 30 && s.rsi > p.rsi && price > open) { note = "fade long: poked below lower BB, closed back inside"; return NX_LONG; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
