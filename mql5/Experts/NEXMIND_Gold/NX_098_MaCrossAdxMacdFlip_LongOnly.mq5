//+------------------------------------------------------------------+
//| NX_098_MaCrossAdxMacdFlip_LongOnly.mq5
//| NEXMIND gold strategy, translated from the repo to MQL5.
//+------------------------------------------------------------------+
//| #98 REJECTED 1d GC=F (run 63): trades 4, win 50.0%, avgR -0.109, PF 0.71
//|
//| Status: every gold strategy in NEXMIND was rejected. This EA exists to
//| re-run the backtest in the MT5 Strategy Tester, not to trade live.
//| Rule translated line for line from the JavaScript in ResearchStrategy.code.
//| Exit defaults: single target, TP 1.2 x ATR, SL 1.5 x ATR (the ladder these rows were backtested on).
//+------------------------------------------------------------------+
#property copyright "NEXMIND"
#property version   "1.00"
#property description "Trend-Following MA Cross + ADX + MACD Flip (Momentum)"

#define NX_NAME "Trend-Following MA Cross + ADX + MACD Flip (Momentum)"
#define NX_MAGIC 7700098
#include "NexCore.mqh"

int NexDecide(const NexBar &bars[], const NexSnap &snaps[], const int i, string &note)
  {
   if(i < 50) return NX_NONE;
   NexSnap s = snaps[i];
   NexSnap p = snaps[i - 1];
   if(NA(s.sma20) || NA(s.sma50) || NA(s.adx) || NA(p.adx) || NA(s.macdHist) || NA(p.macdHist)) return NX_NONE;
   if(NA(s.plusDI) || NA(s.minusDI) || NA(s.rsi)) return NX_NONE;
   if(!(s.sma20 > s.sma50 && s.price > s.sma20)) return NX_NONE;
   if(s.adx <= 25 || s.adx <= p.adx) return NX_NONE;
   double diSpread = s.plusDI - s.minusDI;
   if(diSpread <= 4) return NX_NONE;
   if(s.rsi >= 68 || s.rsi <= 50) return NX_NONE;
   if(!(p.macdHist <= 0 && s.macdHist > 0)) return NX_NONE;
   if(bars[i].c <= bars[i - 1].h) return NX_NONE;
   note = "uptrend, ADX " + NxF(s.adx, 1) + " rising, MACD fresh flip, close above prior high";
   return NX_LONG;
  }
//+------------------------------------------------------------------+
