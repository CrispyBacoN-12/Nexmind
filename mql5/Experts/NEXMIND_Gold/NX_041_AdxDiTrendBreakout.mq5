//+------------------------------------------------------------------+
//| NX_041_AdxDiTrendBreakout.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #41 REJECTED 15m GC=F (run 18): trades 0, win 0.0%, avgR -, PF -
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "ADX / DI Trend Breakout"

#define NX_NAME "ADX / DI Trend Breakout"
#define NX_MAGIC 7700041
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 3) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   NexSnap pp = snaps[i - 2];
   if(NA(s.plusDI) || NA(s.minusDI) || NA(s.adx) || NA(s.sma20) || NA(s.rsi) || NA(s.macdHist) || NA(p.plusDI) || NA(p.minusDI) || NA(p.adx)) return NX_NONE;
   if(NA(pp.adx)) return NX_NONE;
   if(s.adx < 22) return NX_NONE;
   if(!(s.adx > p.adx && p.adx > pp.adx)) return NX_NONE;
   bool bullCross = p.plusDI <= p.minusDI && s.plusDI > s.minusDI;
   bool bearCross = p.plusDI >= p.minusDI && s.plusDI < s.minusDI;
   double c = bars[i].c;
   if(bullCross)
     {
      if(c <= s.sma20 || s.rsi > 68 || s.macdHist <= 0) return NX_NONE;
      note = "+DI cross, ADX " + NxF(s.adx, 1) + " rising 2 bars"; return NX_LONG;
     }
   if(bearCross)
     {
      if(c >= s.sma20 || s.rsi < 32 || s.macdHist >= 0) return NX_NONE;
      note = "-DI cross, ADX " + NxF(s.adx, 1) + " rising 2 bars"; return NX_SHORT;
     }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
