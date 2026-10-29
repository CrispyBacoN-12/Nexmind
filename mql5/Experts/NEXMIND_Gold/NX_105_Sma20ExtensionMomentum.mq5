//+------------------------------------------------------------------+
//| NX_105_Sma20ExtensionMomentum.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #105 REJECTED 1h GC=F (run 65): trades 89, win 56.2%, avgR -0.012, PF 0.92
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "VWAP Extension Momentum (MACD-confirmed continuation)"

#define NX_NAME "VWAP Extension Momentum (MACD-confirmed continuation)"
#define NX_MAGIC 7700105
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.sma20) || NA(s.macdHist) || NA(s.adx) || NA(p.sma20) || NA(p.macdHist)) return NX_NONE;
   double dev = (s.price - s.sma20) / s.sma20 * 100, prevDev = (p.price - p.sma20) / p.sma20 * 100;
   if(s.adx < 25) return NX_NONE;
   if(NA(s.plusDI) || NA(s.minusDI)) return NX_NONE;
   bool longCross = dev >= 0.6 && prevDev < 0.6;
   bool shortCross = dev <= -0.6 && prevDev > -0.6;
   if(longCross && s.macdHist > 0 && s.macdHist > p.macdHist && (s.plusDI - s.minusDI) > 3) { note = "fresh break " + NxF(dev, 2) + "% above SMA20"; return NX_LONG; }
   if(shortCross && s.macdHist < 0 && s.macdHist < p.macdHist && (s.minusDI - s.plusDI) > 3) { note = "fresh break " + NxF(dev, 2) + "% below SMA20"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
