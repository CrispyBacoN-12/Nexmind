//+------------------------------------------------------------------+
//| NX_100_Donchian20_AdxVolume.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #100 REJECTED 1d GC=F (run 63): trades 19, win 68.4%, avgR 0.223, PF 1.24
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "20-Bar Donchian Breakout with ADX Confirmation (Breakout)"

#define NX_NAME "20-Bar Donchian Breakout with ADX Confirmation (Breakout)"
#define NX_MAGIC 7700100
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 20) return NX_NONE;
   double hh = -DBL_MAX, ll = DBL_MAX, volSum = 0;
   for(int k = i - 20; k < i; k++) { if(bars[k].h > hh) hh = bars[k].h; if(bars[k].l < ll) ll = bars[k].l; volSum += bars[k].v; }
   double avgVol = volSum / 20;
   NexBar cur = bars[i];
   NexBar pb = bars[i - 1];
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   NexSnap pp = snaps[i - 2];
   if(NA(s.adx) || NA(s.atr) || NA(s.plusDI) || NA(s.minusDI) || NA(s.sma20) || NA(s.sma50)) return NX_NONE;
   if(NA(p.adx) || NA(pp.adx)) return NX_NONE;
   if(s.adx < 22) return NX_NONE;
   if(s.adx <= p.adx || p.adx <= pp.adx) return NX_NONE;
   double buffer = 0.15 * s.atr, maxExt = 1.75 * s.atr;
   bool volOk = cur.v > avgVol;
   if(cur.c > hh + buffer && pb.c <= hh && s.plusDI > s.minusDI && s.sma20 > s.sma50 && (cur.c - hh) < maxExt && volOk) { note = "broke above 20-bar high on above-avg volume"; return NX_LONG; }
   if(cur.c < ll - buffer && pb.c >= ll && s.minusDI > s.plusDI && s.sma20 < s.sma50 && (ll - cur.c) < maxExt && volOk) { note = "broke below 20-bar low on above-avg volume"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
