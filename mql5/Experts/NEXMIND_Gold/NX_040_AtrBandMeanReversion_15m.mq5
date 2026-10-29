//+------------------------------------------------------------------+
//| NX_040_AtrBandMeanReversion_15m.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #40 REJECTED 15m GC=F (run 18): trades 2, win 50.0%, avgR -0.497, PF 0.32
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "ATR-Band Mean Reversion"

#define NX_NAME "ATR-Band Mean Reversion"
#define NX_MAGIC 7700040
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   int localHour = (NxUtcHour(bars[i].t) + 7) % 24;   // the original rule's Bangkok-time window
   if(localHour < 8 || localHour >= 17) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.sma20) || NA(s.rsi) || NA(s.atr) || NA(s.adx) || NA(p.rsi)) return NX_NONE;
   if(s.adx > 25 || s.atr <= 0) return NX_NONE;
   double dev = (bars[i].c - s.sma20) / s.atr;
   if(dev <= -1.5 && s.rsi < 36 && s.rsi > p.rsi) { note = "Dev " + NxF(dev, 2) + " xATR below SMA20, RSI turning up"; return NX_LONG; }
   if(dev >= 1.5 && s.rsi > 64 && s.rsi < p.rsi) { note = "Dev " + NxF(dev, 2) + " xATR above SMA20, RSI turning down"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
