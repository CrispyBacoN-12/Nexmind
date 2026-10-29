//+------------------------------------------------------------------+
//| NX_099_LowAdxRsiStretchFade.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #99 REJECTED 1d GC=F (run 63): trades 0, win 0.0%, avgR -, PF -
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Low-ADX RSI Stretch Fade (Mean-Reversion)"

#define NX_NAME "Low-ADX RSI Stretch Fade (Mean-Reversion)"
#define NX_MAGIC 7700099
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 2) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   NexSnap pp = snaps[i - 2];
   if(NA(s.rsi) || NA(s.adx) || NA(s.sma20) || NA(s.atr) || NA(p.rsi) || NA(pp.rsi)) return NX_NONE;
   if(s.adx >= 22 || s.atr <= 0) return NX_NONE;
   NexBar b = bars[i];
   NexBar pb = bars[i - 1];
   double stretch = (s.price - s.sma20) / s.atr;
   double turn = s.rsi - p.rsi;
   double range = b.h - b.l;
   double closePos = range > 1e-9 ? (b.c - b.l) / range : 0.5;
   bool longSetup = p.rsi <= 32 && pp.rsi >= p.rsi && turn >= 2 && s.rsi < 45 && stretch < -1 && stretch > -2.75 && b.c > b.o && closePos >= 0.6 && b.c > pb.c;
   bool shortSetup = p.rsi >= 68 && pp.rsi <= p.rsi && turn <= -2 && s.rsi > 55 && stretch > 1 && stretch < 2.75 && b.c < b.o && closePos <= 0.4 && b.c < pb.c;
   if(longSetup) { note = "RSI turning up from oversold, " + NxF(stretch, 2) + " ATR below SMA20"; return NX_LONG; }
   if(shortSetup) { note = "RSI turning down from overbought, " + NxF(stretch, 2) + " ATR above SMA20"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
