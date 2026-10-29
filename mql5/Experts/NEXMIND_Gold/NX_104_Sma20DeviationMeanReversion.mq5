//+------------------------------------------------------------------+
//| NX_104_Sma20DeviationMeanReversion.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #104 REJECTED 1h GC=F (run 65): trades 2, win 0.0%, avgR -1.021, PF 0.00
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "VWAP Deviation Mean-Reversion (RSI-confirmed)"

#define NX_NAME "VWAP Deviation Mean-Reversion (RSI-confirmed)"
#define NX_MAGIC 7700104
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.sma20) || NA(s.rsi) || NA(p.rsi)) return NX_NONE;
   double dev = (s.price - s.sma20) / s.sma20 * 100;
   if(!NA(s.adx) && s.adx > 22) return NX_NONE;
   bool up = s.rsi > p.rsi, dn = s.rsi < p.rsi;
   bool diOk = NA(s.plusDI) || NA(s.minusDI) || MathAbs(s.plusDI - s.minusDI) < 12;
   if(dev <= -1.0 && s.rsi < 30 && up && diOk) { note = "mean reversion long, " + NxF(dev, 2) + "% below SMA20"; return NX_LONG; }
   if(dev >= 1.0 && s.rsi > 70 && dn && diOk) { note = "mean reversion short, " + NxF(dev, 2) + "% above SMA20"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
