//+------------------------------------------------------------------+
//| NX_108_RsiAtrExtensionFade.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #108 REJECTED 1d GC=F (run 67): trades 1, win 0.0%, avgR -1.002, PF 0.00
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "RSI/ATR Extension Fade from SMA20"

#define NX_NAME "RSI/ATR Extension Fade from SMA20"
#define NX_MAGIC 7700108
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 20) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.rsi) || NA(s.sma20) || NA(s.atr) || NA(s.adx) || NA(s.macdHist) || NA(p.macdHist)) return NX_NONE;
   if(s.atr <= 0) return NX_NONE;
   double c = bars[i].c;
   double distAtr = (c - s.sma20) / s.atr;
   if(s.adx > 32) return NX_NONE;
   if(s.rsi < 32 && distAtr < -1.5 && s.macdHist >= p.macdHist - MathAbs(p.macdHist) * 0.05) { note = "RSI oversold, " + NxF(MathAbs(distAtr), 2) + "x ATR below SMA20"; return NX_LONG; }
   if(s.rsi > 68 && distAtr > 1.5 && s.macdHist <= p.macdHist + MathAbs(p.macdHist) * 0.05) { note = "RSI overbought, " + NxF(distAtr, 2) + "x ATR above SMA20"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
