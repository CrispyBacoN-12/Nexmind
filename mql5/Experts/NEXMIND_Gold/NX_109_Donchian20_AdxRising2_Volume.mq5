//+------------------------------------------------------------------+
//| NX_109_Donchian20_AdxRising2_Volume.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #109 REJECTED 1d GC=F (run 67): trades 1, win 100.0%, avgR 0.798, PF -
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "20-Bar Donchian Breakout, ADX-Rising Confirm (max-history refinement of research-63)"

#define NX_NAME "20-Bar Donchian Breakout, ADX-Rising Confirm (max-history re"
#define NX_MAGIC 7700109
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 22) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   NexSnap pp = snaps[i - 2];
   if(NA(s.adx) || NA(p.adx) || NA(pp.adx) || NA(s.plusDI) || NA(s.minusDI) || NA(s.atr)) return NX_NONE;
   if(NA(s.macdHist) || NA(p.macdHist) || NA(s.sma20)) return NX_NONE;
   if(s.atr <= 0) return NX_NONE;
   double hh = -DBL_MAX, ll = DBL_MAX, volSum = 0;
   for(int k = i - 20; k < i; k++) { if(bars[k].h > hh) hh = bars[k].h; if(bars[k].l < ll) ll = bars[k].l; volSum += bars[k].v; }
   double avgVol = volSum / 20, curVol = bars[i].v, c = bars[i].c;
   bool adxRising = s.adx > p.adx && p.adx > pp.adx;
   bool adxStrong = s.adx > 23;
   double buffer = s.atr * 0.2;
   bool volOk = curVol > avgVol * 1.1;
   bool notOver = MathAbs(c - s.sma20) / s.atr < 3.5;
   if(c > hh + buffer && adxRising && adxStrong && s.plusDI > s.minusDI && volOk && notOver && s.macdHist > p.macdHist && s.macdHist > 0) { note = "Donchian20 breakout, ADX rising 2 bars"; return NX_LONG; }
   if(c < ll - buffer && adxRising && adxStrong && s.minusDI > s.plusDI && volOk && notOver && s.macdHist < p.macdHist && s.macdHist < 0) { note = "Donchian20 breakdown, ADX rising 2 bars"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
