//+------------------------------------------------------------------+
//| NX_079_VwapDeviationFade.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #79 REJECTED 1h GC=F (run 53): trades 152, win 51.3%, avgR -0.097, PF 0.81
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "VWAP Deviation Fade (gold)"

#define NX_NAME "VWAP Deviation Fade (gold)"
#define NX_MAGIC 7700079
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 1) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.adx) || NA(s.vwapDevPct) || NA(p.vwapDevPct)) return NX_NONE;
   if(s.adx > 25) return NX_NONE;
   double T = 0.005;
   if(p.vwapDevPct > T && s.vwapDevPct <= p.vwapDevPct) { note = "faded back toward VWAP from +" + NxF(p.vwapDevPct * 100, 2) + "%"; return NX_SHORT; }
   if(p.vwapDevPct < -T && s.vwapDevPct >= p.vwapDevPct) { note = "faded back toward VWAP from " + NxF(p.vwapDevPct * 100, 2) + "%"; return NX_LONG; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
