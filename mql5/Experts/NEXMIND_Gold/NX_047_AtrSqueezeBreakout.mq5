//+------------------------------------------------------------------+
//| NX_047_AtrSqueezeBreakout.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #47 REJECTED 1d GC=F (run 20): trades 2, win 0.0%, avgR -1.051, PF 0.00
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "ATR Squeeze Breakout (Volatility Expansion Entry)"

#define NX_NAME "ATR Squeeze Breakout (Volatility Expansion Entry)"
#define NX_MAGIC 7700047
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 30) return NX_NONE;
   NexSnap s = snaps[i];
   if(NA(s.atr) || NA(s.plusDI) || NA(s.minusDI) || NA(s.adx) || NA(s.rsi) || NA(s.macdHist)) return NX_NONE;
   double atrSum = 0; int cnt = 0;
   for(int k = i - 20; k < i; k++) if(!NA(snaps[k].atr)) { atrSum += snaps[k].atr; cnt++; }
   if(cnt < 12) return NX_NONE;
   double avgAtr = atrSum / cnt;
   if(s.atr >= avgAtr * 0.85) return NX_NONE;
   double hiN = -DBL_MAX, loN = DBL_MAX;
   for(int k = i - 10; k < i; k++) { if(bars[k].h > hiN) hiN = bars[k].h; if(bars[k].l < loN) loN = bars[k].l; }
   double c = bars[i].c, diDiff = s.plusDI - s.minusDI;
   if(c > hiN && diDiff > 8 && s.adx > 20 && s.rsi > 47 && s.rsi < 74 && s.macdHist > 0) { note = "ATR squeeze breakout long"; return NX_LONG; }
   if(c < loN && diDiff < -8 && s.adx > 20 && s.rsi < 53 && s.rsi > 26 && s.macdHist < 0) { note = "ATR squeeze breakout short"; return NX_SHORT; }
   return NX_NONE;
  }
//+------------------------------------------------------------------+
