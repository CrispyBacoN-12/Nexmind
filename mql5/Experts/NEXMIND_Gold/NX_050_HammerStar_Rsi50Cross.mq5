//+------------------------------------------------------------------+
//| NX_050_HammerStar_Rsi50Cross.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #50 REJECTED 1h GC=F (run 23): trades 10, win 30.0%, avgR -0.478, PF 0.15
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Hammer/Shooting Star + RSI 50-cross"

#define NX_NAME "Hammer/Shooting Star + RSI 50-cross"
#define NX_MAGIC 7700050
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.rsi) || NA(p.rsi)) return NX_NONE;
   NexBar c = bars[i];
   double body = MathAbs(c.c - c.o), range = c.h - c.l;
   if(range <= 0 || body <= range * 0.01) return NX_NONE;
   double uw = c.h - MathMax(c.o, c.c), lw = MathMin(c.o, c.c) - c.l;
   bool hammer = lw >= body * 2 && uw <= body * 0.5 && body <= range * 0.35;
   bool star = uw >= body * 2 && lw <= body * 0.5 && body <= range * 0.35;
   if(hammer && p.rsi <= 50 && s.rsi > 50) { note = "hammer + RSI crossed above 50"; return NX_LONG; }
   if(star && p.rsi >= 50 && s.rsi < 50) { note = "shooting star + RSI crossed below 50"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
